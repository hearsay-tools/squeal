// Throwaway probe (017-01). A warm ESLint in a worker thread. It keeps one
// long-lived ESLint instance ("kept") and also builds a new instance per
// request in the same thread ("fresh-instance"), and records every module
// URL it resolves (the config's import closure among them).
import { parentPort, workerData } from "node:worker_threads";
import { registerHooks } from "node:module";
import { loadProjectESLint, findings } from "./lib.mjs";

const loaded = new Set();
registerHooks({
  resolve(specifier, context, next) {
    const r = next(specifier, context);
    loaded.add(r.url);
    return r;
  },
});

const { root } = workerData;
// process.chdir() throws ERR_WORKER_UNSUPPORTED_OPERATION in a worker: the
// thread shares the process cwd, so `cwd` is passed to ESLint instead.
const { ESLint, version } = await loadProjectESLint(root);
const kept = new ESLint({ cwd: root });
let instances = 1;

parentPort.on("message", async ({ id, files }) => {
  try {
    const a = findings(await kept.lintFiles(files));
    let b = [];
    if (process.env.KEPT_ONLY !== "1") {
      instances += 1;
      b = findings(await new ESLint({ cwd: root }).lintFiles(files));
    }
    // With node --expose-gc, collect first so heapUsed is live memory.
    globalThis.gc?.();
    const mem = process.memoryUsage();
    parentPort.postMessage({ id, version, kept: a, fresh: b, instances, loaded: [...loaded], heapUsed: mem.heapUsed, rss: mem.rss });
  } catch (error) {
    parentPort.postMessage({ id, error: String(error?.stack ?? error) });
  }
});
parentPort.postMessage({ ready: true });
