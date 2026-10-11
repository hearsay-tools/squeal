#!/usr/bin/env node
// Spec 006 D3: one eval cell (task x variant x harness x model x repetition) end to end, isolated.
//   node evals/bin/run-cell.mjs <task> <variant> <claude|codex> <model> [rep]
//     [--commit HEAD] [--effort medium] [--cold] [--dry] [--max-load <cpus>] [--timeout-s 900]
// --dry builds the cell and warms it, then stops the daemon without a session. --effort pins the
// reasoning effort: `claude -p --effort <level>`, `codex exec -c model_reasoning_effort="<level>"`.
// The task's knobs come from evals/tasks/tasks.json. Exit 75: held, the load is too high.
//
// Everything lives under $SQ_EVALS_ROOT (default <tmpdir>/squeal-evals):
//   pin-base/<commit>/      `git archive` of the commit's plugins
//   nm/node_modules         the fixture's Vitest, copied into each cell
//   pins/<commit>/<variant> the variant's patched copy (evals/variants/<variant>.json)
//   cells/<commit>/<id>/home, codex, tmp   HOME, CODEX_HOME and TMPDIR for the subject; removed at the end
//   cells/<commit>/<id>/work         the fixture, committed at a fixed date, its store warmed unless --cold
//   cells/<commit>/<id>/out          events.jsonl (timestamped), load.tsv, truth, diff, store copy, grade.json
// Every daemon the cell started is stopped and waited for; any process still naming the cell is
// listed and killed; the scratch is scanned for credentials before it is removed.

import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, loadavg, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { daemonPids, waitForExit } from "../lib/daemon.mjs";
import { cellId, EVALS, fixtureModules, pinBase, resolveCommit } from "../lib/prepare.mjs";
import {
  cellEnv,
  clearScratch,
  codexConfig,
  providerVariables,
  secretsOf,
} from "../lib/scratch.mjs";
import { runSession, sessionCommand } from "../lib/session.mjs";
import { buildPin } from "../lib/variant.mjs";

const ROOT = process.env.SQ_EVALS_ROOT ?? join(tmpdir(), "squeal-evals");
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(name);
  if (i < 0) return dflt;
  return argv.splice(i, 2)[1];
};
const has = (name) => {
  const i = argv.indexOf(name);
  if (i >= 0) argv.splice(i, 1);
  return i >= 0;
};
const dry = has("--dry");
const cold = has("--cold");
const maxLoad = Number(flag("--max-load", String(availableParallelism())));
const timeoutS = Number(flag("--timeout-s", "900"));
const effort = flag("--effort", "medium");
const commit = resolveCommit(flag("--commit", "HEAD"));
if (!/^(low|medium|high|xhigh|max)$/.test(effort))
  throw new Error(`--effort ${effort}: not a level both harnesses take`);
const [task, variantName, harness, model, rep = "1"] = argv;
if (!task || !variantName || !["claude", "codex"].includes(harness) || !model) {
  console.error(
    "usage: run-cell.mjs <task> <variant> <claude|codex> <model> [rep] [--commit HEAD] [--effort medium] [--cold] [--dry]",
  );
  process.exit(2);
}
if (/opus|fable/i.test(model))
  throw new Error("never Opus or Fable as a subject model (spec 006 D5)");

const variant = JSON.parse(readFileSync(join(EVALS, "variants", `${variantName}.json`), "utf8"));
const knobs =
  JSON.parse(readFileSync(join(EVALS, "tasks", "tasks.json"), "utf8")).tasks[task] ?? {};
const id = cellId({ task, variant: variantName, harness, model, effort, rep, cold });
const CELL = join(ROOT, "cells", commit.slice(0, 12), id);
const OUT = join(CELL, "out");
const WORK = join(CELL, "work");
if (existsSync(join(OUT, "grade.json"))) {
  console.log(`skip ${id}: already graded`);
  process.exit(0);
}
const load1 = () => loadavg()[0];
if (load1() >= maxLoad) {
  console.log(`held ${id}: load ${load1().toFixed(1)} >= ${maxLoad}`);
  process.exit(75);
}

rmSync(CELL, { recursive: true, force: true });
for (const d of ["home", "tmp", "work", "out", "codex"])
  mkdirSync(join(CELL, d), { recursive: true });
const log = (s) => {
  appendFileSync(join(OUT, "runner.log"), `${new Date().toISOString()} ${s}\n`);
  console.log(`[${id}] ${s}`);
};

const realCodex = existsSync(join(process.env.HOME, ".codex/config.toml"))
  ? readFileSync(join(process.env.HOME, ".codex/config.toml"), "utf8")
  : "";
