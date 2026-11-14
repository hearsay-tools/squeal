import type { CollectOptions } from "../core/code/gate/collect.js";
import type { BudgetFit, EstimateLoad, RunEstimate } from "../core/code/gate/estimate.js";
import type { BudgetTold } from "../core/code/gate/plan.js";
import type { BasePolicy } from "../core/code/gate/policy.js";
import type { SelectionSummary } from "../core/code/gate/prerun.js";
import type { WholeProject } from "../core/code/gate/setup-selection.js";
import { type ChangedSet, RUNNER_NAMES } from "../core/code/gate/types.js";
import { createInputMatcher } from "../core/keys/glob.js";
import { listPaths, plural, shellWord } from "../core/text.js";
import type { GlobalSetupEntry } from "../core/types/runner.js";
import type { GateArgs } from "./code-gate-args.js";
import { loadsChangedText } from "./code-gate-text.js";
import type { CliIo } from "./main.js";
import { statusCommand } from "./status-command.js";

/*
 * Spec 020 D14.4 (row 020-15b, which carries 020-16a): what `squeal code
 * --base` tells on stderr after selection and before its first run, so
 * before any global setup writes: the files selected by runner and group,
 * how many of them run when the stores or the parts give the others, each
 * group the scope left out, the projects whose global setup runs, and
 * each changed path no test Squeal runs loads, with the ways out. Rows
 * 020-34 and 020-35: the files declared `inputs` chose, and with
 * `coverage.children` a weaker line while some selected file runs.
 * D17.1 (row 020-17a): each runner's estimate, after the stored lookup.
 * Rows 020-45 and 020-46 (#196, #198): over what is left of the budget,
 * one rerun command with a fitted `--timeout`; at twice it, the files the
 * gate runs and those it stops early before.
 * Row 020-57 (#212): an estimate the host's load scaled says so, and a
 * changed path every test file of a project depends on, such as a
 * `setupFiles` entry, is named with the files it selects and the whole
 * run's estimate against the budget, before the runners' estimates.
 */

/**
 * One runner's line: its selected files by group, and, when the stores or
 * the parts give some of them, how many run apart (review 0.1.432 B2).
 * Row 020-35: then the files only their declared `inputs` chose.
 */
function runnerLine(selection: SelectionSummary["runners"][number]): string {
  const { runner, files, run, known, groups } = selection;
  const name = RUNNER_NAMES[runner];
  if (files === 0) return `${name}: no test file to run`;
  const byGroup =
    groups.length === 0 ? "" : ` (${groups.map((g) => `${g.name} ${g.files}`).join(", ")})`;
  const declared = byInputsText(selection.byInputs ?? []);
  if (run === files) return `${name}: ${plural(files, "test file")} to run${byGroup}${declared}`;
  const read = [
    ...(known.parts === 0 ? [] : [`${known.parts} read from the parts`]),
    ...(known.store === 0 ? [] : [`${known.store} read from the stores`]),
  ];
  const runs = `${run === 0 ? "none" : run} to run`;
  return `${name}: ${plural(files, "test file")} selected${byGroup}: ${[runs, ...read].join(", ")}${declared}`;
}

/** How many files of `byInputs` the line names before it only counts them. */
const NAMED = 3;

/** D3.1 (row 020-35): the files only declared `inputs` chose, the first `NAMED` by path. */
function byInputsText(byInputs: readonly string[]): string {
  if (byInputs.length === 0) return "";
  const more = byInputs.length > NAMED ? ` and ${byInputs.length - NAMED} more` : "";
  const names = `${byInputs.slice(0, NAMED).join(", ")}${more}`;
  return `; ${byInputs.length} by declared inputs at the base, not by imports: ${names}`;
}

function leftOutLine({
  name,
  at,
  files,
  selected,
  add,
}: SelectionSummary["leftOut"][number]): string {
  const of = `of its ${plural(files, "test file")}`;
  const what =
    selected === 0
      ? `none ${of} loads changed code`
      : `${selected} ${of} ${loadsChangedText(selected, add)}`;
  return `${name} (${at}) is left out: ${what}`;
}

const setupName = (s: GlobalSetupEntry) =>
  s.root ? "the root project (any selection)" : s.project;

/** 020-16a: a changed path no test Squeal runs loads, and the ways out. */
function unloadedLine(path: string, functions: number): string {
  return [
    `no test Squeal runs loads ${path}: no Vitest or node:test project lists it, and no listed test file imports it.`,
    `Its ${plural(functions, "changed function")} will read incomplete (no-loader).`,
    "To measure it, give it to a runner (a nodeTest entry, with prepare when it needs a build);",
    "to skip its coverage, name it in coverage.exclude at the base.",
  ].join(" ");
}

