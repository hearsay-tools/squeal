// Throwaway probe (research 023-15, keys-by-walk). Not product code.
//
// Starts one Squeal daemon (`squeal daemon <root>`, foreground process) in a scratch checkout
// whose clone holds a reflinked copy of a store, waits for its `baseline` checkpoint to complete
// (lookup-only: listed, keyed, looked up, nothing run), samples the RSS of the daemon's process
// tree, then stops it with `squeal stop <root>` and checks no process names the root.
//
// Usage: node daemon-start.mjs <squeal.mjs> <root> <common dir> <out.json>
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const [cli, root, commonDir, out] = process.argv.slice(2);
const real = realpathSync(root);
const worktreeId = createHash("sha256").update(real).digest("hex").slice(0, 16);
const load = () => readFileSync("/proc/loadavg", "utf8").split(" ")[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tree(pid) {
  const parents = new Map();
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      parents.set(Number(name), ppid);
    } catch {}
  }
  const members = new Set([pid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [p, pp] of parents) if (!members.has(p) && members.has(pp)) members.add(p), (grew = true);
  }
  let rssKb = 0;
  for (const p of members) {
    try {
      const m = /VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${p}/status`, "utf8"));
      if (m) rssKb += Number(m[1]);
    } catch {}
  }
  return { count: members.size, rssKb };
}

function rootProcesses() {
  const found = [];
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const cmd = readFileSync(`/proc/${name}/cmdline`, "utf8").replaceAll("\0", " ");
      if (cmd.includes(real) && Number(name) !== process.pid && !cmd.includes("daemon-start.mjs")) found.push(`${name} ${cmd.slice(0, 160)}`);
    } catch {}
  }
  return found;
}

const loadBefore = load();
const log = openSync(`${out}.daemon.log`, "w");
const t0 = performance.now();
const child = spawn(process.execPath, [cli, "daemon", root], { stdio: ["ignore", log, log], env: process.env });
let peak = { count: 0, rssKb: 0 };
let baselineMs = null;
let state = null;
// Phase marks read from the store: the scan's revision row, the first lookup's key rows (from stored
// closure lists, committed before the recheck under lookup-only), and the baseline checkpoint.
const phases = { revisionMs: null, firstKeysMs: null };
const db = () => new DatabaseSync(`${commonDir}/squeal/store.sqlite`, { readOnly: true });
const deadline = t0 + 590_000;
while (performance.now() < deadline) {
  const t = tree(child.pid);
  if (t.rssKb > peak.rssKb) peak = t;
  try {
    const d = db();
    if (phases.revisionMs === null && d.prepare("select 1 from revisions where worktree_id = ? limit 1").get(worktreeId))
      phases.revisionMs = Math.round(performance.now() - t0);
    if (phases.firstKeysMs === null && d.prepare("select 1 from test_file_keys where worktree_id = ? limit 1").get(worktreeId))
      phases.firstKeysMs = Math.round(performance.now() - t0);
    const row = d
      .prepare("select completed_at, end_state from checkpoints where worktree_id = ? and kind = 'baseline' and completed_at is not null")
      .get(worktreeId);
    d.close();
    if (row) {
      baselineMs = Math.round(performance.now() - t0);
      state = row.end_state;
      break;
    }
  } catch {}
  if (child.exitCode !== null) break;
  await sleep(250);
}
// One more second of samples: what the daemon does right after the lookup.
for (let i = 0; i < 4; i++) {
  const t = tree(child.pid);
  if (t.rssKb > peak.rssKb) peak = t;
  await sleep(250);
}
const loadAtBaseline = load();
const d = db();
const keys = Object.fromEntries(
  d.prepare("select project, path, key from test_file_keys where worktree_id = ?").all(worktreeId).map((r) => [`${r.project}\t${r.path}`, r.key]),
);
const keyed = Object.values(keys).filter((k) => k !== null);
let hits = 0;
const byKey = d.prepare("select 1 from results where key = ? limit 1");
for (const k of keyed) if (byKey.get(k)) hits++;
d.close();
const s0 = performance.now();
let stop = "";
try {
  stop = execFileSync(process.execPath, [cli, "stop", root], { encoding: "utf8", timeout: 120_000 });
} catch (e) {
  stop = `stop failed: ${e.message}`;
}
const stopMs = Math.round(performance.now() - s0);
for (let i = 0; i < 40 && child.exitCode === null; i++) await sleep(250);
await sleep(2000);
const left = rootProcesses();
const result = {
  root,
  worktreeId,
  head: execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  baselineMs,
  phases,
  baselineState: state,
  listed: Object.keys(keys).length,
  keyed: keyed.length,
  hits,
  peakTreeRssMb: Math.round(peak.rssKb / 1024),
  peakTreeProcesses: peak.count,
  stopMs,
  stop: stop.trim().split("\n").slice(-2),
  daemonExit: child.exitCode,
  leftProcesses: left,
  loadBefore,
  loadAtBaseline,
  keys,
};
writeFileSync(out, JSON.stringify(result, null, 1));
const { keys: _k, ...summary } = result;
console.log(JSON.stringify(summary));
process.exit(0);
