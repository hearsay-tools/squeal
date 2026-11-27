#!/usr/bin/env node
// Throwaway probe (row 025-26). Runs ONE plugin version against a real daemon on a copy of the
// benchmark's p500 project and records:
//   1. quiet timings: hooks and `squeal status` with no test running (40 rounds);
//   2. counts: SQL statements and sync file calls of single hook and status calls (instrument.mjs);
//   3. CPU profiles of single hook and status calls (--cpu-prof);
//   4. a busy phase: bench/session.mjs (12 steps, seed 7) with the daemon tree's CPU measured;
//   5. three profiled busy phases: session.mjs (12 steps, seeds 11, 13, 17), each with one main
//      thread CPU-profiled through the inspector (SIGUSR1 + CDP): daemon, runner host, store process.
// Run only in a boat.dev sandbox. Usage:
//   node profile.mjs --bench <bench dir> --plugin <plugin dir> --template <installed p500> --out <dir>
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values: o } = parseArgs({
  options: {
    bench: { type: "string" },
    plugin: { type: "string" },
    template: { type: "string" },
    out: { type: "string" },
    rounds: { type: "string", default: "40" },
  },
});
const HERE = dirname(new URL(import.meta.url).pathname);
const lib = await import(join(resolve(o.bench), "lib.mjs"));
const { timed, sleep, procStat, allPids, daemonPids, storeProcessPids } = lib;
const out = resolve(o.out);
const plugin = resolve(o.plugin);
const NODE = process.execPath;
mkdirSync(out, { recursive: true });
const home = join(out, "home");
const runtime = join(out, "run");
for (const d of [home, runtime, join(out, "counts"), join(out, "prof")]) mkdirSync(d, { recursive: true });
const root = join(out, "work", "wt0");
cpSync(o.template, root, { recursive: true, verbatimSymlinks: true });

const env = {
  ...process.env,
  PATH: [dirname(NODE), process.env.PATH].filter(Boolean).join(delimiter),
  HOME: home,
  XDG_RUNTIME_DIR: runtime,
  CLAUDE_PLUGIN_ROOT: plugin,
  CLAUDE_PROJECT_DIR: root,
};
delete env.NODE_OPTIONS;
const [cliCmd, ...cli] = lib.squealCommand(plugin, NODE);
const squeal = (args, extra = {}, timeoutMs = 900_000) =>
  timed(cliCmd, [...cli, ...args], { env: { ...env, ...extra }, cwd: root, timeoutMs });
const sessionId = "0f0f0f0f-1111-4222-8333-444455556666";
const hook = (name, payload, extra = {}) =>
  timed(
    join(plugin, "hooks/run"),
    ["--if-squeal", NODE, "--disable-warning=ExperimentalWarning", join(plugin, "dist", `${name}.mjs`)],
    {
      input: JSON.stringify({
        session_id: sessionId,
        transcript_path: `/tmp/${sessionId}.jsonl`,
        cwd: root,
        permission_mode: "default",
        ...payload,
      }),
      env: { ...env, ...extra },
      cwd: root,
      timeoutMs: 30_000,
    },
  );
const pre = (extra) =>
  hook(
    "pre-tool-use",
    {
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_input: { file_path: join(root, "src/m7.ts"), old_string: "x", new_string: "y" },
      tool_use_id: "toolu_q",
    },
    extra,
  );
const post = (extra) =>
  hook(
    "post-tool-batch",
    {
      hook_event_name: "PostToolBatch",
      tool_calls: [
        {
          tool_name: "Read",
          tool_input: { file_path: join(root, "README") },
          tool_use_id: "toolu_r",
          tool_output: "",
          tool_output_error: false,
        },
      ],
    },
    extra,
  );
const CALLS = {
  pre,
  post,
  status: (extra) => squeal(["status"], extra),
  statusJson: (extra) => squeal(["status", "--json"], extra),
};

/** CPU seconds of a process tree: each live process's own CPU plus what it reaped. */
function treeCpu(rootPid) {
  const kids = new Map();
  const stats = new Map();
  for (const pid of allPids()) {
    const s = procStat(pid);
    if (!s) continue;
    stats.set(pid, s);
    if (!kids.has(s.ppid)) kids.set(s.ppid, []);
    kids.get(s.ppid).push(pid);
  }
  let total = 0;
  const stack = [rootPid];
  while (stack.length) {
    const p = stack.pop();
    const s = stats.get(p);
    if (s) total += s.ownCpuS + s.childCpuS;
    for (const c of kids.get(p) ?? []) stack.push(c);
  }
  return total;
}
const daemonPid = () => [...daemonPids().values()][0];
const storePidList = () => [...storeProcessPids().keys()];
const cpuNow = () => ({
  daemonTree: treeCpu(daemonPid()),
  store: storePidList().reduce((a, p) => a + (procStat(p)?.ownCpuS ?? 0), 0),
});

