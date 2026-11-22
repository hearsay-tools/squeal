#!/usr/bin/env node
// Throwaway probe for 023-44 (023-28's batch.mjs). Not product code. Runs sessions on the lab VM,
// at most N at once:
//
//   node batch.mjs [--parallel 3] [--keep] [--prepared] <id>...
//
// Each session: `sh setup.sh prepare <id>` (a fresh clone), `node session.mjs <id>`, then
// `sh setup.sh remove <id>` unless --keep. --prepared skips the prepare step (clones made before,
// by hand). A session starts only while the 1-minute load is
// below the CPU count (checked every 15 s), no <work>/STOP file exists, and the cost of the
// sessions in <work>/logs stays under $8 (the brief's stop line). Each start is logged to <work>/logs/batch.log with the
// load seen.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const W = dirname(here);
const logs = join(W, "logs");
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const [, v] = argv.splice(i, 2);
  return v;
};
const parallel = Number(flag("--parallel") ?? 3);
const keep = argv.includes("--keep");
const prepared = argv.includes("--prepared");
const queue = argv.filter((a) => a !== "--keep" && a !== "--prepared");
if (parallel < 1 || parallel > 3) throw new Error("at most 3 sessions at once");
for (const id of queue) if (!/^s[12]-\d\d$/.test(id)) throw new Error(`bad id ${id}`);
const n = cpus().length;
const load = () => Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]);
const log = (line) => {
  const text = `${new Date().toISOString()} ${line}`;
  appendFileSync(join(logs, "batch.log"), `${text}\n`);
  console.log(text);
};
const spent = () => {
  let usd = 0;
  for (const d of readdirSync(logs, { withFileTypes: true })) {
    const f = join(logs, d.name, "stream.jsonl");
    if (!d.isDirectory() || !existsSync(f)) continue;
    // total_cost_usd is cumulative over a session: its last result event holds the session's cost.
    let last = 0;
    for (const raw of readFileSync(f, "utf8").split("\n")) {
      const ev = raw.slice(raw.indexOf("\t") + 1);
      if (ev.includes('"type":"result"')) last = JSON.parse(ev).total_cost_usd ?? last;
    }
    usd += last;
  }
  return usd;
};
const run = (cmd, args, file) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: here, stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    child.stdout.on("data", (d) => (text += d));
    child.stderr.on("data", (d) => (text += d));
    child.on("exit", (code) => {
      if (file) writeFileSync(file, text);
      resolve(code);
    });
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function one(id) {
  const t = Date.now();
  const prep = prepared ? 0 : await run("sh", [join(here, "setup.sh"), "prepare", id], join(logs, `${id}.prepare.txt`));
  if (prep !== 0) {
    log(`${id} prepare failed (exit ${prep}); see ${id}.prepare.txt`);
    return;
  }
  log(`${id} prepared in ${((Date.now() - t) / 1000).toFixed(0)} s; session starts, load ${load()}`);
  const code = await run("node", [join(here, "session.mjs"), id], join(logs, `${id}.session.txt`));
  log(`${id} session ended (exit ${code}) after ${((Date.now() - t) / 1000).toFixed(0)} s; spent $${spent().toFixed(2)}`);
  if (!keep) await run("sh", [join(here, "setup.sh"), "remove", id]);
}

const running = new Set();
while (queue.length > 0) {
  if (existsSync(join(W, "STOP"))) {
    log(`STOP file: ${queue.length} sessions not started: ${queue.join(" ")}`);
    break;
  }
  if (spent() >= 8) {
    log(`cost $${spent().toFixed(2)} reached $8: ${queue.length} sessions not started: ${queue.join(" ")}`);
    break;
  }
  if (running.size >= parallel || load() >= n) {
    await sleep(15_000);
    continue;
  }
  const id = queue.shift();
  log(`${id} start, load ${load()} of ${n} CPUs, ${running.size} running`);
  const p = one(id).finally(() => running.delete(p));
  running.add(p);
  // Let the new session's install and daemon show in the load before the next start.
  await sleep(45_000);
}
await Promise.all(running);
log("batch done");
