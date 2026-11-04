#!/usr/bin/env node
// Throwaway probe for 019-17 (open question 7, row 019-19). Not product code. Runs as agent.
//   node cycles.mjs <commit> <cycles> <out.jsonl>
// In the fixture clone, as squeal-e2e: reset to <commit>, a new store, `squeal start`, `squeal
// run --all --wait`; then per cycle a new src/delay.ts (which only the e2e file reads, so the
// unit lane does not run), `squeal run e2e --wait`, 70 s for the e2e lane's Vitest instance to
// close (60 s after its last run, 019-12), and the daemon's RSS, RssAnon and heap after two
// forced GCs (mem.mjs --gc). One JSON line per cycle.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [commit, cycles, out] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const R = "/home/squeal-e2e/runs/d1917";
const CWD = `${R}/fixture`;
const as = (...args) =>
  execFileSync("node", [join(here, "as-e2e.mjs"), R, CWD, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const mem = () => JSON.parse(execFileSync("node", [join(here, "mem.mjs"), CWD, "--gc"], { encoding: "utf8" }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
as("git", "checkout", "-q", "-f", "fix-h2");
as("git", "reset", "-q", "--hard", commit);
as("squeal", "stop");
as("rm", "-rf", ".git/squeal");
as("squeal", "start");
as("squeal", "run", "--all", "--wait", "300000");
await sleep(70000);
appendFileSync(out, `${JSON.stringify({ cycle: 0, load1: Number(execFileSync("cut", ["-d ", "-f1", "/proc/loadavg"], { encoding: "utf8" })), ...mem() })}\n`);
for (let n = 1; n <= Number(cycles); n++) {
  as("node", "-e", "require('fs').writeFileSync('src/delay.ts', `// cycle ${process.argv[1]}\\nexport const DELAY_MS = 1000;\\n`)", String(n));
  const t = Date.now();
  as("squeal", "run", "e2e", "--wait", "120000");
  const runS = (Date.now() - t) / 1000;
  await sleep(70000);
  appendFileSync(out, `${JSON.stringify({ cycle: n, runS, load1: Number(execFileSync("cut", ["-d ", "-f1", "/proc/loadavg"], { encoding: "utf8" })), ...mem() })}\n`);
}
as("git", "reset", "-q", "--hard", commit);
