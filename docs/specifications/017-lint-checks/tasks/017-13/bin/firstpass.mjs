#!/usr/bin/env node
// Throwaway probe for 017-13. Not product code.
//   node firstpass.mjs <repo> [<name> <cmd>...]      repo: saas or svelte
// A repository's first lint pass: sampler.mjs on the clone's daemon, then `squeal start` (or
// <cmd>, run as squeal-e2e in the clone, with outputs under firstpass/<name>), then `squeal status --json` every 2 s until lint reports no `linting`, no
// `pending` and no `stale` file (or 30 min). Writes logs/firstpass/<repo>/{samples.jsonl,
// polls.jsonl,meta.json,lint.txt,status.txt}. Starts only at a one-minute load of 24 or below.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [repo, name0, ...trigger0] = process.argv.slice(2);
const name = name0 ?? repo;
const trigger = trigger0.length > 0 ? trigger0 : ["squeal", "start"];
if (!["saas", "svelte"].includes(repo ?? "")) process.exit(2);
const here = dirname(fileURLToPath(import.meta.url));
const W = "/tmp/dogfood-017-13/w-4a90e840";
const R = "/home/squeal-e2e/runs/d1713";
const CWD = `${R}/${repo}`;
const out = join(W, "logs", "firstpass", name);
mkdirSync(out, { recursive: true });
const load1 = () => Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]);
const as = (args) => {
  try {
    return execFileSync("node", [join(here, "as-e2e.mjs"), R, CWD, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    return `${e.stdout ?? ""}${e.stderr ?? ""}(exit ${e.status})`;
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const meta = { repo, name, trigger, gate: [] };
while (load1() > 24) {
  meta.gate.push({ at: new Date().toISOString(), load1: load1() });
  await sleep(30000);
}
const sampler = spawn("node", [join(here, "sampler.mjs"), join(out, "samples.jsonl"), CWD, "250"], { stdio: "ignore" });
await sleep(500);
meta.loadAtStart = load1();
meta.start = new Date().toISOString();
const t0 = Date.now();
meta.startOut = as(trigger).trim().split("\n").slice(-3).join(" | ");
meta.triggerDoneS = (Date.now() - t0) / 1000;
let done = false;
while (!done && Date.now() - t0 < 30 * 60000) {
  await sleep(2000);
  const raw = as(["squeal", "status", "--json"]);
  let lint = null;
  try {
    lint = JSON.parse(raw).lint ?? null;
  } catch {}
  appendFileSync(join(out, "polls.jsonl"), `${JSON.stringify({ t: Date.now() - t0, load1: load1(), lint })}\n`);
  if (lint && !lint.linting && lint.pending === 0 && lint.stale === 0 && lint.files > 0) done = true;
}
meta.doneS = (Date.now() - t0) / 1000;
meta.finished = done;
meta.loadAtEnd = load1();
await sleep(2000);
sampler.kill("SIGTERM");
writeFileSync(join(out, "status.txt"), as(["squeal", "status"]));
writeFileSync(join(out, "lint.txt"), as(["squeal", "lint"]));
writeFileSync(join(out, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
console.log(JSON.stringify(meta));
