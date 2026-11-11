// Throwaway (row 021-02). Local driver: appends a marker line to a tracked file and measures
// (a) save -> file on the remote with Mutagen's watching alone, and (b) save -> `mutagen sync flush`
// returns, and save -> file on the remote, when the client flushes right after the save.
// Host and container share one kernel clock. Usage: node latency.mjs <case> <n> ; prints JSON lines.
import { appendFileSync, readFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";
const RE = process.env.RE;
const local = `${RE}/local/squeal`;
const [mode, nArg] = process.argv.slice(2);
const n = Number(nArg ?? 5);
const remote = spawn(`${RE}/sshwrap/ssh`, ["remote", "node", "/probe/remote-watch.mjs", "/work/squeal"]);
const seen = new Map();
let waiter = null;
createInterface({ input: remote.stdout }).on("line", (l) => {
  const [m, t] = l.split(" "); seen.set(m, Number(t)); if (waiter && waiter.m === m) waiter.resolve(Number(t));
});
const waitFor = (m, ms) => new Promise((resolve) => {
  if (seen.has(m)) return resolve(seen.get(m));
  waiter = { m, resolve }; setTimeout(() => resolve(null), ms);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const files = execFileSync("git", ["ls-files", "src/core"], { cwd: local, encoding: "utf8" }).trim().split("\n").filter((f) => f.endsWith(".ts"));
await sleep(1500);
for (let i = 0; i < n; i++) {
  // hot: the same file every time; cold: a file this probe has not touched before.
  const path = mode.startsWith("hot") ? files[0] : files[10 + i * 7 + (mode.endsWith("flush") ? 3 : 0)];
  const marker = `m${process.pid}x${i}x${Date.now()}`;
  remote.stdin.write(`${path} ${marker}\n`);
  await sleep(300);
  const t0 = Date.now();
  appendFileSync(`${local}/${path}`, `// ${marker}\n`);
  let flushMs = null;
  if (mode.endsWith("flush")) {
    execFileSync("mutagen", ["sync", "flush", "sq"], { stdio: "ignore" });
    flushMs = Date.now() - t0;
  }
  const t1 = await waitFor(marker, 30000);
  const load = readFileSync("/proc/loadavg", "utf8").split(" ")[0];
  console.log(JSON.stringify({ mode, i, path, remoteMs: t1 === null ? null : t1 - t0, flushMs, load1: Number(load) }));
  await sleep(3000);
}
remote.stdin.end(); remote.kill();
process.exit(0);
