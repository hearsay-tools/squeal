// Throwaway probe for research 017-26. The main script of a wrapped ESLint worker thread:
// it answers memory questions on `workerData.lmPort`, then imports Squeal's real
// `lint-worker.mjs` (`workerData.lmReal`), which runs unchanged on the same parentPort.
// A message { id, gc: "major" | "last-resort" | null } runs that GC in this thread (the
// process must run with --expose-gc, which reaches every isolate) and answers with this
// isolate's heap statistics and spaces. No product change.
import v8 from "node:v8";
import { workerData } from "node:worker_threads";

const mib = (n) => Math.round((n / 2 ** 20) * 10) / 10;
export function heap() {
  const h = v8.getHeapStatistics();
  const spaces = Object.fromEntries(
    v8.getHeapSpaceStatistics().map((s) => [s.space_name, mib(s.space_used_size)]),
  );
  return {
    usedMiB: mib(h.used_heap_size),
    totalMiB: mib(h.total_heap_size),
    physicalMiB: mib(h.total_physical_size),
    mallocedMiB: mib(h.malloced_memory),
    externalMiB: mib(h.external_memory),
    contexts: h.number_of_native_contexts,
    spaces,
  };
}
const port = workerData?.lmPort;
if (port) {
  port.on("message", (m) => {
    const before = heap();
    let pauseMs = null;
    if (m.gc && typeof globalThis.gc === "function") {
      const t0 = performance.now();
      globalThis.gc({ type: "major", execution: "sync", ...(m.gc === "last-resort" ? { flavor: "last-resort" } : {}) });
      pauseMs = Math.round(performance.now() - t0);
    }
    port.postMessage({ id: m.id, before, after: heap(), pauseMs });
  });
  port.unref();
}
await import(workerData.lmReal);
