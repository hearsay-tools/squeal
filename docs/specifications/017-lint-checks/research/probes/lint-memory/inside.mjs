// Throwaway probe for research 017-26. Loaded with
//   node --expose-gc --import <this file> <bundle>/dist/cli/squeal.mjs daemon <root>
// It acts only in the daemon process. It replaces `worker_threads.Worker` by a subclass
// that starts Squeal's `lint-worker.mjs` through `worker-wrap.mjs`, so the probe can ask the
// lint worker's isolate for its heap; every other worker starts unchanged. Every LM_EVERY_MS
// (default 1000) it appends one JSON line to $LM_LOG: /proc/self/status (VmRSS, VmHWM,
// RssAnon, RssFile), the daemon isolate's heap, and each live lint worker's heap
// (Worker#getHeapStatistics, no GC). It polls $LM_CTL for command files:
//   mark-<label>      one sample with that label
//   gc                a major GC in the daemon isolate and in each lint worker; logs both
//   lastresort        the same with V8's last-resort flavour (what the daemon's idle GC runs)
// No product code changes; nothing is read from or written to the daemon's socket or store.
import { appendFileSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import v8 from "node:v8";
import wt from "node:worker_threads";
import { smaps } from "./smaps.mjs";

const argv = process.argv;
const isDaemon = argv.some((a) => a.endsWith("squeal.mjs")) && argv.includes("daemon");
const { LM_LOG: LOG, LM_CTL: CTL } = process.env;
const WRAP = fileURLToPath(new URL("./worker-wrap.mjs", import.meta.url));
const mib = (n) => Math.round((n / 2 ** 20) * 10) / 10;

if (isDaemon && LOG && CTL) {
  const lint = new Set();
  let calls = 0;
  const Original = wt.Worker;
  class Wrapped extends Original {
    constructor(file, options = {}) {
      const name = file instanceof URL ? fileURLToPath(file) : String(file);
      if (!name.endsWith("lint-worker.mjs")) {
        super(file, options);
        return;
      }
      const { port1, port2 } = new wt.MessageChannel();
      super(WRAP, {
        ...options,
        workerData: { ...options.workerData, lmPort: port2, lmReal: pathToFileURL(name).href },
        transferList: [...(options.transferList ?? []), port2],
      });
      port1.unref();
      const entry = { worker: this, port: port1, started: new Date().toISOString(), pending: new Map() };
      port1.on("message", (m) => entry.pending.get(m.id)?.(m));
      lint.add(entry);
      this.once("exit", (code) => {
        lint.delete(entry);
        log("lint-worker-exit", { code, started: entry.started });
      });
      log("lint-worker-start", {});
    }
  }
  wt.Worker = Wrapped;
  syncBuiltinESMExports();

  const status = () => {
    const s = readFileSync("/proc/self/status", "utf8");
    const kb = (k) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(s)?.[1] ?? 0);
    return {
      rssMiB: mib(kb("VmRSS") * 1024),
      hwmMiB: mib(kb("VmHWM") * 1024),
      anonMiB: mib(kb("RssAnon") * 1024),
      fileMiB: mib(kb("RssFile") * 1024),
      threads: kb("Threads"),
    };
  };
  const mainHeap = () => {
    const h = v8.getHeapStatistics();
    return { usedMiB: mib(h.used_heap_size), physicalMiB: mib(h.total_physical_size), mallocedMiB: mib(h.malloced_memory), externalMiB: mib(h.external_memory) };
  };
  const workerHeaps = async () => {
    const out = [];
    for (const { worker, started } of lint) {
      try {
        const h = await worker.getHeapStatistics();
        out.push({ started, usedMiB: mib(h.used_heap_size), physicalMiB: mib(h.total_physical_size), mallocedMiB: mib(h.malloced_memory), externalMiB: mib(h.external_memory) });
      } catch (error) {
        out.push({ started, error: String(error) });
      }
    }
    return out;
  };
  function log(label, extra) {
    const line = { t: new Date().toISOString(), label, load1: readFileSync("/proc/loadavg", "utf8").split(" ")[0], ...status(), main: mainHeap(), ...(label === "tick" ? {} : { smaps: smaps() }), ...extra };
    appendFileSync(LOG, `${JSON.stringify(line)}\n`);
  }
  const sample = async (label, extra = {}) => log(label, { lint: await workerHeaps(), ...extra });
  const ask = (entry, gc) =>
    new Promise((resolve) => {
      const id = ++calls;
      const timer = setTimeout(() => resolve({ timeout: true }), 60000);
      entry.pending.set(id, (m) => {
        clearTimeout(timer);
        entry.pending.delete(id);
        resolve(m);
      });
      entry.port.postMessage({ id, gc });
    });
  const collect = async (flavour) => {
    const before = mainHeap();
    const t0 = performance.now();
    globalThis.gc?.({ type: "major", execution: "sync", ...(flavour === "last-resort" ? { flavor: "last-resort" } : {}) });
    const mainPauseMs = Math.round(performance.now() - t0);
    const workers = [];
    for (const entry of lint) workers.push(await ask(entry, flavour));
    await sample(`gc-${flavour}`, { mainBefore: before, mainPauseMs, workers });
  };
  void sample("probe-start", { pid: process.pid });
  setInterval(() => void sample("tick"), Number(process.env.LM_EVERY_MS ?? 1000)).unref();
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    let names;
    try {
      names = readdirSync(CTL);
    } catch {
      return;
    }
    busy = true;
    for (const name of names) {
      rmSync(join(CTL, name), { force: true });
      if (name === "gc") await collect("major");
      else if (name === "lastresort") await collect("last-resort");
      else if (name.startsWith("mark-")) await sample(name.slice(5));
    }
    busy = false;
  }, 300).unref();
}
