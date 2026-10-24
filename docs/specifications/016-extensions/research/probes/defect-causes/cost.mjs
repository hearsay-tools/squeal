// Throwaway probe for 016-09: review rounds and repair rows as cost, per spec and per class.
// Usage: node cost.mjs <reviews.jsonl> <items.jsonl> <classes.tsv> <rows2.jsonl>
import { readFileSync } from "node:fs";

const [reviewsPath, itemsPath, classesPath, rowsPath] = process.argv.slice(2);
const jl = (p) => readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const reviews = jl(reviewsPath);
const items = jl(itemsPath);
const cls = new Map(readFileSync(classesPath, "utf8").trim().split("\n").map((l) => { const [id, p, s] = l.split("\t"); return [id, { p, s: s || "" }]; }));
const rows = jl(rowsPath);
const perSpec = {};
for (const r of reviews) {
  const s = (perSpec[r.spec.slice(0, 3)] ??= { reviews: 0, fail: 0, blockers: 0, repairRows: 0 });
  s.reviews++;
  if (r.verdict.startsWith("FAIL")) { s.fail++; s.blockers += r.items.filter((i) => i.kind.startsWith("blocker")).length; }
}
for (const r of rows) if (r.kind === "review-repair-row" || r.origin === "review-repair") { const k = /^\d{3}/.test(r.id) ? r.id.slice(0, 3) : "011"; (perSpec[k] ??= { reviews: 0, fail: 0, blockers: 0, repairRows: 0 }).repairRows++; }
console.log("spec  reviews  FAIL  blockers  review-repair rows");
for (const [k, v] of Object.entries(perSpec).sort()) console.log(k, String(v.reviews).padStart(8), String(v.fail).padStart(5), String(v.blockers).padStart(9), String(v.repairRows).padStart(10));
// A FAIL review's blockers by class: which classes alone account for a whole round.
const byFile = new Map();
for (const i of items.filter((i) => i.src === "review" && i.kind.startsWith("blocker"))) {
  const c = cls.get(i.id).p;
  if (c.length !== 1) continue;
  const f = `${i.spec}/${i.where}`;
  (byFile.get(f) ?? byFile.set(f, []).get(f)).push(c);
}
const solely = {};
const touched = {};
for (const [f, cs] of byFile) {
  const set = new Set(cs);
  for (const c of set) touched[c] = (touched[c] ?? 0) + 1;
  if (set.size === 1) solely[[...set][0]] = (solely[[...set][0]] ?? 0) + 1;
  if ([...set].every((c) => c === "A" || c === "B")) console.log("FAIL round whose blockers are all A or B:", f, cs.join(""));
}
console.log("FAIL rounds with blockers:", byFile.size);
console.log("rounds with at least one blocker of class:", JSON.stringify(touched));
console.log("rounds whose blockers are all one class:", JSON.stringify(solely));
