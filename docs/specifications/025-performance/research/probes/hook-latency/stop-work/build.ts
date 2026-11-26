// Scratch hook build: tsx build.ts <repoRoot> <outdir>. Hook entries only.
import { join, resolve } from "node:path";
import { build, type BuildOptions } from "esbuild";
const [root, outdir] = process.argv.slice(2) as [string, string];
const { bundleOptions } = (await import(join(resolve(root), "src/harness/claude-code/build.ts"))) as {
  bundleOptions: (o: string) => BuildOptions;
};
const base = bundleOptions(resolve(outdir));
const entries = (base.entryPoints as { in: string; out: string }[]).filter((e) => !e.out.includes("/"));
await build({ ...base, absWorkingDir: resolve(root), entryPoints: entries, metafile: false });
console.log("built", entries.length, "to", outdir);
// Marks the moment before the hook's work, for the after-load preload.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
for (const f of readdirSync(outdir).filter((n) => n.endsWith(".mjs"))) {
  const p = join(outdir, f);
  const t = readFileSync(p, "utf8");
  const i = t.lastIndexOf("\nawait runMain(");
  if (i >= 0) writeFileSync(p, `${t.slice(0, i)}\nglobalThis.__sqLoaded = performance.now();${t.slice(i)}`);
}
