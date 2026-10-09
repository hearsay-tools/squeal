// Medians per repository, case and kind of sample from measure.mjs's JSON lines.
// node summary.mjs <file.jsonl>...
import { readFileSync } from "node:fs";
import { basename } from "node:path";
const med = (xs) => {
  const v = xs.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
  if (v.length === 0) return "-";
  const m = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  return (m / 1000).toFixed(1);
};
const stages = ["watcher", "runnerPart", "queueWait", "tierStart", "run", "record", "delivery", "resultAfterEdit", "waitReturned"];
const parts = ["watcher", "runnerPart", "queueWait", "tierStart", "run", "record", "delivery"];
const labels = { "a-idle": "(a) idle", "b-baseline": "(b) baseline", "c-backlog": "(c) run --all --force", "c-env": "(c) config-edit backlog", "d-slow": "(d) slow file" };
const label = (c) => (c.endsWith("+8") ? `${labels[c.slice(0, -2)]} +8 burners` : labels[c] ?? c);
const medN = (xs) => { const v = xs.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : -1; };
console.log(`| repo | case | sample | n | load | ${stages.join(" | ")} | dominant | wait outcomes |`);
console.log(`|${" --- |".repeat(stages.length + 6)}`);
for (const file of process.argv.slice(2)) {
  const rows = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const groups = new Map();
  for (const r of rows) {
    const kind = r.hitAt !== null && r.hitAt !== undefined ? "lookup" : r.mode === "neutral" ? "run, no news" : "run, news";
    const k = `${r.case}|${kind}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const [k, rs] of groups) {
    const [c, kind] = k.split("|");
    const loads = rs.map((r) => r.load0).sort((a, b) => a - b);
    const outcomes = {};
    for (const r of rs) {
      const stale = r.wait && r.revision && r.wait.revision < r.revision.number ? " (before the edit's revision)" : "";
      const o = `${r.wait?.outcome}${stale}`;
      outcomes[o] = (outcomes[o] ?? 0) + 1;
    }
    const cells = stages.map((s) => med(rs.map((r) => r.stages[s])));
    const dominant = parts.map((p) => [p, medN(rs.map((r) => r.stages[p]))]).sort((x, y) => y[1] - x[1])[0][0];
    console.log(`| ${basename(file, ".jsonl")} | ${label(c)} | ${kind} | ${rs.length} | ${Math.round(loads[0])} to ${Math.round(loads.at(-1))} | ${cells.join(" | ")} | ${dominant} | ${Object.entries(outcomes).map(([o, n]) => `${o} ${n}`).join(", ")} |`);
  }
}
