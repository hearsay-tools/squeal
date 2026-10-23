// 011-149 probe (throwaway): what keying every tracked TypeScript file on emitted code costs once, cold:
// Vite's oxc transform (tsconfig found per file), with and without a source map, the comment-free reprint,
// and the blob hash Squeal takes today, each timed over the whole worktree in one process.
// Usage: node cost.mjs <clone>
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const clone = process.argv[2];
const req = createRequire(createRequire(join(clone, "package.json")).resolve("vitest/package.json"));
const vite = await import(pathToFileURL(req.resolve("vite")).href);
const { minifySync } = await import(pathToFileURL(createRequire(req.resolve("vite")).resolve("rolldown/utils")).href);
const files = execFileSync("git", ["-C", clone, "ls-files", "*.ts", "*.tsx", "*.mts", "*.cts"]).toString().split("\n")
  .filter((f) => f && !f.endsWith(".d.ts") && !f.includes("/fixtures/"));
const src = files.map((f) => { try { return [f, readFileSync(join(clone, f), "utf8")]; } catch { return null; } }).filter(Boolean);
const bytes = src.reduce((n, [, s]) => n + Buffer.byteLength(s), 0);
const time = async (fn) => { const t0 = performance.now(); let errors = 0; for (const [f, s] of src) { try { await fn(join(clone, f), s); } catch { errors++; } } return [+(performance.now() - t0).toFixed(0), errors]; };
const blob = await time(async (_, s) => createHash("sha1").update(`blob ${Buffer.byteLength(s)}\0`).update(s).digest("hex"));
const nomap = await time((f, s) => vite.transformWithOxc(s, f, { sourcemap: false }));
const map = await time((f, s) => vite.transformWithOxc(s, f, { sourcemap: true }));
const bare = await time(async (f, s) => { const js = (await vite.transformWithOxc(s, f, { sourcemap: false })).code;
  return createHash("sha256").update(minifySync("x.js", js, { compress: false, mangle: false, module: true, codegen: { removeWhitespace: false, legalComments: "none" } }).code).digest("hex"); });
console.log(JSON.stringify({ clone, files: src.length, bytes, msBlobHash: blob, msOxcNoMap: nomap, msOxcWithMap: map, msOxcThenReprint: bare,
  perFileUs: { oxc: Math.round(nomap[0] * 1000 / src.length), withMap: Math.round(map[0] * 1000 / src.length), reprint: Math.round(bare[0] * 1000 / src.length) } }));
