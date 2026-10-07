// Throwaway probe (001-102): folds scenarios.sh output and a fixture trace into scenarios.md's table.
// Usage: node table.mjs <scenarios.txt> <fixture-trace.json>
import { readFileSync } from "node:fs";
const [scen, tracePath] = process.argv.slice(2);
const trace = JSON.parse(readFileSync(tracePath, "utf8"));
const short = (files, all) => (all ? "all (environment-wide)" : files.map((f) => f.replace("test/", "").replace(".test.js", "")).join(", ") || "none");
console.log("| bumped | outcome changed in | first hop re-keys | graph re-keys | missed by graph | missed by graph plus trace |");
console.log("|---|---|---|---|---|---|");
for (const line of readFileSync(scen, "utf8").trim().split("\n").filter((l) => l.includes(" | failing:"))) {
  const [pkg, f, j] = line.split(" | ");
  const fail = f.replace("failing:", "").trim().split(" ").filter(Boolean);
  const r = JSON.parse(j);
  const env = !r.envSame[":graph"];
  const graph = new Set(r.changed.graph ?? []);
  const traced = Object.entries(trace).filter(([, pkgs]) => pkgs.includes(pkg)).map(([file]) => file);
  const both = new Set([...graph, ...traced]);
  console.log(`| ${pkg} | ${short(fail)} | ${short(r.changed.hop ?? [], env)} | ${short([...graph], env)} | ${short(fail.filter((x) => !graph.has(x)))} | ${short(fail.filter((x) => !both.has(x)))} |`);
}
