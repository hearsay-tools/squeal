#!/usr/bin/env node
// Spec 006 D3: one eval cell (task x variant x harness x model x repetition) end to end, isolated.
//   node evals/bin/run-cell.mjs <task> <variant> <claude|codex> <model> [rep]
//     [--commit HEAD] [--run <id>] [--resume] [--effort medium] [--cold] [--dry]
//     [--max-load <cpus>] [--timeout-s 900] [--grace-s 10] [--force-root]
// --dry builds the cell and warms it, then stops the daemon without a session. --effort pins the
// reasoning effort: `claude -p --effort <level>`, `codex exec -c model_reasoning_effort="<level>"`.
// The task's knobs come from evals/tasks/tasks.json. Exit 75: held, the load is too high.
// An atomic scenario (evals/atomic/atomic.json, 006-33) in place of a task brings its own knobs
// and turns: each later turn waits until `squeal status` shows nothing pending (bounded by
// `settleS`, or by the fixture's `slow.maxDeferMs` plus the tier's last duration while its load
// gate defers the slow tier, D10), then resumes the same session with the cell's scratch homes,
// into the same events.jsonl. A scenario with `waitSettled: false` sends it at once and records
// whether checks were pending. Its grade carries the mechanical record (`atomic`), unjudged.
// --run names the run the cell belongs to (a fresh id by default); a cell already graded in that
// run is skipped with --resume and refused without it (exit 2), so no run overwrites another.
// Exit 1: the cell failed (setup, a session that could not start, or a secret that survived).
//
// Everything lives under $SQ_EVALS_ROOT (default /tmp/squeal-evals-<uid>, never the system temp
// directory), refused inside a repository (exit 2) unless --force-root:
//   pin-base/<commit>/      `git archive` of the commit's plugins
//   nm/node_modules         the fixture's Vitest, copied into each cell
//   pins/<commit>/<variant> the variant's patched copy (evals/variants/<variant>.json)
//   cells/<commit>/<run>/<id>/home, codex, tmp   HOME, CODEX_HOME and TMPDIR; removed at the end
//   cells/<commit>/<run>/<id>/work   the fixture, committed at a fixed date, warmed unless --cold
//   cells/<commit>/<run>/<id>/out    events.jsonl, load.tsv, truth.json, status-end.json, diff,
//                                    store copy, grade.json (with the judge's verdicts, D9),
//                                    scratch.json
//   cells/<commit>/<run>/<id>/squeal-judge-*  each judge call's scratch HOME; removed after it
// Whatever happens, setup exception, timeout or SIGTERM, the teardown runs: the session's process
// group and every daemon the cell started are stopped, any process still naming the cell is
// killed, the scratch is removed and the retained evidence is scanned, every secret in it
// redacted or its file removed. A secret that survives fails the cell and drops its grade. Once
// the teardown has begun the lifecycle starts no process: a signal's teardown runs beside it,
// and its next session, Squeal command, ground truth, grade or judge call throws (006-97).

import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, loadavg } from "node:os";
import { join, relative } from "node:path";
import {
  maxDeferMsOf,
  pilotRecord,
  readEvents,
  runTurns,
  scenarioOf,
  settleSnapshot,
  usageOf,
  waitSettled,
} from "../lib/atomic.mjs";
import { declarations } from "../lib/behaviours.mjs";
import { calibratedIdentity, judgeRecord } from "../lib/calibration.mjs";
import { daemonPids, stopDaemons, stopLeftovers } from "../lib/daemon.mjs";
import { claudeRunner, identityKey } from "../lib/judge.mjs";
import {
  buildFixture,
  cellArgs,
  cellId,
  EVALS,
  fixtureModules,
  pinBase,
  resolveCommit,
  runId,
} from "../lib/prepare.mjs";
import { cellRecord } from "../lib/results.mjs";
import {
  addService,
  knobTools,
  retryEnv,
  serviceForTruth,
  stageInherited,
  storeLoads,
} from "../lib/retry-knobs.mjs";
import { evalsRoot, refuseInsideRepo } from "../lib/root.mjs";
import {
  cellEnv,
  clearScratch,
  codexConfig,
  keepRecords,
  pathFirst,
  providerVariables,
  redact,
  secretsOf,
  squealBin,
} from "../lib/scratch.mjs";
import { groundTruth, killRunning, runSession, sessionCommand, stopping } from "../lib/session.mjs";
import { buildPin } from "../lib/variant.mjs";

