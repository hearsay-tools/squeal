// Throwaway probe for 016-11: count areas.tsv (this researcher's area and mechanism per class E item)
// per area, spec and period; list every area x mechanism group of three or more; and its cost.
// Usage: node tally.mjs <items.jsonl> <reviews.jsonl> <rows2.jsonl> <areas.tsv>
import { readFileSync } from "node:fs";

const [itemsPath, reviewsPath, rowsPath, areasPath] = process.argv.slice(2);
const jl = (p) => readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const items = new Map(jl(itemsPath).map((i) => [i.id, i]));
const RESIDUAL = /residual|still|remains|remaining|prior|again|partially|unchanged|reproduction fixed/i;
const rows = readFileSync(areasPath, "utf8").trim().split("\n").map((l) => {
  const [id, area, mech] = l.split("\t");
  const i = items.get(id);
  const residual = i.src === "review" && RESIDUAL.test(i.title) && id !== "R213";
  return { ...i, area, mech, residual, group: `${area}.${mech}` };
});
const dedup = rows.filter((r) => !r.residual);
const count = (list, key) => { const c = {}; for (const r of list) c[key(r)] = (c[key(r)] ?? 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1]); };
const AREAS = ["WR", "KC", "SV", "ST", "DV", "SW", "DB", "DL", "PR", "SL", "PC", "FN", "CL", "CC", "PS"];
console.log(`E items ${rows.length}, residuals ${rows.length - dedup.length}, deduplicated ${dedup.length}`);
console.log("\nper area (deduplicated, then with residuals):");
for (const a of AREAS) console.log(`  ${a} ${dedup.filter((r) => r.area === a).length} ${rows.filter((r) => r.area === a).length}`);
console.log("\nper mechanism (deduplicated):", JSON.stringify(count(dedup, (r) => r.mech)));
const specs = [...new Set(dedup.map((r) => r.spec))].sort();
console.log("\narea x spec (deduplicated):\n  area " + specs.join(" "));
for (const a of AREAS) console.log(`  ${a}   ` + specs.map((s) => String(dedup.filter((r) => r.area === a && r.spec === s).length).padStart(3)).join(" "));
const periods = [["2026-10-01", "2026-10-09"], ["2026-10-09", "2026-10-13"], ["2026-10-13", "2026-10-17"], ["2026-10-17", "2026-10-21"], ["2026-10-21", "2026-10-25"]];
console.log("\narea x period (deduplicated; undated left out):\n  area " + periods.map(([a]) => a.slice(5)).join(" ") + " undated");
for (const a of AREAS) console.log(`  ${a}   ` + periods.map(([x, y]) => String(dedup.filter((r) => r.area === a && r.date && r.date >= x && r.date < y).length).padStart(5)).join(" ") + String(dedup.filter((r) => r.area === a && !r.date).length).padStart(6));
console.log("  all  " + periods.map(([x, y]) => String(dedup.filter((r) => r.date && r.date >= x && r.date < y).length).padStart(5)).join(" ") + String(dedup.filter((r) => !r.date).length).padStart(6));
// Cost. A FAIL round is a FAIL review file; a group touches it when one of its blockers is there.
const reviews = jl(reviewsPath).filter((r) => r.verdict.startsWith("FAIL"));
const key = (spec, file) => `${spec.slice(0, 3)}/${file}`;
const blockerGroups = new Map();
for (const r of rows.filter((r) => r.src === "review" && r.kind.startsWith("blocker"))) {
  const k = key(r.spec, r.where);
  (blockerGroups.get(k) ?? blockerGroups.set(k, new Set()).get(k)).add(r.group);
}
// All blockers of a FAIL round, any class, from 016-09's items: a round is the group's alone when
// every blocker in it is this group's.
const allBlockers = new Map();
for (const i of items.values()) if (i.src === "review" && i.kind.startsWith("blocker")) { const k = key(i.spec, i.where); allBlockers.set(k, (allBlockers.get(k) ?? 0) + 1); }
const groupBlockersIn = new Map();
for (const r of rows.filter((r) => r.src === "review" && r.kind.startsWith("blocker"))) { const k = `${r.group}|${key(r.spec, r.where)}`; groupBlockersIn.set(k, (groupBlockersIn.get(k) ?? 0) + 1); }
// Repair rows: board rows whose kind is review-repair-row or origin review-repair, mapped to the review files they cite.
const repair = jl(rowsPath).filter((r) => r.kind === "review-repair-row" || r.origin === "review-repair");
const cites = (r) => {
  const out = new Set();
  const own = /^\d{3}/.test(r.id) ? r.id.slice(0, 3) : "011";
  for (const m of r.text.matchAll(/(?:(\d{3})-[\w-]+\/)?reviews\/([\w.-]+\.md)/g)) out.add(key(m[1] ?? own, m[2]));
  return out;
};
const repairCites = repair.map((r) => ({ id: r.id, cites: cites(r) }));
console.log(`\nrepair rows ${repair.length}, of which citing a review file ${repairCites.filter((r) => r.cites.size).length}`);
const groups = count(dedup, (r) => r.group).filter(([, n]) => n >= 3);
console.log("\ngroups of three or more (deduplicated n; residuals; blockers incl. residuals; FAIL rounds touched; rounds that group alone failed; escaped rows; repair rows citing those rounds):");
const out = [];
for (const [g, n] of groups) {
  const all = rows.filter((r) => r.group === g);
  const blockers = all.filter((r) => r.src === "review" && r.kind.startsWith("blocker"));
  const rounds = new Set(blockers.map((r) => key(r.spec, r.where)));
  const alone = [...rounds].filter((k) => groupBlockersIn.get(`${g}|${k}`) === allBlockers.get(k)).length;
  const escaped = all.filter((r) => r.src !== "review").length;
  const repairs = repairCites.filter((r) => [...r.cites].some((c) => rounds.has(c))).length;
  out.push({ g, n, res: all.length - n, blockers: blockers.length, rounds: rounds.size, alone, escaped, repairs, ids: all.map((r) => r.id + (r.residual ? "*" : "")).join(" ") });
}
for (const o of out) console.log(`${o.g.padEnd(10)} n=${o.n} res=${o.res} blockers=${o.blockers} rounds=${o.rounds} alone=${o.alone} escaped=${o.escaped} repairRows=${o.repairs} :: ${o.ids}`);
const inGroups = out.reduce((s, o) => s + o.n, 0);
console.log(`\nitems in groups of three or more: ${inGroups} of ${dedup.length}`);
console.log("\nby FAIL rounds touched:"); for (const o of [...out].sort((a, b) => b.rounds - a.rounds || b.blockers - a.blockers).slice(0, 10)) console.log(`  ${o.g} rounds=${o.rounds} alone=${o.alone} blockers=${o.blockers} escaped=${o.escaped} repairRows=${o.repairs}`);
