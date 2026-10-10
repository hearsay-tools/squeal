#!/usr/bin/env node
// Throwaway probe for 005-06. Runs a plan of cells, at most N at once, each started only while
// the one-minute load average is below the limit (held cells wait and retry every 30 s).
//   node batch.mjs <plan.txt> [--parallel 2] [--max-load 24]
// A plan line: <task> <variant> <claude|codex> <model> [rep] [--cold]; `#` starts a comment.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { loadavg } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const parallel = Number(opt("--parallel", "2"));
const maxLoad = Number(opt("--max-load", "24"));
const plan = readFileSync(argv[0], "utf8").split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cell(line) {
  for (;;) {
    while (loadavg()[0] >= maxLoad) { console.log(`hold (load ${loadavg()[0].toFixed(1)}): ${line}`); await sleep(30_000); }
    const code = await new Promise((resolve) => {
      const c = spawn("node", [join(HERE, "run-cell.mjs"), ...line.split(/\s+/), "--max-load", String(maxLoad)], { stdio: "inherit" });
      c.on("close", resolve);
    });
    if (code !== 75) return code;
    await sleep(30_000);
  }
}

const queue = [...plan];
await Promise.all(Array.from({ length: parallel }, async (_, w) => {
  await sleep(w * 20_000); // stagger the warm-ups
  while (queue.length) await cell(queue.shift());
}));
console.log("batch done");
