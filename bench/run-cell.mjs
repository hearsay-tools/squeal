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
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import {
  background,
  cpuJiffies,
  daemonPids,
  longWriteHolds,
  procStat,
  quantile,
  relayLog,
  sleep,
  storeProcessLog,
  storeProcessMeter,
  storeProcessPids,
  timed,
  timedPeak,
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
    "age-rounds": { type: "string", default: "0" },
    "age-span-days": { type: "string", default: "7" },
    "age-lists": { type: "string", default: "7d" },
    churn: { type: "boolean", default: false },
  },
});
const HERE = import.meta.dirname;
const pruneWatch = { series: [], timer: null };
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
  ageRounds: Number(o["age-rounds"]),
  ageLists: o["age-lists"],
  churn: o.churn,
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
const storeMeter = storeProcessMeter();
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
  const storeRss = storeMeter.sample();
  samples.push({
    t: Date.now(),
    busy,
    daemons: daemons.size,
    treeRss: rss,
    maxDaemonRss,
    storeRss,
    storeCpuS: storeMeter.cpuS(),
  });
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

// 4b. Store age: stop the daemon, add history (age-store.mjs), start again on the aged store.
if (Number(o["age-rounds"]) > 0) {
  log(`age store: ${o["age-rounds"]} rounds`);
  await squeal(main, ["stop"], 60_000);
  for (let i = 0; i < 100 && daemonPids().size > 0; i++) await sleep(200);
  // The code store's process (spec 021 D22) holds code.sqlite's write connection for minutes after its last client.
  for (const pid of storeProcessPids().keys()) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
  for (let i = 0; i < 100 && storeProcessPids().size > 0; i++) await sleep(200);
  const aged = await timed(
    NODE,
    [
      join(HERE, "age-store.mjs"),
      join(main, ".git/squeal/store.sqlite"),
      o["age-rounds"],
      main,
      "--span-days",
      o["age-span-days"],
      "--lists",
      o["age-lists"],
      ...(o.churn ? ["--churn"] : []),
    ],
    { env, timeoutMs: 3_600_000 },
  );
  cell.phases.age = {
    ms: aged.ms,
    code: aged.code,
    ...(() => {
      try {
        return JSON.parse(aged.stdout.trim().split("\n").pop());
      } catch {
        return { err: aged.stderr.slice(-800) };
      }
    })(),
  };
  const s1 = await squeal(main, ["start"], 120_000);
  cell.phases.startAged = { ms: s1.ms, code: s1.code, at: Date.now() };
  if (o.churn) watchPrune(join(main, ".git/squeal/store.sqlite"));
  const st = await squeal(main, ["status", "--json"], 120_000);
  cell.phases.firstStatusAged = { ms: st.ms, code: st.code };
}

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
const idleStore0 = storeMeter.cpuS();
await sleep(Number(o.idle));
const idle1 = cpuAt();
const idleStoreCpuS = storeMeter.cpuS() - idleStore0;
cell.phases.idle = {
  ms: Number(o.idle),
  daemons: daemonsBeforeIdle.size,
  storeProcessCpuPct: (100 * idleStoreCpuS) / (Number(o.idle) / 1000),
  perDaemonCpuPct: [...idle1].map(([root, s]) => {
    const a = idle0.get(root);
    if (!a || !s) return null;
    return (100 * (s.ownCpuS + s.childCpuS - a.ownCpuS - a.childCpuS)) / (Number(o.idle) / 1000);
  }),
};

// 7. Sessions.
log("sessions");
const cpu0 = cpuAt();
const sessionStore0 = storeMeter.cpuS();
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
cell.phases.sessionStoreProcessCpuS = storeMeter.cpuS() - sessionStore0;

