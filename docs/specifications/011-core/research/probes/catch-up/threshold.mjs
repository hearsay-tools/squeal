// THROWAWAY probe (011-core/research/catch-up.md). From results/explained.json and
// results/revisions.json: keyed sources changed per revision (a test file or a path in some
// closure), and fast test files re-keyed, for revisions in a HEAD move and the rest, with how
// many revisions each candidate threshold would put on the catch-up route.
import { readFileSync, writeFileSync } from "node:fs";
const ex = JSON.parse(readFileSync(new URL("results/explained.json", import.meta.url)));
const rv = new Map(JSON.parse(readFileSync(new URL("results/revisions.json", import.meta.url))).map((r) => [`${r.wt}:${r.n}`, r]));
const rows = ex.map((e) => ({ ...e, rekeyed: rv.get(`${e.wt}:${e.n}`).rekeyed }));
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const groups = { "in a HEAD move": rows.filter((r) => r.inMove), "no HEAD move": rows.filter((r) => !r.inMove) };
for (const [name, g] of Object.entries(groups)) {
  const k = g.map((r) => r.keyed), rk = g.map((r) => r.rekeyed);
  console.log(`${name}: ${g.length} revisions; keyed sources p50 ${q(k, .5)}, p90 ${q(k, .9)}, p99 ${q(k, .99)}, max ${Math.max(...k)}; fast files re-keyed p50 ${q(rk, .5)}, p90 ${q(rk, .9)}, max ${Math.max(...rk)}`);
}
console.log("\nno HEAD move, keyed sources >= 5:");
for (const r of groups["no HEAD move"].filter((r) => r.keyed >= 5)) console.log(`  ${r.wt} r${r.n} ${r.at} ${r.trigger}: changed ${r.changed}, keyed ${r.keyed}, re-keyed ${r.rekeyed}`);
console.log("\nthreshold T on keyed sources changed: revisions at or above T");
const table = [];
for (const T of [5, 10, 20, 30, 50, 100]) {
  const move = groups["in a HEAD move"].filter((r) => r.keyed >= T), rest = groups["no HEAD move"].filter((r) => r.keyed >= T);
  table.push({ T, moves: move.length, movesRekeyed: move.reduce((a, r) => a + r.rekeyed, 0), noMove: rest.length, noMoveRekeyed: rest.reduce((a, r) => a + r.rekeyed, 0) });
}
console.table(table);
writeFileSync("results/threshold.json", JSON.stringify(table, null, 1));
