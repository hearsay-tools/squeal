// Throwaway probe for research 021-27. Loaded with
//   node --expose-gc --import <this file> <bundle>/dist/cli/squeal.mjs daemon <root>
// The daemon starts its runner hosts with its own execArgv (src/cli/daemon.ts), so the probe
// also loads in each runner host. It acts only in the daemon ("squeal.mjs daemon") and in
// runner hosts ("squeal.mjs runner-host ... --runner <name>"); a test worker that inherits the
// flags is left alone. Role: "daemon" or "host-<runner>". Every DH_EVERY_MS (default 15 s)
// it appends one JSON line to $DH_LOG/<role>-<pid>.jsonl, and polls $DH_CTL/<role>/ for a
// command file, runs it and removes it:
//   gc       one full GC (major, sync); before, after and the pause
//   lr       one last-resort GC (major, sync, flavor last-resort), as the daemon's idle GC does
//   hs       a heap snapshot to $DH_LOG/<role>-<pid>-<n>.heapsnapshot (after a last-resort GC)
//   ap-start / ap-stop  V8's sampling heap profiler through an in-process inspector session
//            (no port, no outside attach), collected objects included; ap-stop writes
//            $DH_LOG/<role>-<pid>-<n>.heapprofile
//   sample   one extra sample now
//   mark-<label>  one sample with that label
// No product code changes; nothing is read from or written to the daemon's socket or store.
import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { Session } from "node:inspector";
import { join } from "node:path";
import v8 from "node:v8";

const argv = process.argv;
const cli = argv.findIndex((a) => a.endsWith("squeal.mjs"));
const verb = cli >= 0 ? argv[cli + 1] : undefined;
const runner = argv.includes("--runner") ? argv[argv.indexOf("--runner") + 1] : undefined;
const role = verb === "daemon" ? "daemon" : verb === "runner-host" ? `host-${runner}` : undefined;
const LOG = process.env.DH_LOG;
const CTL = process.env.DH_CTL;

if (role && LOG && CTL) {
  const ctlDir = join(CTL, role);
  mkdirSync(ctlDir, { recursive: true });
  const out = join(LOG, `${role}-${process.pid}.jsonl`);
  const every = Number(process.env.DH_EVERY_MS ?? 15000);
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
        .filter((s) => s.space_size > 0)
        .map((s) => [s.space_name, { size: mib(s.space_size), used: mib(s.space_used_size) }]),
    );
    const line = {
      t: new Date().toISOString(),
      label,
      role,
      pid: process.pid,
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
      globalHandlesMiB: mib(h.used_global_handles_size ?? 0),
      nativeContexts: h.number_of_native_contexts,
      detachedContexts: h.number_of_detached_contexts,
      spaces,
      ...extra,
    };
    appendFileSync(out, `${JSON.stringify(line)}\n`);
    return line;
  };
  const collect = (label, options) => {
    const before = snap(`${label}-before`);
    const t0 = performance.now();
    globalThis.gc(options);
    const pauseMs = Math.round((performance.now() - t0) * 10) / 10;
    snap(`${label}-after`, { pauseMs, freedHeapMiB: Math.round((before.heapUsedMiB - mib(process.memoryUsage().heapUsed)) * 10) / 10 });
    setTimeout(() => snap(`${label}-after-2s`), 2000).unref();
  };
  let shots = 0;
  let profiles = 0;
  let session = null;
  snap("probe-start", { argv: argv.slice(1).join(" ").slice(0, 300) });
  setInterval(() => snap("tick"), every).unref();
  setInterval(() => {
    let names;
    try {
      names = readdirSync(ctlDir);
    } catch {
      return;
    }
    for (const name of names) {
      rmSync(join(ctlDir, name), { force: true });
      if (name === "gc") collect("gc", { type: "major", execution: "sync" });
      else if (name === "lr") collect("lr", { type: "major", execution: "sync", flavor: "last-resort" });
      else if (name === "hs") {
        shots += 1;
        const file = join(LOG, `${role}-${process.pid}-${shots}.heapsnapshot`);
        const t0 = performance.now();
        v8.writeHeapSnapshot(file);
        snap("heap-snapshot", { file, ms: Math.round(performance.now() - t0) });
      } else if (name === "ap-start") {
        // Allocation sampling, collected objects included: what allocates, not what stays.
        session ??= new Session();
        session.connect();
        session.post("HeapProfiler.enable");
        session.post("HeapProfiler.startSampling", {
          samplingInterval: 32768,
          includeObjectsCollectedByMajorGC: true,
          includeObjectsCollectedByMinorGC: true,
        });
        snap("ap-start");
      } else if (name === "ap-stop" && session) {
        session.post("HeapProfiler.stopSampling", (error, result) => {
          profiles += 1;
          const file = join(LOG, `${role}-${process.pid}-${profiles}.heapprofile`);
          if (!error) writeFileSync(file, JSON.stringify(result.profile));
          snap("ap-stop", { file, error: error ? String(error) : undefined });
          session.disconnect();
        });
      } else if (name === "sample") snap("sample");
      else if (name.startsWith("mark-")) snap(name.slice(5));
    }
  }, 500).unref();
}
