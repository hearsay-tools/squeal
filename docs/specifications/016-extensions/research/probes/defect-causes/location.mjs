// Throwaway probe for 016-09: an objective cross-check of classes.tsv. For each review item,
// the first cited path's area, and whether its title names a validity error (a false or stale pass).
// Usage: node location.mjs <items.jsonl> <classes.tsv>
import { readFileSync } from "node:fs";

const [itemsPath, classesPath] = process.argv.slice(2);
const items = readFileSync(itemsPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const cls = new Map(readFileSync(classesPath, "utf8").trim().split("\n").map((l) => { const [id, p, s] = l.split("\t"); return [id, { p, s: s || "" }]; }));
const area = (p) => !p ? "none" : /^src\/runners\/observe/.test(p) ? "runners/observe" : /^src\/runners/.test(p) ? "runners" : /^src\/harness\/shared/.test(p) ? "harness/shared" : /^src\/harness/.test(p) ? "harness/<one>" : /^src\/core/.test(p) ? "core" : /^src\/cli/.test(p) ? "cli" : /^(test|evals)/.test(p) ? "test,evals" : "other";
const VALIDITY = /false (current )?pass|stale pass|old pass|stored as pass|as passed|current pass|pass(ing)? results? current|never enters? (any|a) key|in no key|absent from the key|unkeyed|inherit/i;
const tab = {};
const vtab = {};
for (const i of items.filter((i) => i.src === "review")) {
  const c = cls.get(i.id);
  if (!"ABCDEFG".includes(c.p) || c.p.length !== 1) continue;
  const a = area(i.paths[0]);
  tab[a] ??= {};
  tab[a][c.p] = (tab[a][c.p] ?? 0) + 1;
  if (VALIDITY.test(i.title)) { vtab[a] ??= {}; vtab[a][c.p] = (vtab[a][c.p] ?? 0) + 1; }
}
const show = (t) => { for (const [a, c] of Object.entries(t).sort()) console.log(a.padEnd(16), Object.values(c).reduce((x, y) => x + y, 0), JSON.stringify(c)); };
console.log("review items by first cited path, then primary class"); show(tab);
console.log("\nreview items whose title names a validity error (false, stale or inherited pass; an input in no key)"); show(vtab);
