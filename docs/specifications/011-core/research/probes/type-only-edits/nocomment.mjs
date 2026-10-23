// 011-149 probe (throwaway): per real edit, Vite's oxc transform of the two blobs (tsconfig found from the
// path in the clone, no file written), then the emitted code reprinted by oxc without comments
// (minify with compress and mangle off). Also times each step, for the cost per file.
// Usage: node nocomment.mjs <clone> <pairs.tsv> <git dir> <out.jsonl>
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [clone, pairsTsv, gitDir, out] = process.argv.slice(2);
const req = createRequire(createRequire(join(clone, "package.json")).resolve("vitest/package.json"));
const vite = await import(pathToFileURL(req.resolve("vite")).href);
const { minifySync } = await import(pathToFileURL(createRequire(req.resolve("vite")).resolve("rolldown/utils")).href);
const blob = (h) => execFileSync("git", ["--git-dir", gitDir, "cat-file", "blob", h]).toString("utf8");

async function emit(abs, code) {
  const t0 = performance.now();
  let js = code;
  if (/\.(m?ts|[jt]sx|cts)$/.test(abs)) js = (await vite.transformWithOxc(code, abs, { sourcemap: false })).code;
  const t1 = performance.now();
  const bare = minifySync(abs.replace(/\.[^.]+$/, ".js"), js, { compress: false, mangle: false, module: true,
    codegen: { removeWhitespace: false, legalComments: "none" } });
  if (bare.errors.length) throw new Error(bare.errors[0].message);
  return { js, bare: bare.code, oxcMs: t1 - t0, bareMs: performance.now() - t1, bytes: code.length };
}

writeFileSync(out, "");
for (const line of readFileSync(pairsTsv, "utf8").split("\n").filter(Boolean)) {
  const [path, oldH, newH] = line.split("\t");
  const abs = join(clone, path);
  const rec = { path, oldH, newH };
  try {
    const a = await emit(abs, blob(oldH)), b = await emit(abs, blob(newH));
    rec.emitted = a.js === b.js ? "same" : "differs";
    rec.bare = a.bare === b.bare ? "same" : "differs";
    rec.ms = { oxc: +((a.oxcMs + b.oxcMs) / 2).toFixed(3), bare: +((a.bareMs + b.bareMs) / 2).toFixed(3) };
    rec.bytes = b.bytes;
  } catch (e) { rec.err = String(e.message).split("\n")[0].slice(0, 120); }
  appendFileSync(out, JSON.stringify(rec) + "\n");
}
console.error("done");
