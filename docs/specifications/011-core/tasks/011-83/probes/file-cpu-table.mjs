// Tabulates file-cpu.sh's log: node file-cpu-table.mjs logs/file-cpu.tsv
import { readFileSync } from "node:fs";
const lines = readFileSync(process.argv[2], "utf8").trim().split("\n").slice(1);
const by = new Map();
for (const line of lines) {
  const [file, , load, wall, user, sys, code] = line.split("\t");
  const list = by.get(file) ?? [];
  list.push({ load: Number(load), wall: Number(wall), cpu: Number(user) + Number(sys), code });
  by.set(file, list);
}
const r = (xs) => `${Math.min(...xs).toFixed(2)} to ${Math.max(...xs).toFixed(2)}`;
const x = (xs) => (Math.max(...xs) / Math.min(...xs)).toFixed(2);
console.log("| File | Load | Wall s | CPU s | Cores | Wall max/min | CPU max/min |");
console.log("| --- | --- | --- | --- | --- | --- | --- |");
for (const [file, runs] of by) {
  const loads = runs.map((q) => q.load);
  console.log(`| \`${file}\` | ${Math.min(...loads).toFixed(0)} to ${Math.max(...loads).toFixed(0)} | ${r(runs.map((q) => q.wall))} | ${r(runs.map((q) => q.cpu))} | ${r(runs.map((q) => q.cpu / q.wall))} | ${x(runs.map((q) => q.wall))} | ${x(runs.map((q) => q.cpu))} |${runs.some((q) => q.code !== "0") ? " a run failed" : ""}`);
}
