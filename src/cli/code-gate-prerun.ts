import type { CollectOptions } from "../core/code/gate/collect.js";
import type { RunEstimate } from "../core/code/gate/estimate.js";
import type { BudgetTold } from "../core/code/gate/plan.js";
import type { BasePolicy } from "../core/code/gate/policy.js";
import type { SelectionSummary } from "../core/code/gate/prerun.js";
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
 * The collector's options that write the selection to `stderr` before the
 * first run (D14.4). A path `coverage.exclude` matches at the base needs no
 * loader, so it gets no line (D6).
 */
export function preRunOptions(
  changed: ChangedSet,
  policy: BasePolicy,
  stderr: (text: string) => void,
): Pick<CollectOptions, "selected" | "excluded"> {
  return {
    selected: (summary) => stderr(preRunText(summary, changed)),
    excluded: createInputMatcher(policy.coverageExclude),
  };
}

/** D17.1: what shortens a run that does not fit what is left of the budget. */
const WAYS_OUT =
  "To fit it: a longer --timeout, paths that narrow the changed files, fewer check groups (gate.groups at the base, --group), or CI's results with --parts. The run starts anyway.";

/**
 * D17.1: one stderr line per runner, told before the first run: its
 * estimate, how many files have a stored duration, and how many run at
 * once. The runners run in turn, so a line is over the budget when the
 * estimates up to its runner pass `leftSeconds`; that line gives the ways
 * out. Rows 020-45, 020-46: then `budget`'s line, when it names a rerun.
 */
export function estimateText(
  estimates: readonly RunEstimate[],
  leftSeconds: number,
  budget?: BudgetTold,
): string {
  let until = 0;
  const lines = estimates.map(({ runner, seconds, files, known, width }) => {
    const name = RUNNER_NAMES[runner];
    const run = `${plural(files, "test file")} to run here, up to ${width} at once`;
    if (seconds === null) return `${name}: ${run}; no stored duration, so the time is unknown`;
    const first = until === 0;
    until += seconds;
    const from =
      known < files
        ? `the stored durations of ${known} (the others at their median)`
        : files === 1
          ? "its stored duration"
          : "their stored durations";
    const after = first ? "" : `, ${until} s with the runs before it`;
    const over =
      until > leftSeconds ? `, over the ${leftSeconds} s left of the budget. ${WAYS_OUT}` : "";
    return `${name}: ${run}: about ${seconds} s from ${from}${after}${over}`;
  });
  const fit = budget === undefined ? null : budgetLine(budget);
  return [...lines, ...(fit === null ? [] : [fit])]
    .map((line) => `squeal code: ${line}\n`)
    .join("");
}

/**
 * Rows 020-45, 020-46: the line after the runners' when the whole run is
 * over what is left: the rerun that fits, and, when the gate stops early,
 * how many files it runs and the first `NAMED` of those it does not.
 * `null` when the run fits or its time is unknown.
 */
export function budgetLine({ fit, rerun, early }: BudgetTold): string | null {
  if (rerun === undefined || fit.seconds === null) return null;
  const all = `about ${fit.seconds} s in all`;
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
 * D17.1, rows 020-45 and 020-46: the collector's options that tell the
 * estimate on `io.stderr` before the first run, with the rerun command of
 * `args` run as Squeal runs under `io.env`.
 */
export function estimateOptions(
  args: GateArgs,
  io: Pick<CliIo, "env" | "stderr">,
): Pick<CollectOptions, "estimated" | "rerun"> {
  return {
    estimated: (estimates, left, budget) => io.stderr(estimateText(estimates, left, budget)),
    rerun: rerunCommand(args, statusCommand(io.env ?? process.env)),
  };
}