/** Starts a CPU profile on `pid`'s main thread through the inspector; returns stop(). */
async function profileProcess(pid, port) {
  execFileSync("kill", ["-USR1", String(pid)]);
  let url;
  for (let i = 0; i < 50 && url === undefined; i++) {
    await sleep(100);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      url = list[0]?.webSocketDebuggerUrl;
    } catch {}
  }
  if (url === undefined) throw new Error(`no inspector on ${pid}:${port}`);
  const ws = new WebSocket(url);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id !== undefined) waiting.get(m.id)?.(m);
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      const n = ++id;
      waiting.set(n, r);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  await send("Profiler.enable");
  await send("Profiler.setSamplingInterval", { interval: 500 });
  await send("Profiler.start");
  return async () => {
    const r = await send("Profiler.stop");
    // Free the port for the next process: the inspector closes inside the profiled process.
    ws.send(
      JSON.stringify({
        id: ++id,
        method: "Runtime.evaluate",
        params: { expression: 'process.getBuiltinModule("node:inspector").close()' },
      }),
    );
    await sleep(500);
    ws.close();
    return r.result.profile;
  };
}

const result = { plugin, version: JSON.parse(readFileSync(join(plugin, "package.json"))).version };
const log = (m) => console.log(`[${new Date().toISOString()}] ${result.version} ${m}`);

log("start + run --all");
result.start = (await squeal(["start"], {}, 120_000)).ms;
const full = await squeal(["run", "--all", "--wait"], {}, 3_600_000);
result.runAll = { ms: full.ms, code: full.code };
await sleep(20_000);
const reg = await hook("session-start", {
  hook_event_name: "SessionStart",
  source: "startup",
  model: "claude-sonnet-5-5",
});
result.sessionStart = reg.ms;
await sleep(5_000);

// 1. Quiet timings.
log("quiet timings");
const cpuQ0 = cpuNow();
result.quiet = Object.fromEntries(Object.keys(CALLS).map((k) => [k, []]));
for (let i = 0; i < Number(o.rounds); i++) {
  for (const [k, call] of Object.entries(CALLS)) {
    result.quiet[k].push((await call()).ms);
    await sleep(150);
  }
}
const cpuQ1 = cpuNow();
result.quietCpu = { daemonTree: cpuQ1.daemonTree - cpuQ0.daemonTree, store: cpuQ1.store - cpuQ0.store };

// 2. Counts.
log("counts");
for (const [k, call] of Object.entries(CALLS)) {
  for (let i = 0; i < 3; i++) {
    const dir = join(out, "counts", `${k}-${i}`);
    mkdirSync(dir, { recursive: true });
    await call({ NODE_OPTIONS: `--import=${join(HERE, "instrument.mjs")}`, PROBE_COUNTS: dir });
  }
}

// 3. CPU profiles of single calls.
log("call profiles");
for (const [k, call] of Object.entries(CALLS)) {
  for (let i = 0; i < 3; i++) {
    const dir = join(out, "prof", `${k}-${i}`);
    mkdirSync(dir, { recursive: true });
    await call({ NODE_OPTIONS: `--cpu-prof --cpu-prof-dir=${dir} --cpu-prof-interval=200` });
  }
}

// 4. Busy phase, unprofiled.
const session = (seed, file) =>
  timed(
    NODE,
    [
      join(resolve(o.bench), "session.mjs"),
      "--root",
      root,
      "--plugin",
      plugin,
      "--files",
      "500",
      "--seed",
      String(seed),
      "--steps",
      "12",
      "--out",
      file,
      "--think-min",
      "3000",
      "--think-max",
      "6000",
    ],
    { env, cwd: root, timeoutMs: 1_800_000 },
  );
log("busy session");
const cpuB0 = cpuNow();
result.busy = await session(7, join(out, "session-busy.jsonl")).then((r) => ({ ms: r.ms, code: r.code }));
const cpuB1 = cpuNow();
result.busyCpu = { daemonTree: cpuB1.daemonTree - cpuB0.daemonTree, store: cpuB1.store - cpuB0.store };

// 5. Busy phases with one process's main thread profiled each (one inspector port, so in turn):
// the daemon, its runner host and its store process.
const childOf = (parent, pattern) =>
  allPids().find((p) => procStat(p)?.ppid === parent && pattern.test(lib.cmdline(p)));
const targets = [
  ["daemon", () => daemonPid(), 11],
  ["runner-host", () => childOf(daemonPid(), /runner-host/), 13],
  ["store", () => storePidList()[0], 17],
];
result.profiled = {};
for (const [name, pidOf, seed] of targets) {
  log(`profiled session: ${name}`);
  let stop = null;
  const pid = pidOf();
  try {
    if (pid === undefined) throw new Error("no such process");
    stop = await profileProcess(pid, 9229);
  } catch (e) {
    result.profiled[name] = { error: String(e) };
  }
  const c0 = cpuNow();
  const r = await session(seed, join(out, `session-${name}.jsonl`));
  const c1 = cpuNow();
  result.profiled[name] = {
    ...result.profiled[name],
    pid,
    ms: r.ms,
    code: r.code,
    cpu: { daemonTree: c1.daemonTree - c0.daemonTree, store: c1.store - c0.store },
  };
  if (stop !== null) writeFileSync(join(out, "prof", `${name}.cpuprofile`), JSON.stringify(await stop()));
}

await squeal(["stop"], {}, 60_000);
for (let i = 0; i < 100 && daemonPids().size > 0; i++) await sleep(200);
try {
  cpSync(join(root, ".git/squeal/logs"), join(out, "logs"), { recursive: true });
} catch (e) {
  result.logsError = String(e);
}
writeFileSync(join(out, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
log(`done: ${readdirSync(join(out, "prof")).length} profile entries`);