// 7b. `squeal reach`: reads every stored module list (loaded_modules) with no daemon; the store's worst size cost.
{
  const r = await timedPeak(NODE, [...cli, "reach", "--json"], {
    env,
    cwd: main,
    timeoutMs: 600_000,
  });
  cell.phases.reach = { ms: r.ms, code: r.code, peakRssBytes: r.peakRssBytes };
}

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
const holds = [];
let lockFailures = 0;
let storeLog = "";
let relay = "";
const logDir = join(store, "logs");
mkdirSync(join(out, "logs"), { recursive: true });
if (existsSync(logDir)) {
  for (const f of readdirSync(logDir)) {
    const text = readFileSync(join(logDir, f), "utf8");
    longWrites += (text.match(/long write/gi) ?? []).length;
    holds.push(...longWriteHolds(text));
    lockFailures += (text.match(/SQLITE_BUSY|database is locked/gi) ?? []).length;
    if (f.startsWith("store-")) storeLog += text;
    else relay += text;
    cpSync(join(logDir, f), join(out, "logs", f));
  }
}
cell.store.longWrites = longWrites;
cell.store.lockFailures = lockFailures;
cell.store.longWriteHoldsMs = holds;
// Spec 021 D22: the code store's process, when this Squeal version has one.
cell.storeProcess = {
  seen: storeMeter.pids().length,
  cpuS: storeMeter.cpuS(),
  maxRssBytes: Math.max(0, ...samples.map((s) => s.storeRss ?? 0)),
  ...storeProcessLog(storeLog),
  relay: relayLog(relay),
};
cell.daemonRss = {
  maxDaemonBytes: Math.max(0, ...samples.map((s) => s.maxDaemonRss)),
  maxTreeBytes: Math.max(0, ...samples.map((s) => s.treeRss)),
};
for (const root of roots) await squeal(root, ["stop"], 60_000);
load.kill("SIGTERM");
clearInterval(sampler);
if (pruneWatch.timer) clearInterval(pruneWatch.timer);
if (o.churn) {
  const series = pruneWatch.series;
  const start = cell.phases.startAged.at;
  const first = series[0]?.old ?? null;
  const firstDrop = series.find((x) => first !== null && x.old < first);
  // Done when under 1% of the backlog is left. Never 0: aged rows keep passing
  // the 7-day line while the cell runs (about 110 a minute at 326 rounds), for
  // the next hourly prune.
  const zero = series.find((x) => first !== null && x.old !== undefined && x.old <= first / 100);
  cell.phases.churn = {
    oldResultsAtStart: first,
    oldResultsAtEnd: series.at(-1)?.old ?? null,
    pruneStartedAfterS: firstDrop ? (firstDrop.t - start) / 1000 : null,
    pruneDoneAfterS: zero ? (zero.t - start) / 1000 : null,
    pruneS: firstDrop && zero ? (zero.t - firstDrop.t) / 1000 : null,
    fullCheckS: fullCheckSeconds(join(out, "logs"), start),
  };
  writeFileSync(join(out, "prune-watch.json"), JSON.stringify(series));
}
await sleep(3000);
// A store process outlives its last client by minutes; it must not run into the next cell.
for (const pid of [...daemonPids().values(), ...storeProcessPids().keys()]) {
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

/**
 * Churn cells: every 5 s, from a read-only connection, the results older than
 * the 7-day retention (an indexed count), so the cell sees when prune starts
 * and when it has deleted them all.
 */
function watchPrune(file) {
  const cutoff = () => Date.now() - 7 * 86_400_000;
  const read = () => {
    try {
      const db = new DatabaseSync(file, { readOnly: true });
      db.exec("PRAGMA busy_timeout = 2000");
      const old = Number(
        db.prepare("SELECT COUNT(*) AS n FROM results WHERE recorded_at < ?").get(cutoff()).n,
      );
      db.close();
      pruneWatch.series.push({ t: Date.now(), old });
    } catch (error) {
      pruneWatch.series.push({ t: Date.now(), error: String(error) });
    }
  };
  read();
  pruneWatch.timer = setInterval(read, 5000);
}

/** Seconds from the daemon start at `since` to its "full integrity check: ok" log line; null without one. */
function fullCheckSeconds(logDir, since) {
  if (!existsSync(logDir)) return null;
  for (const f of readdirSync(logDir)) {
    for (const line of readFileSync(join(logDir, f), "utf8").split("\n")) {
      const m = /^(\S+Z) .*full integrity check: ok/.exec(line);
      if (m && Date.parse(m[1]) >= since) return (Date.parse(m[1]) - since) / 1000;
    }
  }
  return null;
}
