// Throwaway: question 5. Reads N committed JS/TS blobs of HEAD with one `git cat-file --batch`
// (no working-tree reads), normalizes each, then repeats through a (blob id, ext) memo.
// Usage: SQUEAL_PARSER=1 node --import tsx rekey.mjs 500 1500
import { execFileSync } from "node:child_process";
import { loadavg } from "node:os";
import { extname } from "node:path";
import { performance } from "node:perf_hooks";
import { catFileBatch } from "./blobs.mjs";
import { digest, normalize } from "./strip.mjs";
import { REPO } from "./ts.mjs";

const t0 = performance.now();
await normalize("const a: number = 1;", ".ts");
const coldMs = performance.now() - t0;
const tree = execFileSync("git", ["ls-tree", "-r", "HEAD"], { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 28 })
  .trim().split("\n").map((l) => { const [meta, path] = l.split("\t"); return { oid: meta.split(" ")[2], path }; })
  .filter((e) => /\.(ts|tsx|js|jsx|mjs|mts|cjs|cts)$/.test(e.path));
for (const n of process.argv.slice(2).map(Number)) {
  const stride = Math.max(1, Math.floor(tree.length / n));
  const pick = tree.filter((_, i) => i % stride === 0).slice(0, n);
  const load = loadavg()[0];
  let s = performance.now();
  const blobs = await catFileBatch(REPO, pick.map((e) => e.oid));
  const readMs = performance.now() - s;
  const memo = new Map();
  s = performance.now();
  let fallback = 0;
  for (const e of pick) {
    const ext = extname(e.path);
    const r = await normalize(blobs.get(e.oid).toString("utf8"), ext);
    if (!r.ok) fallback++;
    memo.set(`${e.oid}\0${ext}`, r.ok ? digest(ext, r.trim) : e.oid);
  }
  const normMs = performance.now() - s;
  s = performance.now();
  let hits = 0;
  for (const e of pick) if (memo.has(`${e.oid}\0${extname(e.path)}`)) hits++;
  const memoMs = performance.now() - s;
  const bytes = [...blobs.values()].reduce((a, b) => a + b.length, 0);
  console.log(JSON.stringify({ node: process.version, n, mb: +(bytes / 1e6).toFixed(1), coldMs: +coldMs.toFixed(0), catFileMs: +readMs.toFixed(0), normalizeMs: +normMs.toFixed(0), perFileMs: +(normMs / n).toFixed(2), memoLookupMs: +memoMs.toFixed(2), hits, fallback, load1: +load.toFixed(1) }));
}
