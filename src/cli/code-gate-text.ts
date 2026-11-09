import type {
  GateFunctionReport,
  GatePathReport,
  GateReport,
  GateRunReport,
} from "../core/code/gate/report.js";
import type { GateGap, GateState } from "../core/code/gate/types.js";
import { functionName } from "../core/delivery/code-format.js";
import { plural } from "../core/text.js";

/*
 * Spec 020 D1 (row 020-05): the text of `squeal code --base`. The verdict
 * line, then each function that is not pass with its gap or measure, the
 * paths not counted, the failed tests and the files that did not finish,
 * then the command for the JSON report. CRAP is rounded here only; the
 * JSON keeps the score.
 */

/** D5: why a function is incomplete, in words. */
const GAP_WORDS: Readonly<Record<GateGap, string>> = {
  "not-counted": "not counted: it is inside code that does not parse",
  "no-loader": "no test loads its file",
  "not-finished": "a test file that loads it did not finish in the budget",
  "no-record": "no coverage record of its file's bytes now",
  "not-joined": "its coverage could not be matched to it",
  "test-failed": "a selected test failed",
};

const UNCOUNTED_WORDS: Readonly<Record<GatePathReport["reason"], string>> = {
  "too-large": "over complexity.maxFileBytes, not counted",
  "parse-error": "does not parse, so a changed function can be hidden in it",
  unsupported: "not a regular file, not counted",
};

/** The order of the verdict line's counts. */
const STATES: readonly GateState[] = ["violation", "incomplete", "skipped", "pass"];

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

function stateText(f: GateFunctionReport): string {
  if (f.state === "incomplete") return `incomplete: ${f.gap === null ? "" : GAP_WORDS[f.gap]}`;
  if (f.state === "skipped") return "skipped: its file is in coverage.exclude";
  return f.state;
}

function functionLine(f: GateFunctionReport, report: GateReport): string {
  const name = functionName({ kind: "code", ...f });
  return `  ${f.path}:${f.line}  ${name}  ${measureText(f, report)}: ${stateText(f)}`;
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
  return [...failed, ...late];
}

/** D1's verdict line: the verdict, what was judged against what, and the count of each state. */
function verdictLine(report: GateReport): string {
  const { counts, base } = report;
  const against = `against ${base.ref} (merge base ${base.commit.slice(0, 8)})`;
  const judged = Object.values(counts).reduce((a, b) => a + b, 0);
  const states = STATES.filter((s) => counts[s] > 0).map((s) =>
    s === "violation" ? plural(counts[s], s) : `${counts[s]} ${s}`,
  );
  const uncounted =
    report.uncounted.length === 0 ? [] : [`${plural(report.uncounted.length, "path")} not counted`];
  const parts = [...states, ...uncounted];
  const what =
    judged === 0
      ? `No function changed ${against}`
      : `${plural(judged, "changed function")} ${against}`;
  return `Code gate: ${report.verdict}. ${what}${parts.length === 0 ? "" : `: ${parts.join(", ")}`}.`;
}

/** The human rendering of a gate report; `json` is the command that prints it as JSON. */
export function formatGateReport(report: GateReport, json: string): string {
  const functions = report.functions
    .filter((f) => f.state !== "pass")
    .map((f) => functionLine(f, report));
  const paths = report.uncounted.map((u) => `  ${u.path}: ${UNCOUNTED_WORDS[u.reason]}`);
  const runs = report.runs.flatMap((run) => runLines(run, report.budget.seconds));
  const lines = [verdictLine(report), ...functions, ...paths, ...runs, `JSON report: ${json}`];
  return `${lines.join("\n")}\n`;
}
