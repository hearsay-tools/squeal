// Throwaway probe for research 013-05: the Rolldown reproduction exactly as the issue text gives it.
// Run from a project that has rolldown installed: node --expose-gc issue-repro.mjs [nocycle]
import { viteResolvePlugin } from "rolldown/experimental";
const cycle = process.argv[2] !== "nocycle";
let ref;
(() => {
  const holder = { big: new Uint8Array(64 * 2 ** 20), plugin: null };
  const plugin = viteResolvePlugin({
    resolveOptions: { isBuild: false, isProduction: false, asSrc: true, preferRelative: false,
      root: process.cwd(), scan: false, mainFields: ["main"], conditions: [], externalConditions: [],
      extensions: [".js"], tryIndex: true, preserveSymlinks: false, tsconfigPaths: false },
    environmentConsumer: "server", environmentName: "ssr", builtins: [], external: [],
    noExternal: [], dedupe: [], resolveSubpathImports: () => undefined,
    onWarn() { holder.big; },
  });
  if (cycle) holder.plugin = plugin;
  ref = new WeakRef(holder);
})();
for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 100)); gc(); }
console.log("leaked:", ref.deref() !== undefined);
