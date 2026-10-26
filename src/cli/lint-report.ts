import { plural } from "../core/text.js";
import type { RelativePath, RevisionNumber } from "../core/types/index.js";
import type { LintOutcome, LintSeverity } from "../core/types/lint.js";

/*
 * Spec 017 D8: how `squeal lint` words the lint store's details: every file
 * with findings, newest first, each finding with its line, severity, rule
 * and message; the files with no current result follow, with why.
 */

// The shapes below are 017-10's proposal for 017-09's `types/lint-delivery.ts`; they move there at integration.

/** One finding as `squeal lint` lists it. */
export interface LintReportFinding {
  readonly rule: string | null;
  readonly message: string;
  readonly severity: LintSeverity;
  readonly line: number;
  readonly column: number;
}

/** One file of a report, newest change first. */
export interface LintReportFile {
  readonly path: RelativePath;
  readonly outcome: LintOutcome;
  /** D5: a whole-program file whose key moved; its findings are the last ones judged. */
  readonly stale: boolean;
  /** D9: why it is `unknown`. */
  readonly reason: string | null;
  /** The revision its outcome last changed. */
  readonly changedAt: RevisionNumber;
  /** The revision its findings are from; `null` before its first lint. */
  readonly lintedAt: RevisionNumber | null;
  /** The last judged result's findings; empty for a `pass` and before the first lint. */
  readonly findings: readonly LintReportFinding[];
}

/** `squeal lint`'s answer, `--json`'s body. */
export interface LintReport {
  readonly v: 1;
  readonly available: true;
  /** The paths asked for, relative to the worktree; `null` for every file with findings. */
  readonly paths: readonly RelativePath[] | null;
  /**
   * With `--changed`: the registration changes count since, `null` with no
   * session registered in the worktree; absent without `--changed`.
   */
  readonly changedSince?: {
    readonly revision: RevisionNumber;
    readonly scope: "session" | "oldest";
  } | null;
  readonly files: readonly LintReportFile[];
}

const SEVERITY_WIDTH = "warning".length;

/** `  3:7  error    no-unused-vars  'count' is assigned a value but never used.` */
function findingLine(f: LintReportFinding): string {
  const rule = f.rule === null ? "" : `${f.rule}  `;
  return `    ${f.line}:${f.column}  ${f.severity.padEnd(SEVERITY_WIDTH)}  ${rule}${f.message.split("\n", 1)[0]}`;
}

/** A judged file's head: its findings, since when, and whether a later key moved it. */
function judgedHead(f: LintReportFile): string {
  const findings = f.outcome === "pass" ? "no findings" : plural(f.findings.length, "finding");
  const when =
    f.outcome === "fail"
      ? `since revision ${f.changedAt}`
      : f.lintedAt === null
        ? ""
        : `linted at revision ${f.lintedAt}`;
  const stale = f.stale
    ? "; stale: an input it reads changed, re-linted when the agent is idle"
    : "";
  return `  ${f.path}: ${[findings, when].filter((w) => w !== "").join(", ")}${stale}`;
}

/** A file with no current result, and why. */
function notJudgedLine(f: LintReportFile): string {
  if (f.outcome === "unknown") return `  ${f.path}: unknown: ${f.reason ?? "not linted"}`;
  const since =
    f.lintedAt === null ? "not linted yet" : `changed since revision ${f.lintedAt}, not linted yet`;
  return `  ${f.path}: pending: ${since}`;
}

/** Whether a file's findings are listed: a `pass` or a `fail`, current or stale. */
const judged = (f: LintReportFile) => f.outcome === "pass" || f.outcome === "fail";

/** The line after the head on whose registration `--changed` lists. */
function scopeLines({ changedSince }: LintReport): string[] {
  if (changedSince === undefined) return [];
  if (changedSince === null) {
    return ["No session is registered in this worktree, so nothing changed since one started."];
  }
  const whose =
    changedSince.scope === "session"
      ? "when this session registered"
      : "the oldest registration in this worktree";
  return [`Changed since revision ${changedSince.revision}, ${whose}.`];
}

/** The human rendering of a report. */
export function formatLintReport(report: LintReport): string {
  const listed = report.files.filter(judged);
  const failing = listed.filter((f) => f.outcome === "fail").length;
  const head =
    report.changedSince !== undefined
      ? `Lint: ${plural(listed.length, "file")} changed, ${failing} with findings`
      : report.paths === null
        ? `Lint: ${plural(failing, "file")} with findings`
        : `Lint: ${plural(failing, "file")} with findings in ${report.paths.join(", ") || "."}`;
  const files = listed.flatMap((f) => [judgedHead(f), ...f.findings.map(findingLine)]);
  const others = report.files.filter((f) => !judged(f));
  const notJudged = others.length === 0 ? [] : ["Not judged:", ...others.map(notJudgedLine)];
  return `${[head, ...scopeLines(report), ...files, ...notJudged].join("\n")}\n`;
}
