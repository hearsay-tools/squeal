#!/usr/bin/env node
// Throwaway probe, row 011-435. Reads the run folders run.sh wrote (fetched under data/<sandbox>/)
// and prints one row per run and one line per arm. Plain Node, runs on the host: it only reads files.
// Usage: node summarize.mjs data  (default: the data folder beside this script)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The G1 files of the census (ci-flake-census.md, G1 paragraph; wave-131.md row 011-429).
const G1 = [
  "writer-turns", "chain-load", "keep-early", "busy-requests", "departure", "backlog-slots",
  "prune-vacuum", "ci-map-client-clock", "graph-cost", "retry/records", "not-current",
  "why-unknown-standing", "status-paths", "status-at-now-daemon", "warmup", "status-wait-paused",
  "run-group", "stop-slow-wait", "stop-group-mixed", "environment-growth-siblings", "slow-node-test",
];
const isG1 = (file) => G1.some((name) => file.endsWith(`/${name}.test.ts`));

const root = process.argv[2] ?? join(import.meta.dirname, "data");
const rows = [];
for (const sandbox of readdirSync(root).sort()) {
  for (const out of readdirSync(join(root, sandbox)).filter((d) => d.startsWith("out")).sort()) {
    for (const run of readdirSync(join(root, sandbox, out)).sort()) {
      const dir = join(root, sandbox, out, run);
      if (!existsSync(join(dir, "meta.json"))) continue;
      const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
      // The full log on a sandbox; the committed cut keeps its FAIL lines and final summary.
      const full = join(dir, "vitest.log");
      const log = readFileSync(existsSync(full) ? full : join(dir, "vitest-summary.log"), "utf8");
      // Vitest's summary lists each failed test once: " FAIL  |project| path > suite > test". The log
      // also holds the output of Vitest runs that tests start on fixtures; only this repository's
      // projects (vitest.config.ts) name the shard's own failures, and its summary comes last.
      const failed = [...new Set(log.split("\n").filter((l) => /^ FAIL\s+\|(unit|unit-isolated|isolated)\| /.test(l)).map((l) => l.trim()))];
      const last = (re) => [...log.matchAll(re)].at(-1)?.[1];
      const files = [...new Set(failed.map((l) => l.split(/\s+/)[2]))];
      const samples = readFileSync(join(dir, "samples.txt"), "utf8").trim().split("\n")
        .map((l) => l.split(" ").map(Number)).filter((s) => s.length === 6);
      const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
      rows.push({
        sandbox, out, run, arm: meta.arm, exit: meta.exit,
        seconds: Math.round(meta.end - meta.start),
        vitestDuration: last(/Duration\s+([\d.]+)s/g) ?? "?",
        tests: last(/^\s+Tests\s+(.*)$/gm)?.trim() ?? "?",
        failedTests: failed.length,
        g1Files: files.filter(isG1),
        otherFiles: files.filter((f) => !isG1(f)),
        peakWorkers: Math.max(...samples.map((s) => s[4])),
        meanLoad1: mean(samples.map((s) => s[1])).toFixed(1),
        minMemMiB: Math.min(...samples.map((s) => s[5])),
        strays: meta.strays,
      });
    }
  }
}
console.log("| Sandbox | Run | Arm | Exit | Wall s | Vitest s | Peak workers | Mean load | Min free MiB | Tests | Failed tests | G1 files failed | Other files failed |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows)
  console.log(`| ${r.sandbox} | ${r.out}/${r.run} | ${r.arm} | ${r.exit} | ${r.seconds} | ${r.vitestDuration} | ${r.peakWorkers} | ${r.meanLoad1} | ${r.minMemMiB} | ${r.tests} | ${r.failedTests} | ${r.g1Files.join(", ") || "none"} | ${r.otherFiles.join(", ") || "none"} |`);
for (const arm of ["D", "2", "F"]) {
  const of = rows.filter((r) => r.arm === arm);
  if (of.length === 0) continue;
  const secs = of.map((r) => r.seconds).sort((a, b) => a - b);
  console.log(`\narm ${arm}: ${of.length} runs, wall s median ${secs[Math.floor(secs.length / 2)]} (min ${secs[0]}, max ${secs.at(-1)}), runs with a failure ${of.filter((r) => r.exit !== 0).length}, runs with a G1 failure ${of.filter((r) => r.g1Files.length > 0).length}`);
}
// Paired difference: each run folder's runs in order (warm-up left out), two adjacent runs one pair.
for (const kind of ["2", "F"]) {
  const pairs = [];
  for (const key of [...new Set(rows.map((r) => `${r.sandbox}/${r.out}`))]) {
    const seq = rows.filter((r) => `${r.sandbox}/${r.out}` === key && r.arm !== "W");
    for (let i = 0; i + 1 < seq.length; i += 2) {
      const d = seq.slice(i, i + 2).find((r) => r.arm === "D");
      const two = seq.slice(i, i + 2).find((r) => r.arm === kind);
      if (d && two) pairs.push({ key, ratio: two.seconds / d.seconds });
    }
  }
  if (pairs.length)
    console.log(`\npairs D/${kind} ${pairs.length}: ${kind} / default wall ratio ${pairs.map((p) => `${p.key} ${p.ratio.toFixed(2)}`).join(", ")}; mean ${(pairs.reduce((a, p) => a + p.ratio, 0) / pairs.length).toFixed(3)}`);
}