/**
 * Row 020-34 (D14.4): with `coverage.children`, a changed path no selected
 * test file imports, while some of them run: a process one starts may
 * still load it; else the ways in.
 */
function childMayLoadLine(path: string, functions: number): string {
  return [
    `no selected test file imports ${path}.`,
    "With coverage.children, it is measured only if a process one of them starts loads it;",
    `else its ${plural(functions, "changed function")} will read incomplete (no-loader).`,
    "To select a test that starts it, give the test with --test or declare the path for it in inputs at the base;",
    "to skip its coverage, name it in coverage.exclude at the base.",
  ].join(" ");
}

/** The pre-run lines of `summary`, each with its line feed; `changed` counts each unloaded path's functions. */
export function preRunText(summary: SelectionSummary, changed: ChangedSet): string {
  const setups = summary.setups.map(setupName);
  const functions = (path: string) => changed.functions.filter((f) => f.path === path).length;
  const lines = [
    ...summary.runners.map(runnerLine),
    ...summary.leftOut.map(leftOutLine),
    ...(setups.length === 0 ? [] : [`global setup runs for: ${setups.join(", ")}`]),
    ...summary.unloaded.map((path) => unloadedLine(path, functions(path))),
    ...(summary.childMayLoad ?? []).map((path) => childMayLoadLine(path, functions(path))),
  ];
  return lines.map((line) => `squeal code: ${line}\n`).join("");
}

/**
 * The collector's options that write the selection (D14.4) and the
 * estimate (D17.1) to `stderr` before the first run. A path
 * `coverage.exclude` matches at the base needs no loader, so it gets no
 * line (D6). Row 020-57: the estimate comes after the selection, so its
 * text leads with the selection's projects selected whole.
 */
export function preRunOptions(
  changed: ChangedSet,
  policy: BasePolicy,
  stderr: (text: string) => void,
): Pick<CollectOptions, "selected" | "excluded" | "estimated"> {
  let whole: readonly WholeProject[] = [];
  return {
    selected: (summary) => {
      whole = summary.wholeProjects ?? [];
      stderr(preRunText(summary, changed));
    },
    excluded: createInputMatcher(policy.coverageExclude),
    estimated: (estimates, left, budget) =>
      stderr(wholeProjectText(whole, budget.fit) + estimateText(estimates, left, budget)),
  };
}

/**
 * Row 020-57 (#212): one line per runner with a changed path every test
 * file of a project depends on: the paths, each `setupFiles` entry marked,
 * the files that selects, and the whole run's estimate against what is
 * left of the budget.
 */
export function wholeProjectText(whole: readonly WholeProject[], fit: BudgetFit): string {
  return whole.map((w) => `squeal code: ${wholeProjectLine(w, fit)}\n`).join("");
}

function wholeProjectLine(whole: WholeProject, fit: BudgetFit): string {
  const { runner, paths, setupFiles, projects, files, run } = whole;
  const name = RUNNER_NAMES[runner];
  const named = projects.filter((p) => p !== "").map((p) => JSON.stringify(p));
  const of =
    named.length === 0
      ? `every ${name} test file`
      : `every test file of ${name} ${named.length === 1 ? "project" : "projects"} ${listPaths(named, NAMED)}`;
  const marked = paths.map((p) => (setupFiles.includes(p) ? `${p} (setupFiles)` : p));
  const all = files === 1 ? "its 1 test file is" : `all ${files} of them are`;
  const here = run === files ? "" : `, ${run === 0 ? "none" : run} to run here`;
  return `${of} depends on ${listPaths(marked, NAMED)}, so ${all} selected${here}; ${wholeRunText(fit)}`;
}

/** Row 020-57: the whole run's estimate against what is left of the budget. */
function wholeRunText({ seconds, leftSeconds, load }: BudgetFit): string {
  if (seconds === null) return "the whole run's time is unknown: no stored duration";
  const at = load === undefined ? "" : " at the host's load";
  const where = seconds > leftSeconds ? "over" : "within";
  return `the whole run takes about ${seconds} s${at}, ${where} the ${leftSeconds} s left of the budget`;
}

/** D17.1: what shortens a run that does not fit what is left of the budget. */
const WAYS_OUT =
  "To fit it: a longer --timeout, paths that narrow the changed files, fewer check groups (gate.groups at the base, --group), or CI's results with --parts. The run starts anyway.";

