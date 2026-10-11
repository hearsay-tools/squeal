#!/usr/bin/env node
// Spec 006 D3, D5, D6, D8: the baseline against a commit of this repository's Squeal.
//   node evals/bin/run-baseline.mjs [--commit HEAD] [--parallel 2] [--max-load <cpus>]
//     [--variant <name>] [--stand-in <model>=<stand-in>] [--date YYYY-MM-DD] [--resume <run>]
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
// <tmpdir>/squeal-evals), so two runs of one commit never share a cell or a results file.
// --resume <run> continues that run instead: its graded cells are skipped.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism, loadavg, tmpdir } from "node:os";
import { join } from "node:path";
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
  resultsName,
} from "../lib/results.mjs";
import { declarations, expectationsOf } from "../lib/behaviours.mjs";
import { expectationsRevision } from "../lib/trend.mjs";
import { secretsOf } from "../lib/scratch.mjs";
import { buildPin } from "../lib/variant.mjs";

const ROOT = process.env.SQ_EVALS_ROOT ?? join(tmpdir(), "squeal-evals");
const argv = process.argv.slice(2);
const opt = (name, dflt) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : dflt);
const commit = resolveCommit(opt("--commit", "HEAD"));
const parallel = Math.min(4, Math.max(1, Number(opt("--parallel", "2"))));
const maxLoad = Number(opt("--max-load", String(availableParallelism())));
const variantArm = opt("--variant", null);
const date = opt("--date", new Date().toISOString().slice(0, 10));
const resume = opt("--resume", null);
const run = resume ?? runId();
const standIns = Object.fromEntries(
  argv.flatMap((a, i) => (argv[i - 1] === "--stand-in" ? [a.split("=")] : [])),
);
const config = JSON.parse(readFileSync(join(EVALS, "baseline.json"), "utf8"));
const knobs = JSON.parse(readFileSync(join(EVALS, "tasks/tasks.json"), "utf8")).tasks;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const load1 = () => loadavg()[0];

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
  `baseline ${resume ? "resuming " : ""}run ${run}: Squeal ${version} at ${commit.slice(0, 12)}, ${plan.length} cells, ${parallel} at once below load ${maxLoad}`,
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
const tasksOf = () =>
  Object.fromEntries(
    config.tasks.map((t) => [
      t,
      {
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
    }),
  ]),
);
const harnessVersions = Object.fromEntries(grades.map((g) => [g.harness, g.harnessVersion]));
const results = {
  schema: 1,
  kind: variantArm ? "variant" : "baseline",
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
  cells: grades.map(cellRecord),
};
// Graded under the current expectations at write time (spec 006 D4), as regrade.mjs would.
const declared = declarations();
results.expectationsRevision = expectationsRevision(declared);
for (const cell of results.cells)
  cell.expectations = expectationsOf(cell, results.conditions, declared);
const text = `${JSON.stringify(results, null, 1)}\n`;
const realCodex = join(process.env.HOME, ".codex/config.toml");
assertNoSecrets(
  text,
  secretsOf(process.env, existsSync(realCodex) ? readFileSync(realCodex, "utf8") : ""),
);
const file = join(EVALS, "results", resultsName({ date, version, run, variant: variantArm }));
writeFileSync(file, text, { flag: "wx" }); // never over another run's results
console.log(
  `wrote ${file}: ${grades.length} cells, ${failed.length} failed, missing: ${[...missing].join(", ") || "none"}`,
);
await new Promise((resolve) =>
  spawn(process.execPath, [join(EVALS, "bin/trend.mjs")], { stdio: "inherit" }).on(
    "close",
    resolve,
  ),
);
