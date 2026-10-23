#!/usr/bin/env node
// Spec 006 D3, D5, D6, D8: the baseline against a commit of this repository's Squeal.
//   node evals/bin/run-baseline.mjs [--commit HEAD] [--parallel 2] [--max-load <cpus>]
//     [--variant <name>] [--stand-in <model>=<stand-in>] [--date YYYY-MM-DD] [--resume <run>]
//     [--repetitions <n>]  (overrides the config's repetitions; the results record it)
//     [--models <id,...>] [--tasks <id,...>]  (runs only those; a baseline's --tasks changes its
//     conditions, so it starts its own trend line)
// Every cell of evals/baseline.json runs through run-cell.mjs, 2 to 4 at once, each started only
// while the one-minute load average is below --max-load (the host's CPU count by default). A
// model whose first cell never reaches it is recorded as missing and not run again; --stand-in
// runs another model in its place, named in the results. Then it writes
// evals/results/<date>-<version>.<run>.json and regenerates TREND.md. --variant runs the shipped
// texts and the variant side by side (evals/variants/<name>.json) into
// <date>-<version>.<run>.<name>.json, which the trend leaves out: a variant comparison is its own
// run. Each arm's fixture commit holds its own instructions and policy, so each arm's conditions
// name its own fixture; cells of one arm on different fixtures abort the results.
// Every run has a fresh id, its cells under $SQ_EVALS_ROOT/cells/<commit>/<run>/ (default root
// /tmp/squeal-evals-<uid>), so two runs of one commit never share a cell or a results file. A root
// inside a repository is refused (exit 2) unless --force-root, which reaches every cell too.
// --resume <run> continues that run instead: its graded cells are skipped.
// --atomic runs the atomic scenarios instead (evals/atomic/atomic.json, 006-33): their models,
// repetitions, effort and cells at once (--parallel overrides), no judge (the pilot grades
// mechanically and keeps the transcripts), into <date>-<version>.<run>.atomic.json, which the
// trend leaves out, and regenerates evals/results/ATOMIC.md (006-36). With --variant it runs the
// shipped texts and the variant side by side (006-48) into
// <date>-<version>.<run>.<name>.atomic-variant.json, which ATOMIC.md and TREND.md both leave out;
// evals/bin/atomic-compare.mjs compares its arms.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism, loadavg } from "node:os";
import { join } from "node:path";
import { atomicConfig, scenarioOf } from "../lib/atomic.mjs";
import { declarations, expectationsOf } from "../lib/behaviours.mjs";
import { ensureCalibrated } from "../lib/calibration.mjs";
import { claudeRunner, identityKey } from "../lib/judge.mjs";
import {
  cellId,
  EVALS,
  fixtureModules,
  pinBase,
  pinVersion,
  resolveCommit,
  runId,
} from "../lib/prepare.mjs";
import {
  armFixtures,
  assertNoSecrets,
  cellRecord,
  conditionsOf,
  narrowed,
  resultsName,
} from "../lib/results.mjs";
import { evalsRoot, refuseInsideRepo } from "../lib/root.mjs";
import { secretsOf } from "../lib/scratch.mjs";
import { CLAUDE_ALLOWED_TOOLS, stopOnSignal } from "../lib/session.mjs";
import { expectationsRevision } from "../lib/trend.mjs";
import { buildPin } from "../lib/variant.mjs";

const argv = process.argv.slice(2);
const forceRoot = argv.includes("--force-root");
let ROOT;
try {
  ROOT = refuseInsideRepo(evalsRoot(), { force: forceRoot });
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
const opt = (name, dflt) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : dflt);
const commit = resolveCommit(opt("--commit", "HEAD"));
const atomic = argv.includes("--atomic");
const config = atomic
  ? atomicConfig()
  : JSON.parse(readFileSync(join(EVALS, "baseline.json"), "utf8"));
