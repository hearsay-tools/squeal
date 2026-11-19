#!/usr/bin/env node
// Runs one benchmark cell: one project size, N active worktrees, one ambient
// load level, on a fresh store. Writes <out>/cell.json and the raw logs.
//
// Usage: node run-cell.mjs --name <cell> --template <installed project dir>
//          --files <n> --worktrees <n> --load <percent> --plugin <dir> --out <dir>
//          [--steps 24] [--idle 60000] [--seed 1]
//
// Phases, in order:
//   1. copy the template (git repo + node_modules, no store) and add worktrees
//   2. start the ambient load, wait 5 s
//   3. plain `vitest run` in the main worktree (1-worktree cells only): the no-Squeal reference
//   4. `squeal start` in main, then `squeal run --all --wait`: cold full run on an empty store
//   5. `squeal start` in each other worktree: start-up on a shared store (lookup-only)
//   6. 60 s with no edits: idle CPU of the daemons
//   7. one scripted session per worktree, all at once, starts 3 s apart
//   8. store and daemon numbers, then `squeal stop` everywhere and the load stopped
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  background,
  cpuJiffies,
  daemonPids,
  procStat,
  quantile,
  sleep,
  timed,
  treeRss,
} from "./lib.mjs";

const { values: o } = parseArgs({
  options: {
    name: { type: "string" },
    template: { type: "string" },
    files: { type: "string" },
    worktrees: { type: "string", default: "1" },
    load: { type: "string", default: "0" },
    plugin: { type: "string" },
    out: { type: "string" },
    steps: { type: "string", default: "24" },
    idle: { type: "string", default: "60000" },
    seed: { type: "string", default: "1" },
  },
});
const HERE = import.meta.dirname;
const out = o.out;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const work = join(out, "work");
const home = join(work, "home");
const runtime = join(work, "run");
for (const d of [home, runtime]) mkdirSync(d, { recursive: true });
const env = { ...process.env, HOME: home, XDG_RUNTIME_DIR: runtime };
delete env.CLAUDE_PROJECT_DIR;
const NODE = process.execPath;
const cli = ["--disable-warning=ExperimentalWarning", join(o.plugin, "dist/cli/squeal.mjs")];
const squeal = (root, args, timeoutMs) =>
  timed(NODE, [...cli, ...args], { env, cwd: root, timeoutMs });
const git = (cwd, args) => timed("git", args, { cwd, env });
const log = (msg) => console.log(`[${new Date().toISOString()}] ${o.name}: ${msg}`);
const cell = {
  name: o.name,
  files: Number(o.files),
  worktrees: Number(o.worktrees),
  load: Number(o.load),
  phases: {},
};

// 1. Project and worktrees.
const main = join(work, "wt0");
await timed("cp", ["-a", o.template, main]);
const roots = [main];
for (let w = 1; w < cell.worktrees; w++) {
  const root = join(work, `wt${w}`);
  await git(main, ["worktree", "add", "-q", "-b", `wt${w}`, root]);
  await timed("cp", ["-a", join(main, "node_modules"), join(root, "node_modules")]);
  roots.push(root);
}

// Whole-machine CPU and per-daemon RSS, sampled every second for the whole cell.
const samples = [];
let lastJ = cpuJiffies();
const sampler = setInterval(() => {
  const j = cpuJiffies();
  const busy = (j.busy - lastJ.busy) / Math.max(1, j.total - lastJ.total);
  lastJ = j;
  const daemons = daemonPids();
  let rss = 0;
  let maxDaemonRss = 0;
  for (const pid of daemons.values()) {
    const own = procStat(pid)?.rssBytes ?? 0;
    maxDaemonRss = Math.max(maxDaemonRss, own);
    rss += treeRss(pid);
  }
  samples.push({ t: Date.now(), busy, daemons: daemons.size, treeRss: rss, maxDaemonRss });
}, 1000);

// 2. Ambient load.
const load = background(NODE, [join(HERE, "load.mjs"), String(cell.load)]);
await sleep(5000);
const mark = (phase) => ({ phase, at: Date.now(), sample: samples.length });

// 3. No-Squeal reference.
if (cell.worktrees === 1) {
  log("plain vitest run");
  const r = await timed(join(main, "node_modules/.bin/vitest"), ["run"], {
    cwd: main,
    env,
    timeoutMs: 1_800_000,
  });
  cell.phases.plainVitest = { ms: r.ms, code: r.code };
}

// 4. Cold start and full run in main.
log("squeal start + run --all");
const s0 = await squeal(main, ["start"], 120_000);
cell.phases.startMain = {
  ms: s0.ms,
  code: s0.code,
  out: s0.stdout.slice(0, 500) + s0.stderr.slice(0, 500),
};
const fullMark = mark("full");
const full = await squeal(main, ["run", "--all", "--wait"], 3_600_000);
cell.phases.runAll = {
  ms: full.ms,
  code: full.code,
  tail: full.stdout.slice(-600) + full.stderr.slice(-600),
};
cell.phases.runAll.busyMean = meanBusy(fullMark.sample);

