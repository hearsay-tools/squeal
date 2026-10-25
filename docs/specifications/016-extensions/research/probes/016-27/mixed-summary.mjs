// Throwaway probe (016-27), question 5: summarises mixed-names.sh output. Per directory: the distinct
// sets of ignored names across worktrees (how many keys the directory would take if ignored names were
// keyed), and how many worktrees gained such a name today (one key move each, a name's birth).
import { readFileSync } from "node:fs";
const [file, day] = process.argv.slice(2);
const dirs = new Map();
for (const line of readFileSync(file, "utf8").trim().split("\n")) {
  const [wt, dir, rest] = line.split("\t");
  const d = dirs.get(dir) ?? { worktrees: 0, absent: 0, sets: new Map(), bornToday: 0 };
  d.worktrees++;
  if (rest === "absent") { d.absent++; dirs.set(dir, d); continue; }
  const names = rest === "none" ? [] : rest.trim().split(/ (?=[^ ]+@)/).map((x) => x.split("@"));
  const set = names.map(([n]) => n).sort().join(",") || "(none)";
  d.sets.set(set, (d.sets.get(set) ?? 0) + 1);
  d.bornToday += names.filter(([, at]) => at.startsWith(day)).length;
  dirs.set(dir, d);
}
for (const [dir, d] of dirs)
  console.log(JSON.stringify({ dir, worktrees: d.worktrees, absent: d.absent, nameSets: Object.fromEntries(d.sets), namesBornToday: d.bornToday }));
