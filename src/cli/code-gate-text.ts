import type { RunEstimate } from "../core/code/gate/estimate.js";
import type { PrepareRun } from "../core/code/gate/prepare.js";
import type {
  GateExceptionUse,
  GateFunctionReport,
  GatePathReport,
  GateReport,
  GateRunReport,
  GateUnusedException,
} from "../core/code/gate/report.js";
import type { ExceptionEntry, GateGap, GateState } from "../core/code/gate/types.js";
import { functionName } from "../core/delivery/code-format.js";
import { plural } from "../core/text.js";

/*
 * Spec 020 D1 (row 020-05): the text of `squeal code --base`. The verdict
 * line, then each function that is not pass with its gap or measure, the
 * paths not counted, the exceptions that applied to no function, the
 * failed tests and the files that did not finish, then the command for the
 * JSON report. CRAP is rounded here only; the
 * JSON keeps the score.
 */

/** D5: why a function is incomplete, in words. */
const GAP_WORDS: Readonly<Record<GateGap, string>> = {
  "not-counted": "not counted: it is inside code that does not parse",
  "no-loader": "no test Squeal runs loads its file",
  "not-finished": "a test file that loads it did not finish in the budget",
  "no-record": "no coverage record of its file's bytes now",
  "not-joined": "its coverage could not be matched to it",
  "test-failed": "a selected test failed",
  skipped: "a test file that loads it skipped a test",
  "left-out": "a test file that loads it is in a check group this run left out",
  "not-prepared":
    "a test file that loads it did not run: its node:test entry's prepare did not pass, or the base does not declare it",
};

const UNCOUNTED_WORDS: Readonly<Record<GatePathReport["reason"], string>> = {
  "too-large": "over complexity.maxFileBytes, not counted",
  "parse-error": "does not parse, so a changed function can be hidden in it",
  unsupported: "not a regular file, not counted",
};

/** D8: why an entry applied to no function, in words. */
const UNUSED_WORDS: Readonly<Record<GateUnusedException["why"], string>> = {
  "base-commit": "its base commit is not the merge base",
  "body-hash": "the changed function of that name has another body hash",
  "no-function": "no changed function has that path and name",
};

/** The order of the verdict line's counts. */
const STATES: readonly GateState[] = ["violation", "incomplete", "skipped", "accepted", "pass"];

/** How many failed test names a file's line shows; the count says the rest. */
const NAMED_TESTS = 3;

/**
 * A score with one decimal, more when one decimal would read on the other
 * side of the limit (30.04 over 30 reads 30.04, not 30.0).
 */
