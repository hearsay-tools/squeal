// Throwaway probe for research/coverage-records.md, question 2: do two CI runs
// give the same record for a test file at the same exported key?
// Usage: node stability.mjs <download dir A> <download dir B>. Reads only.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

function load(dir) {
  const parts = readdirSync(dir)
    .filter((d) => d.startsWith("squeal-parts-shard-"))
    .flatMap((d) => readdirSync(join(dir, d)).map((f) => JSON.parse(readFileSync(join(dir, d, f), "utf8"))));
  const exp = JSON.parse(gunzipSync(readFileSync(join(dir, "squeal-results", "squeal-results.json.gz"))).toString("utf8"));
  const recs = new Map();
  for (const part of parts)
    for (const f of part.testFiles) {
      if (f.record === undefined) continue;
      const r = part.coverage.records[f.record];
      recs.set(`${f.project}\0${f.path}`, { sources: r.sources.map((i) => part.coverage.sources[i]), unread: r.unread });
    }
  const keys = new Map(exp.testFiles.map((f) => [`${f.project}\0${f.path}`, f.key]));
  return { recs, keys };
}

const a = load(process.argv[2]);
const b = load(process.argv[3]);
let sameKey = 0;
let sameKeySameRecord = 0;
const diffs = [];
for (const [k, key] of a.keys) {
  if (b.keys.get(k) !== key) continue;
  sameKey++;
  const ra = a.recs.get(k);
  const rb = b.recs.get(k);
  if (JSON.stringify(ra) === JSON.stringify(rb)) {
    sameKeySameRecord++;
    continue;
  }
  // Classify the difference.
  const pa = new Map(ra.sources.map((s) => [s.path, s]));
  const pb = new Map(rb.sources.map((s) => [s.path, s]));
  const onlyA = [...pa.keys()].filter((p) => !pb.has(p));
  const onlyB = [...pb.keys()].filter((p) => !pa.has(p));
  const blob = [...pa.keys()].filter((p) => pb.has(p) && pa.get(p).blob !== pb.get(p).blob);
  const hits = [...pa.keys()].filter(
    (p) => pb.has(p) && pa.get(p).blob === pb.get(p).blob && JSON.stringify(pa.get(p)) !== JSON.stringify(pb.get(p)),
  );
  diffs.push({ file: k.replace("\0", " "), onlyA, onlyB, blob, hits, unread: JSON.stringify(ra.unread) !== JSON.stringify(rb.unread) });
}
console.log(`files at the same exported key in both runs: ${sameKey}; same record: ${sameKeySameRecord}`);
const cls = { sourcesDiffer: 0, blobDiffers: 0, hitsOnly: 0, unreadOnly: 0 };
for (const d of diffs) {
  if (d.onlyA.length || d.onlyB.length) cls.sourcesDiffer++;
  else if (d.blob.length) cls.blobDiffers++;
  else if (d.hits.length) cls.hitsOnly++;
  else if (d.unread) cls.unreadOnly++;
}
console.log(`differences by kind: ${JSON.stringify(cls)}`);
for (const d of diffs.slice(0, 8)) console.log(JSON.stringify({ ...d, onlyA: d.onlyA.slice(0, 3), onlyB: d.onlyB.slice(0, 3), hits: d.hits.slice(0, 3) }));
// Which paths most often differ in hits only.
const hot = new Map();
for (const d of diffs) for (const p of d.hits) hot.set(p, (hot.get(p) ?? 0) + 1);
console.log("paths most often differing in hits at the same blob:", [...hot].sort((x, y) => y[1] - x[1]).slice(0, 10));

// Finer: per test file in both runs, per source path at the same blob in both
// records, are the hits equal? Other inputs of the file may differ, so a
// difference here is an upper bound on run-to-run variation.
let pairs = 0;
let equal = 0;
const byFile = new Map();
for (const [k, ra] of a.recs) {
  const rb = b.recs.get(k);
  if (!rb) continue;
  const pb = new Map(rb.sources.map((s) => [s.path, s]));
  for (const s of ra.sources) {
    const o = pb.get(s.path);
    if (!o || o.blob !== s.blob) continue;
    pairs++;
    if (JSON.stringify(o) === JSON.stringify(s)) equal++;
    else byFile.set(k, (byFile.get(k) ?? 0) + 1);
  }
}
console.log(`source entries at equal (test file, path, blob) in both runs: ${pairs}; equal hits: ${equal} (${((100 * equal) / pairs).toFixed(2)}%); test files with any difference: ${byFile.size}`);