/**
 * D17.1: one stderr line per runner, told before the first run: its
 * estimate, how many files have a stored duration, and how many run at
 * once. The runners run at once (D18 as amended, row 020-44), so a line
 * is over the budget when its own runner's estimate passes `leftSeconds`;
 * that line gives the ways out. Rows 020-45, 020-46: then `budget`'s
 * line, when it names a rerun.
 */
export function estimateText(
  estimates: readonly RunEstimate[],
  leftSeconds: number,
  budget?: BudgetTold,
): string {
  const lines = estimates.map(({ runner, seconds, files, known, width, load }) => {
    const name = RUNNER_NAMES[runner];
    const run = `${plural(files, "test file")} to run here, up to ${width} at once`;
    if (seconds === null) return `${name}: ${run}; no stored duration, so the time is unknown`;
    const from =
      known < files
        ? `the stored durations of ${known} (the others at their median)`
        : files === 1
          ? "its stored duration"
          : "their stored durations";
    const over =
      seconds > leftSeconds ? `, over the ${leftSeconds} s left of the budget. ${WAYS_OUT}` : "";
    return `${name}: ${run}: about ${seconds} s from ${from}${scaledText(load)}${over}`;
  });
  const fit = budget === undefined ? null : budgetLine(budget);
  return [...lines, ...(fit === null ? [] : [fit])]
    .map((line) => `squeal code: ${line}\n`)
    .join("");
}

/**
 * Row 020-57 (#212): what an estimate the host's load scaled says of it:
 * the seconds from the stored durations alone and the factor; nothing
 * when it was not scaled.
 */
function scaledText(load: EstimateLoad | undefined): string {
  if (load === undefined) return "";
  return `, scaled by the host's load (${load.unscaled} s times ${load.perCpu}, its one-minute load per CPU)`;
}

/**
 * Rows 020-45, 020-46: the line after the runners' when the whole run is
 * over what is left: the rerun that fits, and, when the gate stops early,
 * how many files it runs and the first `NAMED` of those it does not.
 * `null` when the run fits or its time is unknown.
 */
export function budgetLine({ fit, rerun, early }: BudgetTold): string | null {
  if (rerun === undefined || fit.seconds === null) return null;
  const all = `about ${fit.seconds} s in all${fit.load === undefined ? "" : " at the host's load"}`;
  if (early === undefined || early.overBudget.length === 0) {
    return `${all}, over the ${fit.leftSeconds} s left of the budget. A rerun that fits: ${rerun.command}`;
  }
  const { run, overBudget } = early;
  const runs =
    run === 0
      ? "it runs no test file"
      : `it runs the ${plural(run, "test file")} that may load a changed function`;
  const left = `the ${overBudget.length} that load none (${listPaths(overBudget, NAMED)}; the report lists them all)`;
  return [
    `${all}, at least twice the ${fit.leftSeconds} s left of the budget, so the gate stops early:`,
    `${runs}, and not ${left}.`,
    `A rerun that runs them all: ${rerun.command}`,
  ].join(" ");
}

/**
 * Row 020-45: the command that runs this check again with `seconds` as
 * its `--timeout`: `squeal`, the command that runs Squeal here, with the
 * call's own arguments as given and `--timeout` in place of any given.
 * Each list option ends at the next option, so the order parses the same.
 */
export function rerunCommand(args: GateArgs, squeal: string): (seconds: number) => string {
  const listed = (flag: string, values: readonly string[] | undefined) =>
    values === undefined || values.length === 0 ? [] : [flag, ...values];
  return (seconds) => {
    const words = [
      "--base",
      args.ref,
      ...args.paths,
      ...listed("--test", args.tests),
      ...listed("--group", args.groups),
      ...listed("--parts", args.parts),
      ...(args.exceptions === undefined ? [] : ["--exceptions", args.exceptions]),
      "--timeout",
      String(seconds),
      ...(args.json ? ["--json"] : []),
    ];
    return `${squeal} code ${words.map(shellWord).join(" ")}`;
  };
}

/**
 * Rows 020-45 and 020-46: the collector's option that names the rerun
 * command of `args`, run as Squeal runs under `io.env`, in the estimate
 * `preRunOptions` tells (row 020-57 moved the telling there).
 */
export function estimateOptions(
  args: GateArgs,
  io: Pick<CliIo, "env">,
): Pick<CollectOptions, "rerun"> {
  return { rerun: rerunCommand(args, statusCommand(io.env ?? process.env)) };
}
