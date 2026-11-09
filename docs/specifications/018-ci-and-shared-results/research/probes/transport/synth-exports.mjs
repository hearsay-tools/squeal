// Throwaway (018-14). Makes N successive "main commit" exports from one real export:
// per commit, a share of test files re-keys (cezar: 604 of ~1,700 per landing,
// main-results.md A'), and every duration changes (each CI run measures anew).
// Writes <out>/NN.json (raw) and <out>/NN.json.gz. Deterministic (seeded).
// Usage: node synth-exports.mjs <export.json.gz> <out dir> <N> [rekeyShare=0.35] [jitter=all|rekeyed]
// jitter=rekeyed: only re-keyed files get new durations (a model of an export that
// carries a file's duration only when its key changed).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
const [src, out, n, share = "0.35", jitter = "all"] = process.argv.slice(2);
const base = JSON.parse(gunzipSync(readFileSync(src)));
let seed = 42; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
mkdirSync(out, { recursive: true });
let cur = structuredClone(base);
for (let i = 0; i < Number(n); i++) {
  const rekeyed = new Map();
  for (const t of cur.testFiles) if (i > 0 && rnd() < Number(share)) {
    const k = createHash("sha256").update(t.key + i).digest("hex"); rekeyed.set(t.key, k); t.key = k;
  }
  for (const r of cur.results) {
    const moved = rekeyed.has(r.key);
    if (moved) r.key = rekeyed.get(r.key);
    if (jitter === "all" || moved) r.durationMs = r.durationMs * (0.8 + 0.4 * rnd());
  }
  cur.header.commit = createHash("sha1").update("c" + i).digest("hex");
  cur.header.createdAt += 3600_000;
  const raw = JSON.stringify(cur);
  const nn = String(i).padStart(2, "0");
  writeFileSync(`${out}/${nn}.json`, raw); writeFileSync(`${out}/${nn}.json.gz`, gzipSync(raw));
}
console.log(`wrote ${n} exports to ${out}`);
