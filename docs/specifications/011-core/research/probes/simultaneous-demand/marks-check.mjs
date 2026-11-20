// marks-check.mjs [label...]: per two-daemon run (row 011-420), from
// results/<label>.marks.tsv (every pool mark each second, marks.sh): per
// daemon's mark, from the edit (edits.tsv), the first second its mark stated
// 5 or more workers of demand beyond its grant (want - grant >= 5: a waiter,
// or a quiet's demand in arms q and qc; a node:test slot holds 1 beside),
// its first backlog grant of 3 or more, and the other daemon's mark then. Run from this directory: node marks-check.mjs S-q-1
import { readFileSync, readdirSync } from "node:fs";
const R = new URL("./results/", import.meta.url).pathname;
const labels = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(R).filter((f) => /^S-.*\.marks\.tsv$/.test(f)).map((f) => f.replace(".marks.tsv", "")).sort();
for (const label of labels) {
  const e0 = +readFileSync(`${R}${label}.edits.tsv`, "utf8").split("\t")[0];
  const rows = readFileSync(`${R}${label}.marks.tsv`, "utf8").trim().split("\n").map((l) => l.split("\t")).filter((r) => r.length === 3 && r[2].startsWith("{")).map(([t, name, j]) => ({ t: (+t - e0) / 1000, name, ...JSON.parse(j) })).filter((r) => r.t >= 0);
  const names = [...new Set(rows.map((r) => r.name))];
  const at = (name, t) => rows.filter((r) => r.name === name && Math.abs(r.t - t) < 1.1).at(-1);
  const out = names.map((name) => {
    const mine = rows.filter((r) => r.name === name);
    const demand = mine.find((r) => r.want - r.grant >= 5);
    const granted = mine.find((r) => r.grant >= 3);
    const other = names.find((n) => n !== name);
    const o = granted && other ? at(other, granted.t) : undefined;
    return `${name.slice(-6)}: unmet demand ${demand ? `${demand.t.toFixed(0)} s want ${demand.want} grant ${demand.grant}` : "never"}; first grant >= 3 ${granted ? `${granted.t.toFixed(0)} s grant ${granted.grant} want ${granted.want}` : "never"}; other's mark then ${o ? `want ${o.want} grant ${o.grant}` : "none"}`;
  });
  // Each change of a mark's want or grant from 100 s to 220 s after the edit: the quiets' ends.
  const seen = new Map();
  const changes = [];
  for (const r of rows.filter((x) => x.t >= 100 && x.t <= 220)) {
    const v = `${r.want}/${r.grant}`;
    if (seen.get(r.name) !== v) changes.push(`${r.t.toFixed(0)}s ${r.name.slice(-6)} want/grant ${v}`);
    seen.set(r.name, v);
  }
  console.log(`${label}\n  ${out.join("\n  ")}\n  changes 100-220 s: ${changes.join("; ")}`);
}
