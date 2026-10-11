#!/usr/bin/env node
// Spec 006 D3: one eval cell (task x variant x harness x model x repetition) end to end, isolated.
//   node evals/bin/run-cell.mjs <task> <variant> <claude|codex> <model> [rep]
//     [--commit HEAD] [--run <id>] [--resume] [--effort medium] [--cold] [--dry]
//     [--max-load <cpus>] [--timeout-s 900] [--grace-s 10]
// --dry builds the cell and warms it, then stops the daemon without a session. --effort pins the
// reasoning effort: `claude -p --effort <level>`, `codex exec -c model_reasoning_effort="<level>"`.
// The task's knobs come from evals/tasks/tasks.json. Exit 75: held, the load is too high.
// --run names the run the cell belongs to (a fresh id by default); a cell already graded in that
// run is skipped with --resume and refused without it (exit 2), so no run overwrites another.
// Exit 1: the cell failed (setup, a session that could not start, or a secret that survived).
//
// Everything lives under $SQ_EVALS_ROOT (default <tmpdir>/squeal-evals):
//   pin-base/<commit>/      `git archive` of the commit's plugins
//   nm/node_modules         the fixture's Vitest, copied into each cell
//   pins/<commit>/<variant> the variant's patched copy (evals/variants/<variant>.json)
//   cells/<commit>/<run>/<id>/home, codex, tmp   HOME, CODEX_HOME and TMPDIR; removed at the end
//   cells/<commit>/<run>/<id>/work   the fixture, committed at a fixed date, warmed unless --cold
//   cells/<commit>/<run>/<id>/out    events.jsonl, load.tsv, truth.json, status-end.json, diff,
//                                    store copy, grade.json, scratch.json
// Whatever happens, setup exception, timeout or SIGTERM, the teardown runs: the session's process
// group and every daemon the cell started are stopped, any process still naming the cell is
// killed, the scratch is removed and the retained evidence is scanned, every secret in it
// redacted or its file removed. A secret that survives fails the cell and drops its grade.

import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, loadavg, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { daemonPids, stopDaemons, stopLeftovers } from "../lib/daemon.mjs";
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
import {
  cellEnv,
  clearScratch,
  codexConfig,
  keepRecords,
  providerVariables,
  redact,
  secretsOf,
} from "../lib/scratch.mjs";
import { groundTruth, killRunning, runSession, sessionCommand } from "../lib/session.mjs";
import { buildPin } from "../lib/variant.mjs";

const ROOT = process.env.SQ_EVALS_ROOT ?? join(tmpdir(), "squeal-evals");
let args;
try {
  args = cellArgs(process.argv.slice(2), { runId, maxLoad: availableParallelism() });
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
const { dry, cold, resume, run, maxLoad, timeoutS, graceS, effort } = args;
const { task, variant: variantName, harness, model, rep } = args;
const commit = resolveCommit(args.commit);

const variant = JSON.parse(readFileSync(join(EVALS, "variants", `${variantName}.json`), "utf8"));
const knobs =
  JSON.parse(readFileSync(join(EVALS, "tasks", "tasks.json"), "utf8")).tasks[task] ?? {};
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
const sh = (cmd, args, opts = {}) => {
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
  sh("node", ["--disable-warning=ExperimentalWarning", CLI, ...args], { check: false, ...opts });
const daemonExits = [];
const stopDaemon = async (why) => {
  const stop = () => {
    if (!CLI || !existsSync(join(WORK, ".git"))) return null;
    const r = squeal(["stop", WORK]);
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
  const head = buildFixture({ work: WORK, variant, env, modules: fixtureModules(ROOT) });
  log(`fixture ${head}, pin ${relative(ROOT, PIN)}, run ${run}, load ${load1().toFixed(1)}`);

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
  if (plugin && !cold) {
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

  // The session.
  const prompt = `${readFileSync(join(EVALS, "tasks", `${task}.txt`), "utf8").trim()}\n${readFileSync(join(EVALS, "tasks", "_ending.txt"), "utf8")}`;
  writeFileSync(join(OUT, "prompt.txt"), prompt);
  const [cmd, args] = sessionCommand({
    harness,
    prompt,
    model,
    effort,
    pluginDir: plugin ? join(PIN, "plugins/claude-code") : null,
  });
  log(`session ${cmd} ${model} effort ${effort} start, load ${load1().toFixed(1)}`);
  const {
    exit,
    t0: T0,
    t1: T1,
    samples,
  } = await runSession({
    command: cmd,
    args,
    cwd: WORK,
    env,
    out: OUT,
    timeoutS,
    graceS,
    log,
  });
  log(`session end ${JSON.stringify(exit)} after ${((T1 - T0) / 1000).toFixed(1)} s`);
  if (exit.spawnError) throw new Error(`the session could not start: ${cmd} ${exit.spawnError}`);

  // After: Squeal's view, ground truth, diff against the fixture, store copy, daemons stopped.
  if (plugin) {
    const st = squeal(["status"]);
    writeFileSync(join(OUT, "status-end.txt"), st.stdout + st.stderr);
    writeFileSync(join(OUT, "status-end.json"), squeal(["status", "--json"]).stdout);
  }
  await groundTruth({ cwd: WORK, env, out: OUT, log, graceMs: graceS * 1000 });
  const git = (a) => sh("git", a, { check: false }).stdout;
  writeFileSync(
    join(OUT, "diff.patch"),
    `${git(["diff", "--stat", head])}\n${git(["status", "--short"])}\n${git(["diff", head])}`,
  );
  if (plugin) {
    delete env.SQUEAL_CLI;
    await stopDaemon("cell end");
  }
  keepRecords(CELL, harness);
  const leftovers = await stopCellLeftovers();
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
    setupS: +setupS.toFixed(1),
    wallS: +((T1 - T0) / 1000).toFixed(1),
    exit,
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
  else log(`graded: ${g.stdout.trim().split("\n").at(-1)}`);
}

// ---------- the teardown, on every path: processes, daemons, scratch, evidence ----------
let teardown = null;
const tearDown = (why) => {
  teardown ??= (async () => {
    killRunning("SIGKILL");
    delete env.SQUEAL_CLI;
    if (plugin && daemonPids(WORK).length) await stopDaemon(why);
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
for (const [sig, n] of [
  ["SIGINT", 2],
  ["SIGTERM", 15],
  ["SIGHUP", 1],
])
  process.on(sig, async () => {
    log(`terminated by ${sig}`);
    await tearDown(sig);
    process.exit(128 + n);
  });

let failed = false;
try {
  await lifecycle();
} catch (e) {
  failed = true;
  log(`cell failed: ${e?.message ?? e}`);
}
const code = await tearDown(failed ? "failure" : "cell end");
process.exit(failed ? 1 : code);
