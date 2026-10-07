// THROWAWAY probe. Observed graph through module.registerHooks (in-thread, synchronous).
// Load with --import after tsx. Writes $RECORD_DIR/<pid>.json on exit.
import { registerHooks } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
const edges = [], loaded = [], failed = [];
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      const r = nextResolve(specifier, context);
      edges.push([context.parentURL ?? null, specifier, r.url]);
      return r;
    } catch (e) { failed.push([context.parentURL ?? null, specifier, e.code]); throw e; }
  },
  load(url, context, nextLoad) { loaded.push(url); return nextLoad(url, context); },
});
process.on("exit", () => {
  const dir = process.env.RECORD_DIR; if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${process.pid}.json`, JSON.stringify({ pid: process.pid, ppid: process.ppid, testContext: process.env.NODE_TEST_CONTEXT ?? null, argv: process.argv, execArgv: process.execArgv, edges, loaded, failed,
    requireCache: Object.keys((globalThis.require ?? {}).cache ?? {}) }));
});
