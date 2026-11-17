// Throwaway probe for row 005-99 (see README.md). Read-only. Joins watch-starts.sh output with
// the daemon logs: for each daemon first seen at age 15 s or less, its CPU seconds and private
// memory at the last sample before its "serving" line, and the 1-minute load then.
// Usage: node start-cpu.mjs starts.tsv <repo-dir>...
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { daemons } from "./lib.mjs";

const rows = readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => l.split("\t"));
const serving = new Map();
for (const repo of process.argv.slice(3)) {
  for (const list of daemons(join(repo, ".git/squeal/logs")).byLog.values()) {
    for (const p of list) if (p.serving !== null) serving.set(p.pid.split(":")[1], { at: p.serving, stop: p.stop, root: p.root });
  }
}
const byPid = new Map();
for (const [at, pid, age, cpu, priv, load, label] of rows) {
  if (!byPid.has(pid)) byPid.set(pid, []);
  byPid.get(pid).push({ at: Date.parse(at), age: Number(age), cpu: Number(cpu), priv: Number(priv), load: Number(load), label });
}
for (const [pid, samples] of byPid) {
  if (samples[0].age > 15) continue;
  const s = serving.get(pid);
  if (s === undefined) continue;
  const before = samples.filter((x) => x.at <= s.at).pop();
  if (before === undefined) continue;
  const spawned = samples[0].at - samples[0].age * 1000;
  console.log(JSON.stringify({
    pid, label: samples[0].label, main: !s.root.includes("/worktrees/"),
    toServingS: Math.round((s.at - spawned) / 1000), cpuS: before.cpu, privMiB: before.priv,
    maxPrivMiB: Math.max(...samples.map((x) => x.priv)), load: before.load,
    stoppedAfterServingS: s.stop === null ? null : Math.round((s.stop - s.at) / 1000),
  }));
}
