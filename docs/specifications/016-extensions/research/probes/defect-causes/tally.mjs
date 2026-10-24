// Throwaway probe for 016-09: tally classes.tsv (the researcher's reading, one primary and an
// optional secondary per item) against items.jsonl. Usage: node tally.mjs <items.jsonl> <classes.tsv>
import { readFileSync } from "node:fs";

const [itemsPath, classesPath] = process.argv.slice(2);
const items = readFileSync(itemsPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const cls = new Map(readFileSync(classesPath, "utf8").trim().split("\n").map((l) => { const [id, p, s, why] = l.split("\t"); return [id, { p, s: s || "", why: why || "" }]; }));
const CATS = ["A", "B", "C", "D", "E", "F", "G"];
const rows = items.map((i) => ({ ...i, ...cls.get(i.id) }));
const defects = rows.filter((r) => CATS.includes(r.p));
const excluded = rows.filter((r) => !CATS.includes(r.p));
const count = (list, key) => { const c = {}; for (const r of list) c[key(r)] = (c[key(r)] ?? 0) + 1; return c; };
const line = (label, list) => {
  const c = count(list, (r) => r.p);
  const n = list.length;
  return `${label.padEnd(26)} n=${String(n).padStart(3)}  ` + CATS.map((k) => `${k} ${String(c[k] ?? 0).padStart(3)} (${n ? Math.round((100 * (c[k] ?? 0)) / n) : 0}%)`).join("  ");
};
console.log("excluded:", JSON.stringify(count(excluded, (r) => r.p)));
console.log(line("all defects", defects));
for (const src of ["review", "issue-row", "defect-row", "later", "issue"]) console.log(line(`  ${src}`, defects.filter((r) => r.src === src)));
console.log(line("  review blockers", defects.filter((r) => r.src === "review" && r.kind.startsWith("blocker"))));
console.log(line("  review should-fix", defects.filter((r) => r.src === "review" && !r.kind.startsWith("blocker"))));
// A re-review's residual of an earlier blocker is the same defect; its title says so.
const RESIDUAL = /residual|still|remains|remaining|prior|again|partially|unchanged|reproduction fixed/i;
// R213 says "still" of a first-round finding (004 wave-4 is that row's first review), not a residual.
const NOT_RESIDUAL = new Set(["R213"]);
const residual = (r) => r.src === "review" && RESIDUAL.test(r.title) && !NOT_RESIDUAL.has(r.id);
const deduped = defects.filter((r) => !residual(r));
const ab = (l) => l.filter((r) => ["A", "B"].includes(r.p)).length;
const abAny = (l) => l.filter((r) => ["A", "B"].includes(r.p) || ["A", "B"].includes(r.s)).length;
console.log(`deduped: A or B primary ${ab(deduped)}, with secondaries ${abAny(deduped)}`);
for (const [label, l] of [["before 10-17", deduped.filter((r) => r.date && r.date < "2026-10-17")], ["10-17 on", deduped.filter((r) => r.date && r.date >= "2026-10-17")], ["undated", deduped.filter((r) => !r.date)]])
  console.log(`  deduped ${label}: n=${l.length}, A or B primary ${ab(l)}, with secondaries ${abAny(l)}`);
console.log(line("deduped (residuals out)", deduped));
console.log("\nper spec");
for (const s of [...new Set(defects.map((r) => r.spec))].sort()) console.log(line(`  ${s}`, defects.filter((r) => r.spec === s)));
console.log("\nby date (split 2026-10-17)");
console.log(line("  before 10-17", defects.filter((r) => r.date && r.date < "2026-10-17")));
console.log(line("  10-17 on", defects.filter((r) => r.date && r.date >= "2026-10-17")));
console.log(line("  undated", defects.filter((r) => !r.date)));
console.log("\nreview items by date");
for (const [a, b] of [["2026-10-01", "2026-10-09"], ["2026-10-09", "2026-10-13"], ["2026-10-13", "2026-10-17"], ["2026-10-17", "2026-10-20"], ["2026-10-20", "2026-10-22"], ["2026-10-22", "2026-10-25"]])
  console.log(line(`  ${a}..${b}`, defects.filter((r) => r.src === "review" && r.date >= a && r.date < b)));
console.log("\nsecondary A or B on a non-A/B primary:", JSON.stringify(count(defects.filter((r) => !["A", "B"].includes(r.p) && ["A", "B"].includes(r.s)), (r) => `${r.p}/${r.s}`)));
console.log("A or B as primary or secondary:", defects.filter((r) => ["A", "B"].includes(r.p) || ["A", "B"].includes(r.s)).length);
console.log("\nA and B items");
for (const r of defects.filter((r) => ["A", "B"].includes(r.p))) console.log([r.id, r.p, r.s, r.spec, r.date, r.where, r.paths[0] ?? "", r.why].join("\t"));
