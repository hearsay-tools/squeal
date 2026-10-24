// Throwaway probe for 016-11: items per kind of catch (catch.tsv, this researcher's reading) over
// the groups of three or more. Usage: node catch.mjs <areas.tsv> <catch.tsv> <items.jsonl>
import { readFileSync } from "node:fs";

const [areasPath, catchPath, itemsPath] = process.argv.slice(2);
const RESIDUAL = /residual|still|remains|remaining|prior|again|partially|unchanged|reproduction fixed/i;
const items = new Map(readFileSync(itemsPath, "utf8").trim().split("\n").map((l) => { const i = JSON.parse(l); return [i.id, i]; }));
const n = {};
const blockers = {};
for (const l of readFileSync(areasPath, "utf8").trim().split("\n")) {
  const [id, a, m] = l.split("\t");
  const i = items.get(id);
  if (i.src === "review" && i.kind.startsWith("blocker")) blockers[`${a}.${m}`] = (blockers[`${a}.${m}`] ?? 0) + 1;
  if (i.src === "review" && RESIDUAL.test(i.title) && id !== "R213") continue;
  n[`${a}.${m}`] = (n[`${a}.${m}`] ?? 0) + 1;
}
const by = {};
for (const l of readFileSync(catchPath, "utf8").trim().split("\n")) {
  const [g, kind] = l.split("\t");
  const k = (by[kind] ??= { groups: 0, items: 0, blockers: 0 });
  k.groups++; k.items += n[g] ?? 0; k.blockers += blockers[g] ?? 0;
}
for (const [k, v] of Object.entries(by).sort((a, b) => b[1].items - a[1].items)) console.log(`${k.padEnd(8)} groups ${v.groups} items ${v.items} blockers ${v.blockers}`);