if (atomic) config.tasks = Object.keys(config.scenarios);
const listOpt = (name) => (argv.includes(name) ? opt(name).split(",") : null);
try {
  Object.assign(
    config,
    narrowed(config, { models: listOpt("--models"), tasks: listOpt("--tasks") }),
  );
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
if (argv.includes("--repetitions")) config.repetitions = Math.max(1, Number(opt("--repetitions")));
const parallel = Math.min(
  4,
  Math.max(1, Number(opt("--parallel", String(atomic ? config.parallel : 2)))),
);
const maxLoad = Number(opt("--max-load", String(availableParallelism())));
const variantArm = opt("--variant", null);
const date = opt("--date", new Date().toISOString().slice(0, 10));
const resume = opt("--resume", null);
const run = resume ?? runId();
const standIns = Object.fromEntries(
  argv.flatMap((a, i) => (argv[i - 1] === "--stand-in" ? [a.split("=")] : [])),
);
const knobs = JSON.parse(readFileSync(join(EVALS, "tasks/tasks.json"), "utf8")).tasks;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const load1 = () => loadavg()[0];

// ---------- the judge, calibrated before any session (spec 006 D9) ----------
// A Claude Code version or rubric with no passing calibration file is calibrated first: Haiku 5.5,
// then Sonnet 5.5. With none passing, the run stops here, before spending on any subject session.
// The atomic pilot is graded mechanically: no judge. SIGINT or SIGTERM ends this script's judge
// calls with it (006-98); its cells, in its process group, take a terminal's signal themselves.
stopOnSignal();
const judgeIdentity = atomic
  ? null
  : await ensureCalibrated({
      dir: join(EVALS, "results"),
      declared: declarations(),
      runner: claudeRunner({ base: ROOT }),
      calibrateModel: (model) =>
        new Promise((resolve) =>
          spawn(
            process.execPath,
            [
              "--import",
              "tsx",
              join(EVALS, "bin/judge-calibrate.mjs"),
              "--model",
              model,
              "--base",
              ROOT,
              ...(forceRoot ? ["--force-root"] : []),
            ],
            { cwd: join(EVALS, ".."), stdio: "inherit" },
          ).on("close", resolve),
        ),
      log: console.log,
    });
if (!atomic && !judgeIdentity) {
  console.error(
    "judge: no model passed calibration for this Claude Code and rubric (spec 006 D9); no session ran. Commit the calibration files in evals/results and ask the human.",
  );
  process.exit(3);
}
if (judgeIdentity)
  console.log(`judge: ${identityKey(judgeIdentity)}; commit its calibration file with the results`);

// ---------- what every cell shares, built before any cell starts ----------
const base = pinBase(ROOT, commit);
const version = pinVersion(base);
fixtureModules(ROOT);
const arms = variantArm ? [config.variant, variantArm] : [config.variant];
for (const arm of arms) {
  const v = JSON.parse(readFileSync(join(EVALS, "variants", `${arm}.json`), "utf8"));
  buildPin(base, join(ROOT, "pins", commit, arm), arm, v);
}

// ---------- the plan: by repetition, so a run cut short stays balanced ----------
const plan = [];
for (let rep = 1; rep <= config.repetitions; rep++) {
  for (const task of config.tasks) {
    for (const m of config.models) {
      for (const variant of arms) {
        const model = standIns[m.model] ?? m.model;
        plan.push({
          task,
          variant,
          harness: m.harness,
          model,
          baselineModel: m.model,
          rep,
          effort: config.effort,
        });
      }
    }
  }
}
const outDir = (c) => join(ROOT, "cells", commit.slice(0, 12), run, cellId(c), "out");
const missing = new Set();
const failed = [];
console.log(
  `${atomic ? "atomic" : "baseline"} ${resume ? "resuming " : ""}run ${run}: Squeal ${version} at ${commit.slice(0, 12)}, ${plan.length} cells, ${parallel} at once below load ${maxLoad}`,
);

async function runCell(c) {
  for (;;) {
    while (load1() >= maxLoad) {
      console.log(`hold (load ${load1().toFixed(1)}): ${cellId(c)}`);
      await sleep(30_000);
    }
    const args = [
      join(EVALS, "bin/run-cell.mjs"),
      c.task,
      c.variant,
      c.harness,
      c.model,
      String(c.rep),
    ];
    args.push(
      "--commit",
      commit,
      "--run",
      run,
      "--effort",
      c.effort,
      "--max-load",
      String(maxLoad),
    );
    if (resume) args.push("--resume");
    if (forceRoot) args.push("--force-root");
    const code = await new Promise((resolve) =>
      spawn(process.execPath, args, { stdio: "inherit" }).on("close", resolve),
    );
    if (code === 75) {
      await sleep(30_000);
      continue;
    }
    const gradeFile = join(outDir(c), "grade.json");
    if (code !== 0 || !existsSync(gradeFile)) failed.push({ id: cellId(c), exit: code });
    else if (JSON.parse(readFileSync(gradeFile, "utf8")).reachedModel === false)
      missing.add(c.model);
    return;
  }
}

const queue = [...plan];
await Promise.all(
  Array.from({ length: parallel }, async (_, w) => {
    await sleep(w * 20_000); // stagger the warm-ups
    for (let c = queue.shift(); c; c = queue.shift()) {
      if (missing.has(c.model)) continue;
      await runCell(c);
    }
  }),
);

// ---------- the results file and the trend ----------
const grades = plan
  .map((c) => join(outDir(c), "grade.json"))
  .filter((f) => existsSync(f))
  .map((f) => JSON.parse(readFileSync(f, "utf8")))
  .filter((g) => !g.skipped);
const fixtures = armFixtures(grades, arms);
// An atomic scenario's prompt is its turns' prompts, in order.
const tasksOf = () =>
  Object.fromEntries(
    config.tasks.map((t) => [
      t,
      atomic
        ? { prompt: scenarioOf(t, config).prompts.join("\n"), knobs: config.scenarios[t].knobs }
        : {
            prompt:
              readFileSync(join(EVALS, "tasks", `${t}.txt`), "utf8") +
              readFileSync(join(EVALS, "tasks/_ending.txt"), "utf8"),
            knobs: knobs[t] ?? {},
          },
    ]),
  );
const conditions = Object.fromEntries(
  arms.map((arm) => [
    arm,
    conditionsOf({
      fixture: fixtures[arm],
      tasks: tasksOf(),
      variant: arm,
      effort: config.effort,
      tools: { claude: CLAUDE_ALLOWED_TOOLS },
    }),
  ]),
);
const harnessVersions = Object.fromEntries(grades.map((g) => [g.harness, g.harnessVersion]));
const results = {
  schema: 1,
  kind: atomic ? (variantArm ? "atomic-variant" : "atomic") : variantArm ? "variant" : "baseline",
  date,
  run,
  squealVersion: version,
  commit,
  conditions: conditions[config.variant],
  ...(variantArm ? { variantConditions: conditions[variantArm] } : {}),
  harnesses: harnessVersions,
  models: config.models.map((m) => {
    const ran = standIns[m.model] ?? m.model;
    return {
      harness: m.harness,
      model: m.model,
      status: missing.has(ran) ? "missing" : "served",
      ...(ran !== m.model ? { standIn: ran } : {}),
    };
  }),
  load: { cpus: availableParallelism(), maxLoad, parallel },
  failed,
  // An atomic cell keeps the pilot's mechanical record and every turn's usage (006-33).
  cells: grades.map((g) => ({
    ...cellRecord(g),
    ...(atomic && { atomic: g.atomic ?? null, usageTotal: g.usageTotal ?? null }),
  })),
  ...(atomic && {
    scenarios: Object.fromEntries(
      config.tasks.map((t) => {
        const { measures = [], breaks, turns } = config.scenarios[t];
        return [t, { turns: turns.length, measures, breaks }];
      }),
    ),
    settleS: config.settleS,
    repetitions: config.repetitions,
  }),
};
// Graded under the current expectations at write time (spec 006 D4), as regrade.mjs would.
// An atomic run declares measures, not the baseline's expectations.
const declared = declarations();
if (!atomic) {
  results.expectationsRevision = expectationsRevision(declared);
  for (const cell of results.cells)
    cell.expectations = expectationsOf(cell, results.conditions, declared);
}
const text = `${JSON.stringify(results, null, 1)}\n`;
const realCodex = join(process.env.HOME, ".codex/config.toml");
assertNoSecrets(
  text,
  secretsOf(process.env, existsSync(realCodex) ? readFileSync(realCodex, "utf8") : ""),
);
const file = join(
  EVALS,
  "results",
  resultsName({ date, version, run, variant: variantArm, atomic }),
);
writeFileSync(file, text, { flag: "wx" }); // never over another run's results
console.log(
  `wrote ${file}: ${grades.length} cells, ${failed.length} failed, missing: ${[...missing].join(", ") || "none"}`,
);
// An atomic run regenerates ATOMIC.md (006-36), which TREND.md leaves out.
await new Promise((resolve) =>
  spawn(process.execPath, [join(EVALS, `bin/${atomic ? "atomic-trend" : "trend"}.mjs`)], {
    stdio: "inherit",
  }).on("close", resolve),
);
