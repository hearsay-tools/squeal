// Throwaway probe: at exit, write this process's require.cache keys and
// whatever ESM list Node exposes (none public) to $LM_OUT/cache-<pid>-<tid>.json.
const { writeFileSync } = require("node:fs");
const { threadId, isInternalThread } = require("node:worker_threads");
const out = process.env.LM_OUT;
if (out && !isInternalThread) {
  process.on("exit", () => {
    writeFileSync(`${out}/cache-${process.pid}-${threadId}.json`, JSON.stringify({
      argv1: process.argv[1] ?? null,
      requireCache: Object.keys(require.cache),
      moduleLoadListFiles: (process.moduleLoadList ?? []).filter((s) => s.includes("/") && !s.startsWith("Internal") && !s.startsWith("NativeModule")),
    }, null, 1));
  });
}
