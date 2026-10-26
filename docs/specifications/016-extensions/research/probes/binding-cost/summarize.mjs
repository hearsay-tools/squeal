// Throwaway probe for 016-34: medians and spreads of samples.jsonl (argv[2]).
// Spread: p10 to p90 and min to max. Nearest-rank percentiles.
import { readFileSync } from "node:fs";

const rows = readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));
const q = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
};
const f = (x) => (x === undefined || x === null ? "-" : x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2));
const groups = new Map();
for (const r of rows) {
  const k = `${r.mode} ${r.check ?? "-"} ${r.binding}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}
const stat = (rs, field) => {
  const xs = rs.map((r) => r[field]).filter((x) => typeof x === "number");
  if (xs.length === 0) return "-";
  return `${f(q(xs, 0.5))} [${f(q(xs, 0.1))}–${f(q(xs, 0.9))}] (${f(Math.min(...xs))}–${f(Math.max(...xs))})`;
};
console.log("| mode | check | binding | n | load1 range | wall ms | CPU ms (host+provider) | host CPU ms | provider CPU ms | provider RSS MB |");
console.log("|---|---|---|---|---|---|---|---|---|---|");
for (const [k, rs] of groups) {
  const [mode, check, binding] = k.split(" ");
  const loads = rs.map((r) => r.load1);
  if (mode === "hint") continue;
  console.log(
    `| ${mode} | ${check} | ${binding} | ${rs.length} | ${f(Math.min(...loads))}–${f(Math.max(...loads))} | ${stat(rs, "wallMs")} | ${stat(rs, "cpuMs")} | ${stat(rs, "hostCpuMs")} | ${stat(rs, "remoteCpuMs")} | ${stat(rs, "remoteRssMb")} |`,
  );
}
console.log("\n| hint binding | n | load1 range | wall µs/call | CPU µs/call |\n|---|---|---|---|---|");
for (const [k, rs] of groups) {
  const [mode, , binding] = k.split(" ");
  if (mode !== "hint") continue;
  const loads = rs.map((r) => r.load1);
  console.log(`| ${binding} | ${rs.length} | ${f(Math.min(...loads))}–${f(Math.max(...loads))} | ${stat(rs, "wallUsPerCall")} | ${stat(rs, "cpuUsPerCall")} |`);
}
const waits = rows.filter((r) => r.gateWaitS > 0);
console.log(`\nsamples: ${rows.length}; gate waits: ${waits.length} (${waits.reduce((a, r) => a + r.gateWaitS, 0)} s)`);
