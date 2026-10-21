// Throwaway probe for research 011-53. Loaded with
//   node --expose-gc --import <this file> <bundle>/dist/cli/squeal.mjs daemon <root>
// It acts only in the daemon process (argv "squeal.mjs daemon"), never in a test worker that
// inherits NODE_OPTIONS. Every DM_EVERY_MS (default 15 s) it appends one JSON line to
// $DM_LOG: process.memoryUsage(), v8.getHeapStatistics(), the old/new/code/large-object
// spaces, and /proc/self/status private memory and swap. It polls $DM_CTL every 500 ms for
// a command file, runs it and removes it:
//   gc      one full GC (global.gc, major, synchronous); logs before, after and the pause
//   sample  one extra sample now
//   mark-<label>   one sample with that label
// No product code changes; nothing is read from or written to the daemon's socket or store.
import { appendFileSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import v8 from "node:v8";

const argv = process.argv;
const isDaemon =
  argv.some((a) => a.endsWith("squeal.mjs")) &&
  argv.includes("daemon") &&
  process.env.SQUEAL_DAEMON_CHILD === undefined;
const LOG = process.env.DM_LOG;
const CTL = process.env.DM_CTL;

if (isDaemon && LOG && CTL) {
  const every = Number(process.env.DM_EVERY_MS ?? 15000);
  const mib = (n) => Math.round((n / 2 ** 20) * 10) / 10;
  const status = () => {
    const s = readFileSync("/proc/self/status", "utf8");
    const kb = (k) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(s)?.[1] ?? 0);
    return {
      privMiB: mib((kb("RssAnon") + kb("RssShmem")) * 1024),
      swapMiB: mib(kb("VmSwap") * 1024),
      threads: kb("Threads"),
    };
  };
  const load1 = () => readFileSync("/proc/loadavg", "utf8").split(" ")[0];
  const snap = (label, extra = {}) => {
    const m = process.memoryUsage();
    const h = v8.getHeapStatistics();
    const spaces = Object.fromEntries(
      v8
        .getHeapSpaceStatistics()
        .filter((s) => ["old_space", "new_space", "code_space", "large_object_space"].includes(s.space_name))
        .map((s) => [s.space_name, { size: mib(s.space_size), used: mib(s.space_used_size) }]),
    );
    const line = {
      t: new Date().toISOString(),
      label,
      load1: load1(),
      ...status(),
      rssMiB: mib(m.rss),
      heapTotalMiB: mib(m.heapTotal),
      heapUsedMiB: mib(m.heapUsed),
      externalMiB: mib(m.external),
      arrayBuffersMiB: mib(m.arrayBuffers),
      physicalHeapMiB: mib(h.total_physical_size),
      mallocedMiB: mib(h.malloced_memory),
      peakMallocedMiB: mib(h.peak_malloced_memory),
      nativeContexts: h.number_of_native_contexts,
      detachedContexts: h.number_of_detached_contexts,
      spaces,
      ...extra,
    };
    appendFileSync(LOG, `${JSON.stringify(line)}\n`);
    return line;
  };
  const gc = () => {
    const before = snap("gc-before");
    const t0 = performance.now();
    globalThis.gc({ type: "major", execution: "sync" });
    const pauseMs = Math.round((performance.now() - t0) * 10) / 10;
    // A second sample after the GC's sweeper and unmapping had a moment.
    snap("gc-after", { pauseMs, freedHeapMiB: Math.round((before.heapUsedMiB - mib(process.memoryUsage().heapUsed)) * 10) / 10 });
    setTimeout(() => snap("gc-after-2s"), 2000).unref();
  };
  snap("probe-start", { pid: process.pid });
  setInterval(() => snap("tick"), every).unref();
  setInterval(() => {
    let names;
    try {
      names = readdirSync(CTL);
    } catch {
      return;
    }
    for (const name of names) {
      rmSync(join(CTL, name), { force: true });
      if (name === "gc") gc();
      else if (name === "sample") snap("sample");
      else if (name.startsWith("mark-")) snap(name.slice(5));
    }
  }, 500).unref();
}
