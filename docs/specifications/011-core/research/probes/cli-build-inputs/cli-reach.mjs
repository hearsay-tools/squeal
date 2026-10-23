// Throwaway probe for 011-127: which src/ files the built CLI can load, from esbuild's metafile
// of src/cli/index.ts (static and literal dynamic imports), against every non-test src/ file tsc compiles.
// Run from the scratch clone: node cli-reach.mjs /tmp/r127/repo
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const clone = process.argv[2];
const esbuild = createRequire(join(clone, "package.json"))("esbuild");
const entries = process.argv.slice(3).length > 0 ? process.argv.slice(3) : ["src/cli/index.ts"];
const result = await esbuild.build({
  absWorkingDir: clone, entryPoints: entries, bundle: true, write: false, metafile: true,
  platform: "node", format: "esm", packages: "external", outdir: "/tmp/r127/meta/out", logLevel: "silent",
});
const held = Object.keys(result.metafile.inputs).filter((p) => p.startsWith("src/"));
const all = readdirSync(join(clone, "src"), { recursive: true })
  .map((p) => `src/${p}`).filter((p) => p.endsWith(".ts") && !p.endsWith(".test.ts"));
const top = (ps) => Object.entries(ps.reduce((m, p) => ((m[p.split("/").slice(0, 3).join("/")] = (m[p.split("/").slice(0, 3).join("/")] ?? 0) + 1), m), {})).sort();
console.log(JSON.stringify({ entries, tscCompiles: all.length, cliHolds: held.length, notHeld: top(all.filter((p) => !held.includes(p))) }, null, 1));
