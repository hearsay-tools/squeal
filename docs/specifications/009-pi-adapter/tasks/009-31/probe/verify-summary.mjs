#!/usr/bin/env node
// Row 009-31: one row per latency test run in verify-loop.sh's log: kind, exit,
// whether the bound was asserted, and the fresh-worker row. Usage: node verify-summary.mjs <log>
import { readFileSync } from "node:fs";

const runs = [];
let cur = null;
for (const line of readFileSync(process.argv[2], "utf8").split("\n")) {
  const head = /^=== (\S+) (\S+) (real|lifted) (\d+) (\S+)/.exec(line);
  if (head) {
    cur = { at: head[1], kind: head[3], round: Number(head[4]), loadBefore: Number(head[5]) };
    runs.push(cur);
    continue;
  }
  if (cur === null) continue;
  const exit = /^=== exit (\d+)/.exec(line);
  if (exit) cur.exit = Number(exit[1]);
  const title = /round trip ms, .*load (\S+) \S+ \S+(.*)$/.exec(line);
  if (title) {
    cur.loadAfter = Number(title[1]);
    cur.asserted = !title[2].includes("reported only");
  }
  const row = /'boundary on a fresh worker' │ +([\d.]+) +│ +([\d.]+) +│ +([\d.]+)/.exec(line);
  if (row) [cur.p50, cur.p95, cur.max] = row.slice(1, 4).map(Number);
}
console.table(runs);
for (const kind of ["real", "lifted"]) {
  const some = runs.filter((r) => r.kind === kind && r.exit !== undefined);
  const passed = some.filter((r) => r.exit === 0).length;
  const asserted = some.filter((r) => r.asserted).length;
  const p95s = some.map((r) => r.p95).sort((a, b) => a - b);
  console.log(
    `${kind}: ${passed} of ${some.length} passed, ${asserted} asserted; fresh p95 ` +
      `${p95s[0]} to ${p95s.at(-1)}, median ${p95s[Math.floor(p95s.length / 2)]}`,
  );
}