const env = cellEnv(process.env, CELL, providerVariables(harness, process.env, realCodex));
if (knobs.flakeColdRuns) env.LEDGERLINE_CALENDAR_COLD_RUNS = String(knobs.flakeColdRuns);
const fixedDate = {
  GIT_AUTHOR_DATE: "2026-10-01T09:00:00Z",
  GIT_COMMITTER_DATE: "2026-10-01T09:00:00Z",
};
const sh = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, {
    cwd: WORK,
    env: { ...env, ...opts.env },
    encoding: "utf8",
    timeout: opts.timeout ?? 600_000,
  });
  if (opts.check !== false && r.status !== 0)
    throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}: ${r.stderr}${r.stdout}`);
  return r;
};

// ---------- the variant's pinned plugin copy, and the fixture committed at a fixed date ----------
const t0Setup = Date.now();
const PIN = buildPin(
  pinBase(ROOT, commit),
  join(ROOT, "pins", commit, variantName),
  variantName,
  variant,
);
const CLI = join(
  PIN,
  "plugins",
  harness === "codex" ? "codex" : "claude-code",
  "dist/cli/squeal.mjs",
);
const squeal = (args, opts = {}) =>
  sh("node", ["--disable-warning=ExperimentalWarning", CLI, ...args], { check: false, ...opts });
cpSync(join(EVALS, "ledgerline"), WORK, { recursive: true });
const base = readFileSync(join(WORK, "BASE.md"), "utf8");
rmSync(join(WORK, "BASE.md"));
const instructions = variant.instructions ? `${base}\n${variant.instructions}` : base;
writeFileSync(join(WORK, "CLAUDE.md"), instructions);
writeFileSync(join(WORK, "AGENTS.md"), instructions);
if (variant.policy) {
  const p = JSON.parse(readFileSync(join(WORK, "squeal.config.json"), "utf8"));
  writeFileSync(
    join(WORK, "squeal.config.json"),
    `${JSON.stringify({ ...p, ...variant.policy }, null, 2)}\n`,
  );
}
cpSync(fixtureModules(ROOT), join(WORK, "node_modules"), {
  recursive: true,
  verbatimSymlinks: true,
  preserveTimestamps: true,
});
sh("git", ["init", "-q", "-b", "main"]);
sh("git", ["add", "-A"]);
sh("git", ["commit", "-qm", "ledgerline 1.4.0"], { env: fixedDate });
const head = sh("git", ["rev-parse", "HEAD"]).stdout.trim();
log(`fixture ${head}, pin ${relative(ROOT, PIN)}, load ${load1().toFixed(1)}`);

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
    process.exit(0);
  }
}

// ---------- Codex: scratch CODEX_HOME, the host's provider block, the pinned plugin installed ----------
if (harness === "codex") {
  writeFileSync(join(CELL, "codex/config.toml"), codexConfig(realCodex, model));
  if (variant.plugin !== false) {
    sh("codex", ["plugin", "marketplace", "add", PIN]);
    sh("codex", ["plugin", "add", "squeal@hearsay"]);
    const trust = squeal(["init", "--harness", "codex", "--trust", "--yes"]);
    log(`codex trust: ${(trust.stdout + trust.stderr).split("\n").filter(Boolean).at(-1) ?? ""}`);
    sh("git", ["checkout", "-q", "--", "."], { check: false });
  }
}

// ---------- the daemon: warm unless --cold, then the task's knobs ----------
const stopDaemon = async (why) => {
  const pids = daemonPids(WORK);
  const stop = squeal(["stop", WORK]);
  const exits = await waitForExit([...new Set([...pids, ...daemonPids(WORK)])]);
  log(
    `daemon stopped (${why}): ${(stop.stdout + stop.stderr).trim().split("\n").at(-1) ?? ""}; ${JSON.stringify(exits)}`,
  );
  return exits;
};
const daemonExits = [];
const plugin = variant.plugin !== false;
if (plugin && !cold) {
  // The flake knob warms with the flake off, then restarts the daemon with it on.
  const warm = knobs.flakeColdRuns ? { env: { LEDGERLINE_CALENDAR_WARM: "1" } } : {};
  squeal(["start"], warm);
  const w = squeal(["run", "--all", "--wait"], warm);
  writeFileSync(join(OUT, "warmup.txt"), w.stdout + w.stderr);
  log(`warm-up: ${(w.stdout.match(/^Known failures: .*$/m) ?? ["?"])[0]}`);
  if (knobs.flakeColdRuns) {
    daemonExits.push(...(await stopDaemon("flake knob")));
    squeal(["start"]);
  }
}
if (plugin && knobs.daemon === "stopped") {
  daemonExits.push(...(await stopDaemon("daemon knob")));
  env.SQUEAL_CLI = join(CELL, "no-daemon", "squeal.mjs"); // names no file: nothing can start one
}
if (knobs.staleEdit) {
  if (plugin) daemonExits.push(...(await stopDaemon("stale-edit knob")));
  appendFileSync(join(WORK, knobs.staleEdit.path), knobs.staleEdit.append);
  log(`stale edit: ${knobs.staleEdit.path}`);
}
const setupS = (Date.now() - t0Setup) / 1000;
if (dry) {
  writeFileSync(
    join(OUT, "git-status.txt"),
    sh("git", ["status", "--short", "--ignored"], { check: false }).stdout,
  );
  if (plugin) await stopDaemon("dry run");
  const scratch = clearScratch(CELL, secretsOf(process.env, realCodex));
  writeFileSync(join(OUT, "scratch.json"), JSON.stringify(scratch, null, 2));
  log(`dry run: setup ${setupS.toFixed(1)} s; scratch ${JSON.stringify(scratch)}`);
  process.exit(0);
}

// ---------- the session ----------
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
} = await runSession({ command: cmd, args, cwd: WORK, env, out: OUT, timeoutS, log });
log(`session end ${JSON.stringify(exit)} after ${((T1 - T0) / 1000).toFixed(1)} s`);

// ---------- after: Squeal's view, ground truth, diff, store copy, daemons stopped ----------
if (plugin) {
  const st = squeal(["status"]);
  writeFileSync(join(OUT, "status-end.txt"), st.stdout + st.stderr);
}
sh("npx", ["vitest", "run", "--reporter=json", `--outputFile=${join(OUT, "truth.vitest.json")}`], {
  check: false,
  env: { LEDGERLINE_CALENDAR_WARM: "1" },
  timeout: 180_000,
});
const nodeFiles = existsSync(join(WORK, "scripts"))
  ? readdirSync(join(WORK, "scripts"))
      .filter((f) => f.endsWith(".test.mjs"))
      .map((f) => `scripts/${f}`)
  : [];
const truthN = nodeFiles.length
  ? sh("node", ["--test", ...nodeFiles], { check: false, timeout: 60_000 })
  : { status: 0, stdout: "", stderr: "" };
writeFileSync(join(OUT, "truth.node.txt"), truthN.stdout + (truthN.stderr ?? ""));
writeFileSync(join(OUT, "truth.txt"), `node:test exit ${truthN.status}\n`);
const git = (a) => sh("git", a, { check: false }).stdout;
writeFileSync(
  join(OUT, "diff.patch"),
  `${git(["diff", "--stat"])}\n${git(["status", "--short"])}\n${git(["diff"])}`,
);
if (plugin) {
  delete env.SQUEAL_CLI;
  daemonExits.push(...(await stopDaemon("cell end")));
  const store = join(WORK, ".git/squeal");
  if (existsSync(store)) {
    mkdirSync(join(OUT, "store"), { recursive: true });
    for (const f of readdirSync(store))
      if (/^store\.sqlite/.test(f)) cpSync(join(store, f), join(OUT, "store", f));
  }
}
// Anything still running from this cell is ours: list it, then stop it.
const leftovers = (spawnSync("pgrep", ["-af", CELL], { encoding: "utf8" }).stdout ?? "")
  .split("\n")
  .filter((l) => l && !l.includes("pgrep") && !l.includes("run-cell.mjs"));
if (leftovers.length) {
  log(`leftover processes: ${leftovers.length}`);
  appendFileSync(join(OUT, "leftovers.txt"), `${leftovers.join("\n")}\n`);
  await waitForExit(
    leftovers.map((l) => Number(l.split(" ")[0])),
    0,
  );
}

const meta = {
  id,
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
  leftovers: leftovers.length,
  harnessVersion: spawnSync(cmd, ["--version"], { encoding: "utf8", env }).stdout?.trim() ?? null,
};
writeFileSync(join(OUT, "meta.json"), JSON.stringify(meta, null, 2));
const g = spawnSync("node", [join(EVALS, "bin/grade.mjs"), OUT], { encoding: "utf8" });
if (g.status !== 0) log(`grade failed: ${g.stderr}`);
else log(`graded: ${g.stdout.trim().split("\n").at(-1)}`);

// ---------- the scratch: scanned for credentials, then removed ----------
const scratch = clearScratch(CELL, secretsOf(process.env, realCodex));
writeFileSync(join(OUT, "scratch.json"), JSON.stringify(scratch, null, 2));
log(
  `scratch: ${scratch.secretsBeforeRemoval.length} file(s) held a secret before removal, ${scratch.secretsAfterRemoval.length} after`,
);
