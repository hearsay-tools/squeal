import type { CollectOptions } from "../core/code/gate/collect.js";
import type { BasePolicy } from "../core/code/gate/policy.js";
import type { SelectionSummary } from "../core/code/gate/prerun.js";
import type { ChangedSet, TestFileEvidence } from "../core/code/gate/types.js";
import { createInputMatcher } from "../core/keys/glob.js";
import { plural } from "../core/text.js";
import type { GlobalSetupEntry } from "../core/types/runner.js";

/*
 * Spec 020 D14.4 (row 020-15b, which carries 020-16a): what `squeal code
 * --base` tells on stderr after selection and before its first run, so
 * before any global setup writes: the files to run by runner and group,
 * each group the scope left out, the projects whose global setup runs, and
 * each changed path no test Squeal runs loads, with the ways out.
 */

const RUNNER_NAMES: Readonly<Record<TestFileEvidence["runner"], string>> = {
  vitest: "Vitest",
  "node-test": "node:test",
};

function runnerLine({ runner, files, groups }: SelectionSummary["runners"][number]): string {
  const name = RUNNER_NAMES[runner];
  if (files === 0) return `${name}: no test file to run`;
  const byGroup =
    groups.length === 0 ? "" : ` (${groups.map((g) => `${g.name} ${g.files}`).join(", ")})`;
  return `${name}: ${plural(files, "test file")} to run${byGroup}`;
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
      : `${selected} ${of} ${selected === 1 ? "loads" : "load"} changed code; add ${add} to run ${selected === 1 ? "it" : "them"}`;
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

/** The pre-run lines of `summary`, each with its line feed; `changed` counts each unloaded path's functions. */
export function preRunText(summary: SelectionSummary, changed: ChangedSet): string {
  const setups = summary.setups.map(setupName);
  const lines = [
    ...summary.runners.map(runnerLine),
    ...summary.leftOut.map(leftOutLine),
    ...(setups.length === 0 ? [] : [`global setup runs for: ${setups.join(", ")}`]),
    ...summary.unloaded.map((path) =>
      unloadedLine(path, changed.functions.filter((f) => f.path === path).length),
    ),
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
