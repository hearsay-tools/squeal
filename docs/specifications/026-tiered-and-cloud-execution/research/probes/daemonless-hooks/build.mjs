// Throwaway (026, daemonless-hooks). Bundles inline.ts the way the plugin build
// bundles its CLI (esbuild, ESM, node platform) into <out>/cli/inline.mjs, and
// copies the WASM files the bundle finds beside ../code and ../pytest.
// Usage: node build.mjs <worktree root> <out dir>
import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
const [wt, out] = process.argv.slice(2);
mkdirSync(join(out, "cli"), { recursive: true });
await build({
  absWorkingDir: wt,
  entryPoints: [{ in: join(import.meta.dirname, "inline.ts"), out: "cli/inline" }],
  outdir: out, outExtension: { ".js": ".mjs" }, bundle: true, platform: "node", format: "esm",
  target: "node22",
  define: { __SQUEAL_VERSION__: '"probe"', __SQUEAL_NODE_FLOOR__: '"22"' },
  banner: { js: 'import { createRequire as __r } from "node:module";\nconst require = __r(import.meta.url);' },
  external: ["vitest", "vitest/*", "@parcel/watcher"], logLevel: "warning",
});
for (const d of ["code", "pytest"]) cpSync(join(wt, "plugins/claude-code/dist", d), join(out, d), { recursive: true });
console.log("built", join(out, "cli/inline.mjs"));