export function crapText(value: number, limit: number): string {
  if (Number.isInteger(value)) return `${value}`;
  for (const digits of [1, 2, 3]) {
    const text = value.toFixed(digits);
    if (Number(text) > limit === value > limit) return text;
  }
  return `${value}`;
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

function measureText(f: GateFunctionReport, report: GateReport): string {
  const { complexityThreshold: ccLimit, crapThreshold: crapLimit } = report.base.policy;
  const cc = `CC ${f.complexity}${f.complexity > ccLimit ? ` over ${ccLimit}` : ""}`;
  if (f.crap === null || f.coverage === null) return cc;
  const over = f.crap > crapLimit ? ` over ${crapLimit}` : "";
  return `${cc}, coverage ${percent(f.coverage.share)}, CRAP ${crapText(f.crap, crapLimit)}${over}`;
}

const entryText = (e: ExceptionEntry) => `${e.kind} ${e.measure} exception`;

/** D8: why an entry does not cover its function, in words; `null` when it covers or is not needed. */
function missText(u: GateExceptionUse, ccLimit: number): string | null {
  const { entry, baseComplexity: base } = u;
  const measure = entry.measure === "complexity" ? "CC" : "CRAP";
  switch (u.outcome) {
    case "over-value":
      return entry.kind === "inherited" && entry.measure === "complexity"
        ? `CC ${base} at the base is over its value ${entry.value}`
        : `${measure} is over its value ${entry.value}`;
    case "worse-than-base":
      return `CC is over the base's ${base}`;
    case "not-over-at-base":
      return `CC ${base} at the base is not over ${ccLimit}`;
    case "not-at-base":
      return "the function is not at the base";
    default:
      return null;
  }
}

/** D8: the entries that cover an accepted function, or the ones that do not cover a violation. */
function exceptionsText(f: GateFunctionReport, ccLimit: number): string {
  const uses = f.exceptions ?? [];
  if (f.state === "accepted") {
    const covering = uses.filter((u) => u.outcome === "covers");
    return `: ${covering.map((u) => `${entryText(u.entry)}, ${u.entry.issue}`).join("; ")}`;
  }
  if (f.state !== "violation") return "";
  const missed = uses.flatMap((u) => {
    const why = missText(u, ccLimit);
    return why === null ? [] : [`${entryText(u.entry)} does not cover it: ${why}`];
  });
  return missed.length === 0 ? "" : `; ${missed.join("; ")}`;
}

function stateText(f: GateFunctionReport, ccLimit: number): string {
  if (f.state === "incomplete") return `incomplete: ${f.gap === null ? "" : GAP_WORDS[f.gap]}`;
  if (f.state === "skipped") return "skipped: its file is in coverage.exclude";
  return `${f.state}${exceptionsText(f, ccLimit)}`;
}

function functionLine(f: GateFunctionReport, report: GateReport): string {
  const name = functionName({ kind: "code", ...f });
  const state = stateText(f, report.base.policy.complexityThreshold);
  return `  ${f.path}:${f.line}  ${name}  ${measureText(f, report)}: ${state}`;
}

/** D8: an entry that applied to no function. */
function unusedLine({ entry, why }: GateUnusedException): string {
  const name = `${entry.path} ${entry.qualifiedName}`;
  return `  ${entryText(entry)} for ${name}: unused: ${UNUSED_WORDS[why]}`;
}

function runLines(run: GateRunReport, budgetSeconds: number): string[] {
  const failed = run.failed.map(({ path, tests }) => {
    const shown = tests.slice(0, NAMED_TESTS).join("; ");
    const more = tests.length > NAMED_TESTS ? ` and ${tests.length - NAMED_TESTS} more` : "";
    return `  ${path}: failed: ${shown}${more}`;
  });
  const late = run.notFinished.map(
    (path) => `  ${path}: did not finish in the ${budgetSeconds} s budget`,
  );
  return [...failed, ...late, ...(run.prepare ?? []).flatMap(prepareLine)];
}

/** D15.3: why an entry's `prepare` kept its files from running, in words. */
const PREPARE_WORDS: Readonly<Record<Exclude<PrepareRun["outcome"], "passed">, string>> = {
  failed: "prepare failed",
  "timed-out": "prepare did not finish in time",
  "not-at-base":
    "prepare is declared only at the head, so it did not run; land the declaration on the base branch first",
};

/** D15.3: an entry whose `prepare` did not pass, and how many files that kept from running. */
function prepareLine(p: PrepareRun): string[] {
  if (p.outcome === "passed") return [];
  const exit = p.exit === null ? "" : ` (exit ${p.exit})`;
  const files = `${plural(p.notRun.length, "test file")} did not run`;
  return [
    `  node:test entry ${JSON.stringify(p.project)}: ${PREPARE_WORDS[p.outcome]}${exit}: ${files}`,
  ];
}

/**
 * D14.3: each group the scope left out that held a selected file, and the
 * flag that runs it; never "all tests".
 */
function leftOutText(report: GateReport): string {
  const groups = (report.scope?.leftOut ?? []).filter((g) => g.selected > 0);
  return groups
    .map(({ name, at, selected, add }) => {
      const one = selected === 1;
      const files = `${plural(selected, "test file")} ${one ? "loads" : "load"} changed code`;
      return ` ${name} (${at}) did not run: ${files}; add ${add} to run ${one ? "it" : "them"}.`;
    })
    .join("");
}

/** D16.3: how many changed functions D2 left out; nothing when none. */
function omittedText(report: GateReport): string {
  const omitted = report.omitted?.length ?? 0;
  return omitted === 0 ? "" : ` ${omitted} left out as moved or unchanged; --json lists them.`;
}

/**
 * D1's verdict line: the verdict, what was judged against what, the count
 * of each state, what the scope left out (D14.3), and how many changed
 * functions were not judged (D16.3).
 */
function verdictLine(report: GateReport): string {
  const { counts, base } = report;
  const against = `against ${base.ref} (merge base ${base.commit.slice(0, 8)})`;
  const judged = Object.values(counts).reduce((a, b) => a + b, 0);
  const states = STATES.filter((s) => counts[s] > 0).map((s) =>
    s === "violation" ? plural(counts[s], s) : `${counts[s]} ${s}`,
  );
  const uncounted =
    report.uncounted.length === 0 ? [] : [`${plural(report.uncounted.length, "path")} not counted`];
  const unused = report.exceptions?.unused.length ?? 0;
  const unusedText = unused === 0 ? [] : [`${plural(unused, "exception")} unused`];
  const parts = [...states, ...uncounted, ...unusedText];
  const what =
    judged === 0
      ? `No function changed ${against}`
      : `${plural(judged, "changed function")} ${against}`;
  const tally = parts.length === 0 ? "" : `: ${parts.join(", ")}`;
  return `Code gate: ${report.verdict}. ${what}${tally}.${leftOutText(report)}${omittedText(report)}`;
}

const RUNNER_NAMES: Readonly<Record<RunEstimate["runner"], string>> = {
  vitest: "Vitest",
  "node-test": "node:test",
};

/** D17.1: what shortens a run that does not fit what is left of the budget. */
const WAYS_OUT =
  "To fit it: a longer --timeout, paths that narrow the changed files, fewer check groups (gate.groups at the base, --group), or CI's results with --parts. The run starts anyway.";

/**
 * D17.1: one stderr line per runner, told before the first run: its
 * estimate, how many files have a stored duration, and how many run at
 * once. The runners run in turn, so a line is over the budget when the
 * estimates up to its runner pass `leftSeconds`; that line gives the ways out.
 */
export function estimateText(estimates: readonly RunEstimate[], leftSeconds: number): string {
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
  return lines.map((line) => `squeal code: ${line}\n`).join("");
}

/** The human rendering of a gate report; `json` is the command that prints it as JSON. */
export function formatGateReport(report: GateReport, json: string): string {
  const functions = report.functions
    .filter((f) => f.state !== "pass")
    .map((f) => functionLine(f, report));
  const paths = report.uncounted.map((u) => `  ${u.path}: ${UNCOUNTED_WORDS[u.reason]}`);
  const unused = (report.exceptions?.unused ?? []).map(unusedLine);
  const runs = report.runs.flatMap((run) => runLines(run, report.budget.seconds));
  const lines = [
    verdictLine(report),
    ...functions,
    ...paths,
    ...unused,
    ...runs,
    `JSON report: ${json}`,
  ];
  return `${lines.join("\n")}\n`;
}