// 5. Start in the other worktrees.
cell.phases.startOthers = [];
for (const root of roots.slice(1)) {
  const r = await squeal(root, ["start"], 120_000);
  const st = await squeal(root, ["status", "--json"], 60_000);
  let counts = null;
  try {
    counts = JSON.parse(st.stdout).testFileCounts;
  } catch {}
  cell.phases.startOthers.push({ ms: r.ms, code: r.code, testFileCounts: counts });
}

// 6. Idle.
log("idle");
const daemonsBeforeIdle = daemonPids();
const cpuAt = () => new Map([...daemonPids()].map(([root, pid]) => [root, procStat(pid)]));
const idle0 = cpuAt();
await sleep(Number(o.idle));
const idle1 = cpuAt();
cell.phases.idle = {
  ms: Number(o.idle),
  daemons: daemonsBeforeIdle.size,
  perDaemonCpuPct: [...idle1].map(([root, s]) => {
    const a = idle0.get(root);
    if (!a || !s) return null;
    return (100 * (s.ownCpuS + s.childCpuS - a.ownCpuS - a.childCpuS)) / (Number(o.idle) / 1000);
  }),
};

// 7. Sessions.
log("sessions");
const cpu0 = cpuAt();
const sessionMark = mark("sessions");
const sessions = roots.map(async (root, w) => {
  await sleep(w * 3000);
  const file = join(out, `session-wt${w}.jsonl`);
  const r = await timed(
    NODE,
    [
      join(HERE, "session.mjs"),
      "--root",
      root,
      "--plugin",
      o.plugin,
      "--files",
      o.files,
      "--seed",
      String(Number(o.seed) * 100 + w),
      "--steps",
      o.steps,
      "--out",
      file,
    ],
    { env, cwd: root, timeoutMs: 3_600_000 },
  );
  if (r.code !== 0) writeFileSync(join(out, `session-wt${w}.err`), r.stdout + r.stderr);
  return { worktree: w, ms: r.ms, code: r.code };
});
cell.phases.sessions = await Promise.all(sessions);
const cpu1 = cpuAt();
cell.phases.sessionsBusyMean = meanBusy(sessionMark.sample);
const edits = [];
for (let w = 0; w < roots.length; w++) {
  const file = join(out, `session-wt${w}.jsonl`);
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").trim().split("\n")) {
    const j = JSON.parse(line);
    if (j.kind === "step" && j.type !== "status") edits.push(j);
  }
}
cell.phases.sessionDaemonCpuS = [...cpu1].map(([root, s]) => {
  const a = cpu0.get(root);
  return a && s ? s.ownCpuS + s.childCpuS - a.ownCpuS - a.childCpuS : null;
});
cell.phases.edits = edits.length;

// 8. Store, logs, stop.
log("collect");
const store = join(main, ".git/squeal");
const size = (p) => (existsSync(p) ? statSync(p).size : 0);
cell.store = {
  storeBytes: size(join(store, "store.sqlite")),
  walBytes: size(join(store, "store.sqlite-wal")),
  codeBytes: size(join(store, "code.sqlite")),
  runsDirs: existsSync(join(store, "runs")) ? readdirSync(join(store, "runs")).length : 0,
};
const rows = await timed(
  "sqlite3",
  [
    "-readonly",
    join(store, "store.sqlite"),
    "select 'results',count(*) from results union all select 'runs',count(*) from runs union all select 'revisions',count(*) from revisions union all select 'transitions',count(*) from transitions;",
  ],
  { env },
);
cell.store.rows = Object.fromEntries(
  rows.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("|"))
    .map(([k, v]) => [k, Number(v)]),
);
let longWrites = 0;
let lockFailures = 0;
const logDir = join(store, "logs");
mkdirSync(join(out, "logs"), { recursive: true });
if (existsSync(logDir)) {
  for (const f of readdirSync(logDir)) {
    const text = readFileSync(join(logDir, f), "utf8");
    longWrites += (text.match(/long write/gi) ?? []).length;
    lockFailures += (text.match(/SQLITE_BUSY|database is locked/gi) ?? []).length;
    cpSync(join(logDir, f), join(out, "logs", f));
  }
}
cell.store.longWrites = longWrites;
cell.store.lockFailures = lockFailures;
cell.daemonRss = {
  maxDaemonBytes: Math.max(0, ...samples.map((s) => s.maxDaemonRss)),
  maxTreeBytes: Math.max(0, ...samples.map((s) => s.treeRss)),
};
for (const root of roots) await squeal(root, ["stop"], 60_000);
load.kill("SIGTERM");
clearInterval(sampler);
await sleep(3000);
for (const pid of daemonPids().values()) {
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
}
writeFileSync(join(out, "samples.json"), JSON.stringify(samples));
writeFileSync(join(out, "cell.json"), `${JSON.stringify(cell, null, 2)}\n`);
rmSync(work, { recursive: true, force: true });
log("done");

function meanBusy(fromSample) {
  const s = samples.slice(fromSample);
  return s.length ? s.reduce((a, b) => a + b.busy, 0) / s.length : null;
}

export { quantile };