const argv = process.argv.slice(2);
const forceRoot = argv.includes("--force-root");
let ROOT;
let args;
try {
  ROOT = refuseInsideRepo(evalsRoot(), { force: forceRoot });
  args = cellArgs(
    argv.filter((a) => a !== "--force-root"),
    { runId, maxLoad: availableParallelism() },
  );
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
const { dry, cold, resume, run, maxLoad, timeoutS, graceS, effort } = args;
const { task, variant: variantName, harness, model, rep } = args;
const commit = resolveCommit(args.commit);

const variant = JSON.parse(readFileSync(join(EVALS, "variants", `${variantName}.json`), "utf8"));
const scenario = scenarioOf(task);
const knobs = scenario
  ? scenario.knobs
  : (JSON.parse(readFileSync(join(EVALS, "tasks", "tasks.json"), "utf8")).tasks[task] ?? {});
const id = cellId({ task, variant: variantName, harness, model, effort, rep, cold });
const CELL = join(ROOT, "cells", commit.slice(0, 12), run, id);
const OUT = join(CELL, "out");
const WORK = join(CELL, "work");
if (existsSync(join(OUT, "grade.json"))) {
  if (resume) {
    console.log(`skip ${id}: already graded in run ${run}`);
    process.exit(0);
  }
  console.error(`${id} is already graded in run ${run}: pass --resume to skip it, or a new --run`);
  process.exit(2);
}
const load1 = () => loadavg()[0];
if (load1() >= maxLoad) {
  console.log(`held ${id}: load ${load1().toFixed(1)} >= ${maxLoad}`);
  process.exit(75);
}

rmSync(CELL, { recursive: true, force: true });
for (const d of ["home", "tmp", "work", "out", "codex"])
  mkdirSync(join(CELL, d), { recursive: true });
const realCodex = existsSync(join(process.env.HOME, ".codex/config.toml"))
  ? readFileSync(join(process.env.HOME, ".codex/config.toml"), "utf8")
  : "";
const secrets = secretsOf(process.env, realCodex);
// Nothing the runner writes or prints holds a secret: an error message can quote a harness.
const log = (s) => {
  const line = redact(String(s), secrets);
  appendFileSync(join(OUT, "runner.log"), `${new Date().toISOString()} ${line}\n`);
  console.log(`[${id}] ${line}`);
};

const env = cellEnv(process.env, CELL, providerVariables(harness, process.env, realCodex));
if (knobs.flakeColdRuns) env.LEDGERLINE_CALENDAR_COLD_RUNS = String(knobs.flakeColdRuns);
const setLoad = retryEnv(knobs, CELL, env); // 006-53: pinLoad and service, before any process
// 006-97: once the teardown has begun the lifecycle starts nothing; `teardown` marks its own stop.
const refuseAfterTeardown = (what) => {
  if (stopping()) throw new Error(`the teardown has begun: ${what} not started`);
};
const sh = (cmd, args, opts = {}) => {
  if (!opts.teardown) refuseAfterTeardown(opts.what ?? `${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd: WORK,
    env: { ...env, ...opts.env },
    encoding: "utf8",
    timeout: opts.timeout ?? 600_000,
    killSignal: "SIGKILL",
  });
  if (opts.check !== false && r.status !== 0)
    throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}: ${r.stderr}${r.stdout}`);
  return r;
};
const plugin = variant.plugin !== false;
let CLI = null;
const squeal = (args, opts = {}) =>
  sh("node", ["--disable-warning=ExperimentalWarning", CLI, ...args], {
    check: false,
    what: `squeal ${args.join(" ")}`,
    ...opts,
  });
const daemonExits = [];
const stopDaemon = async (why, opts = {}) => {
  const stop = () => {
    if (!CLI || !existsSync(join(WORK, ".git"))) return null;
    const r = squeal(["stop", WORK], opts);
    return (r.stdout + r.stderr).trim().split("\n").at(-1) ?? "";
  };
  daemonExits.push(...(await stopDaemons({ work: WORK, stop, why, log })));
};
const stopCellLeftovers = () => stopLeftovers({ cell: CELL, out: OUT, log });

// ---------- the lifecycle: setup, the session, the evidence ----------
async function lifecycle() {
  const t0Setup = Date.now();
  const PIN = buildPin(
    pinBase(ROOT, commit),
    join(ROOT, "pins", commit, variantName),
    variantName,
    variant,
  );
  CLI = join(PIN, "plugins", harness === "codex" ? "codex" : "claude-code", "dist/cli/squeal.mjs");
  // 006-62: a bare `squeal` is the pinned plugin's, never the host's launcher.
  if (plugin) env.PATH = pathFirst(env.PATH, squealBin(harness, CELL, PIN));
  const head = buildFixture({ work: WORK, variant, env, modules: fixtureModules(ROOT) });
  log(`fixture ${head}, pin ${relative(ROOT, PIN)}, run ${run}, load ${load1().toFixed(1)}`);
  const git = (a) => sh("git", a); // cellEnv's author and committer
  addService(knobs, { work: WORK, home: env.HOME, git, sh, log });

  // A policy key the pinned CLI does not know is a variant that cannot run here (D8 before it ships).
  if (variant.policy) {
    const st = squeal(["status"]);
    const text = st.stdout + st.stderr;
    if (/unknown key|not a key|problem/i.test(text) && /testCommand|denyWhenCurrent/.test(text)) {
      writeFileSync(
        join(OUT, "grade.json"),
        JSON.stringify({ id, skipped: "policy key unknown to the pinned CLI" }),
      );
      log("skipped: policy key unknown to the pinned CLI");
      return;
    }
  }

  // Codex: scratch CODEX_HOME, the host's provider block (allow-listed fields), the pinned plugin.
  if (harness === "codex") {
    writeFileSync(join(CELL, "codex/config.toml"), codexConfig(realCodex, model));
    if (plugin) {
      sh("codex", ["plugin", "marketplace", "add", PIN]);
      sh("codex", ["plugin", "add", "squeal@hearsay"]);
      const trust = squeal(["init", "--harness", "codex", "--trust", "--yes"]);
      log(`codex trust: ${(trust.stdout + trust.stderr).split("\n").filter(Boolean).at(-1) ?? ""}`);
      sh("git", ["checkout", "-q", "--", "."], { check: false });
    }
  }

  // The daemon: warm unless --cold, then the task's knobs.
  if (plugin && !cold && knobs.inherited) {
    const recordedLoads = storeLoads(join(WORK, ".git/squeal/store.sqlite"));
    const w = await stageInherited(knobs, {
      squeal,
      setLoad,
      log,
      recordedLoads,
    });
    writeFileSync(join(OUT, "warmup.txt"), w);
    log(`warm-up: ${(w.match(/^Known failures: .*$/m) ?? ["?"])[0]}`);
  } else if (plugin && !cold) {
    // The flake knob warms with the flake off, then restarts the daemon with it on.
    const warm = knobs.flakeColdRuns ? { env: { LEDGERLINE_CALENDAR_WARM: "1" } } : {};
    squeal(["start"], warm);
    const w = squeal(["run", "--all", "--wait"], warm);
    writeFileSync(join(OUT, "warmup.txt"), w.stdout + w.stderr);
    log(`warm-up: ${(w.stdout.match(/^Known failures: .*$/m) ?? ["?"])[0]}`);
    if (knobs.flakeColdRuns) {
      await stopDaemon("flake knob");
      squeal(["start"]);
    }
  }
  if (plugin && knobs.daemon === "stopped") {
    await stopDaemon("daemon knob");
    env.SQUEAL_CLI = join(CELL, "no-daemon", "squeal.mjs"); // names no file: nothing can start one
  }
  // 006-54: the slow tier held for host load, set after the warm-up so the warm-up's slow file ran;
  // 006-94: the slow suite required at stop. The keys go into the committed policy, so the
  // session's `git status` stays clean; its daemon starts on the new policy as for a stale edit.
  if (knobs.loadHold || knobs.requireSlowSuite) {
    if (plugin) await stopDaemon("policy knob");
    const file = join(WORK, "squeal.config.json");
    const policy = JSON.parse(readFileSync(file, "utf8"));
    if (knobs.loadHold) policy.slow = { ...policy.slow, ...knobs.loadHold };
    if (knobs.requireSlowSuite) policy.stop = { ...policy.stop, requireSlowSuite: true };
    writeFileSync(file, `${JSON.stringify(policy, null, 2)}\n`);
    const why = [
      knobs.loadHold && "Hold slow tests while the host is busy",
      knobs.requireSlowSuite && "Require slow tests before finishing",
    ];
    git(["commit", "-q", "-m", why.filter(Boolean).join("; "), "--", file]);
    if (knobs.loadHold) log(`load hold: slow ${JSON.stringify(knobs.loadHold)}`);
    if (knobs.requireSlowSuite) log("stop: requireSlowSuite true");
  }
  if (knobs.staleEdit) {
    if (plugin) await stopDaemon("stale-edit knob");
    appendFileSync(join(WORK, knobs.staleEdit.path), knobs.staleEdit.append);
    log(`stale edit: ${knobs.staleEdit.path}`);
  }
  const setupS = (Date.now() - t0Setup) / 1000;
  if (dry) {
    writeFileSync(
      join(OUT, "git-status.txt"),
      sh("git", ["status", "--short", "--ignored"], { check: false }).stdout,
    );
    log(`dry run: setup ${setupS.toFixed(1)} s`);
    return;
  }

  // The session: one turn for a task, each of its turns for an atomic scenario.
  const prompts = scenario?.prompts ?? [
    `${readFileSync(join(EVALS, "tasks", `${task}.txt`), "utf8").trim()}\n${readFileSync(join(EVALS, "tasks", "_ending.txt"), "utf8")}`,
  ];
  const {
    exits,
    turnStarts,
    settle,
    t0: T0,
    t1: T1,
    samples,
    command: cmd,
  } = await runTurns({
    prompts,
    harness,
    command: (opts) =>
      sessionCommand({
        harness,
        model,
        effort,
        pluginDir: plugin ? join(PIN, "plugins/claude-code") : null,
        tools: knobTools(knobs),
        ...opts,
      }),
    session: (command, args, t0) =>
      runSession({ command, args, cwd: WORK, env, out: OUT, timeoutS, graceS, log, t0 }),
    settle: () => {
      if (!plugin) return { settled: false, why: "no plugin", waitedMs: 0, polls: 0, status: "" };
      const status = () => squeal(["status", "--json"]).stdout;
      if (scenario.waitSettled === false) return settleSnapshot(status);
      return waitSettled({
        status,
        timeoutMs: scenario.settleS * 1000,
        maxDeferMs: maxDeferMsOf(WORK),
      });
    },
    out: OUT,
    log: (s) => log(s.replace("{model}", `${model} effort ${effort}`)),
    load: () => load1().toFixed(1),
  });
  const exit = exits.at(-1);

  // After: Squeal's view, ground truth, diff against the fixture, store copy, daemons stopped.
  if (plugin) {
    const st = squeal(["status"]);
    writeFileSync(join(OUT, "status-end.txt"), st.stdout + st.stderr);
    writeFileSync(join(OUT, "status-end.json"), squeal(["status", "--json"]).stdout);
  }
  serviceForTruth(knobs, { work: WORK, home: env.HOME, out: OUT, sh, log });
  await groundTruth({ cwd: WORK, env, out: OUT, log, graceMs: graceS * 1000 });
  const said = (a) => sh("git", a, { check: false }).stdout;
  writeFileSync(
    join(OUT, "diff.patch"),
    `${said(["diff", "--stat", head])}\n${said(["status", "--short"])}\n${said(["diff", head])}`,
  );
  if (plugin) {
    delete env.SQUEAL_CLI;
    await stopDaemon("cell end");
  }
  keepRecords(CELL, harness);
  const leftovers = await stopCellLeftovers();
  refuseAfterTeardown("the grade"); // with the harness's --version, its first process
  const meta = {
    id,
    run,
    task,
    variant: variantName,
    harness,
    model,
    effort,
    rep: Number(rep),
    cold,
    knobs,
    commit,
    head,
    pin: relative(ROOT, PIN),
    // 006-62: the cell's bare `squeal` was the pinned plugin's (the atomic trend reads it).
    ...(plugin && { squealPath: "pinned" }),
    setupS: +setupS.toFixed(1),
    wallS: +((T1 - T0) / 1000).toFixed(1),
    exit,
    ...(scenario && {
      kind: "atomic",
      userTurns: prompts.length,
      exits,
      turnStarts,
      settle: settle && {
        settled: settle.settled,
        why: settle.why,
        waitedMs: settle.waitedMs,
        pending: settle.pending ?? null,
      },
    }),
    load: {
      start: samples[0],
      max: Math.max(...samples),
      mean: +(samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(2),
      end: samples.at(-1),
    },
    daemonExits,
    leftovers,
    harnessVersion:
      spawnSync(cmd, ["--version"], { encoding: "utf8", env, timeout: 30_000 }).stdout?.trim() ??
      null,
  };
  writeFileSync(join(OUT, "meta.json"), JSON.stringify(meta, null, 2));
  const g = spawnSync("node", [join(EVALS, "bin/grade.mjs"), OUT], { encoding: "utf8" });
  if (g.status !== 0) log(`grade failed: ${g.stderr}`);
  else {
    log(`graded: ${g.stdout.trim().split("\n").at(-1)}`);
    if (scenario) pilot(meta);
    else await judge();
  }
}

/**
 * 006-33: an atomic cell's pilot record, graded mechanically into grade.json; its transcript is
 * kept, redacted, for a judged regrade later.
 */
function pilot(meta) {
  const file = join(OUT, "grade.json");
  const grade = JSON.parse(readFileSync(file, "utf8"));
  grade.transcript = (grade.transcript ?? []).map((s) =>
    redact(s, secrets).replaceAll(CELL, "<cell>"),
  );
  grade.atomic = pilotRecord(grade, {
    turns: meta.userTurns,
    turnStarts: meta.turnStarts,
    settle: meta.settle,
    scenario,
  });
  grade.usageTotal = usageOf(readEvents(OUT));
  writeFileSync(file, JSON.stringify(grade, null, 2));
  const m = Object.entries(grade.atomic.measures).map(([k, v]) => `${k} ${v}`);
  log(`pilot: ${m.join(", ") || "nothing scored"}`);
}

/**
 * Spec 006 D9: the cell's transcript, redacted, and the calibrated judge's verdicts on the four
 * judged expectations, written into grade.json beside the parser's. With no calibrated identity
 * for this Claude Code and rubric, or a judge that fails, they stay not computable.
 */
async function judge() {
  const file = join(OUT, "grade.json");
  const grade = JSON.parse(readFileSync(file, "utf8"));
  grade.transcript = (grade.transcript ?? []).map((s) =>
    redact(s, secrets).replaceAll(CELL, "<cell>"),
  );
  writeFileSync(file, JSON.stringify(grade, null, 2));
  try {
    const declared = declarations();
    const call = claudeRunner({ base: CELL });
    const runner = (a) => {
      refuseAfterTeardown("a judge call");
      return call(a);
    };
    const identity = await calibratedIdentity({ dir: join(EVALS, "results"), declared, runner });
    if (identity === null) {
      log(
        "judge: no calibrated identity for this Claude Code and rubric; the four stay not computable",
      );
      return;
    }
    const conditions = { tasks: { [task]: { knobs } } };
    const judged = await judgeRecord(cellRecord(grade), { identity, runner, declared, conditions });
    writeFileSync(file, JSON.stringify({ ...grade, ...judged }, null, 2));
    const said = Object.entries(judged.judge.verdicts).map(([id, v]) => `${id} ${v.grade}`);
    log(
      `judged by ${identityKey(identity)}: ${said.join(", ") || "nothing judged"}${judged.judge.error ? `; error: ${judged.judge.error}` : ""}`,
    );
  } catch (e) {
    log(`judge failed: ${e?.message ?? e}`);
  }
}

// ---------- the teardown, on every path: processes, daemons, scratch, evidence ----------
let teardown = null;
const tearDown = (why) => {
  teardown ??= (async () => {
    await killRunning("SIGKILL");
    delete env.SQUEAL_CLI;
    if (plugin && daemonPids(WORK).length) await stopDaemon(why, { teardown: true });
    await stopCellLeftovers();
    const scratch = clearScratch(CELL, secrets);
    writeFileSync(join(OUT, "scratch.json"), JSON.stringify(scratch, null, 2));
    log(
      `scratch: ${scratch.secretsBeforeRemoval.length} file(s) held a secret, ${scratch.sanitized.length} redacted, ${scratch.removed.length} removed, ${scratch.secretsAfterRemoval.length} still hold one`,
    );
    if (!scratch.secretsAfterRemoval.length) return 0;
    rmSync(join(OUT, "grade.json"), { force: true });
    log(`cell failed: a secret survived in ${scratch.secretsAfterRemoval.join(", ")}`);
    return 1;
  })();
  return teardown;
};
// The first signal's exit code: the lifecycle it stops ends too, and exits with it (006-97).
let signalled = null;
for (const [sig, n] of [
  ["SIGINT", 2],
  ["SIGTERM", 15],
  ["SIGHUP", 1],
])
  process.on(sig, async () => {
    log(`terminated by ${sig}`);
    signalled ??= 128 + n;
    await tearDown(sig);
    process.exit(signalled);
  });

let failed = false;
try {
  await lifecycle();
} catch (e) {
  failed = true;
  log(`cell failed: ${e?.message ?? e}`);
}
const code = await tearDown(failed ? "failure" : "cell end");
process.exit(signalled ?? (failed ? 1 : code));
