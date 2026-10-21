// Throwaway probe for research 013-05, and the upstream reproduction: Rolldown alone.
//   node --expose-gc rolldown-repro.mjs <root> <cycle|nocycle>
// Makes viteResolvePlugin (rolldown/experimental) with an onWarn callback whose closure holds a
// 64 MiB buffer. "cycle": the closure also reaches the plugin object, as Vite's onWarn reaches
// it through the environment's config.plugins. "nocycle": it does not. Then every reference is
// dropped, and after GCs over 2 s it reports whether the buffer is still alive.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [root, mode] = process.argv.slice(2);
const require = createRequire(join(root, "package.json"));
const rolldownVersion = require("rolldown/package.json").version;
const { viteResolvePlugin } = await import(pathToFileURL(require.resolve("rolldown/experimental")).href);
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
let ref;
(() => {
  const holder = { big: new Uint8Array(64 * 2 ** 20).fill(1), plugin: null };
  const plugin = viteResolvePlugin({
    resolveOptions: {
      isBuild: false, isProduction: false, asSrc: true, preferRelative: false, root,
      scan: false, mainFields: ["module", "main"], conditions: [], externalConditions: [],
      extensions: [".js", ".ts"], tryIndex: true, preserveSymlinks: false, tsconfigPaths: false,
    },
    environmentConsumer: "server", environmentName: "ssr", builtins: [], external: [], noExternal: [],
    dedupe: [], disableCache: true, legacyInconsistentCjsInterop: false,
    resolveSubpathImports: () => undefined,
    async onWarn(msg) { console.log(holder.big.length, msg); },
  });
  if (mode === "cycle") holder.plugin = plugin;
  ref = new WeakRef(holder);
})();
for (let i = 0; i < 20; i++) { await tick(100); globalThis.gc(); }
console.log(JSON.stringify({ rolldown: rolldownVersion, mode, holderAlive: ref.deref() !== undefined, arrayBuffersMiB: Math.round(process.memoryUsage().arrayBuffers / 2 ** 20) }));
process.exit(0);
