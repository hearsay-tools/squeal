import {
  LINT_STALE,
  lintEntryLine,
  lintFailedLine,
  lintOffLine,
} from "../core/lint/surface/format.js";
import { plural } from "../core/text.js";
import type { RelativePath } from "../core/types/index.js";
import type { LintFinding } from "../core/types/lint.js";
import type {
  LintChanged,
  LintChangedEntry,
  LintDetails,
  LintFileDetail,
  LintReasons,
} from "../core/types/lint-delivery.js";

/*
 * Spec 017 D8: how `squeal lint` words the lint store's details: the files
 * with findings, newest first, each finding with its place, severity, rule
 * and message; the files with no current result follow, with why. And
 * `--changed`: each file whose last change is the session's own.
 */

const SEVERITY_WIDTH = "warning".length;

/** A reason inside a sentence: its first line, with no full stop of its own. */
const reasonText = (reason: string) => (reason.split("\n")[0] ?? "").trim().replace(/\.$/, "");

/** D9: why the store cannot say more, in the lint surface's words; `null` for none. */
function lintReasonLine({ off, unreadable, failed }: LintReasons): string | null {
  if (off !== undefined) return lintOffLine(off);
  if (unreadable !== undefined) {
    return `Lint: unknown: the lint store cannot be read: ${reasonText(unreadable)}.`;
  }
  return failed === undefined ? null : lintFailedLine(failed);
}

/** `    3:7  error    no-unused-vars  'count' is assigned a value but never used.` */
function findingLine(f: LintFinding): string {
  const rule = f.rule === null ? "" : `${f.rule}  `;
  return `    ${f.line}:${f.column}  ${f.severity.padEnd(SEVERITY_WIDTH)}  ${rule}${f.message.split("\n", 1)[0]}`;
}

/** A judged file's head: its findings, the revision they are from, and whether its key moved. */
function judgedHead(f: LintFileDetail): string {
  const findings =
    f.outcome === "pass"
      ? "no findings"
      : f.findings === null
        ? "findings no longer stored"
        : plural(f.findings.length, "finding");
  const at = f.revision === null ? "" : `, linted at revision ${f.revision}`;
  return `  ${f.path}: ${findings}${at}${f.stale ? ` (${LINT_STALE})` : ""}`;
}

/** What a result no longer current found, as provenance: ` (2 findings then)`. */
function then(findings: readonly LintFinding[] | null): string {
  if (findings === null) return "";
  return ` (${findings.length === 0 ? "no findings" : plural(findings.length, "finding")} then)`;
}

/** A file with no current result, and why; a result its bytes on disk moved past, and what it found. */
function notJudgedLine(f: LintFileDetail): string {
  if (f.outcome === "unknown")
    return `  ${f.path}: unknown: ${reasonText(f.reason ?? "not linted")}`;
  if (f.reason !== null) {
    const at = f.revision === null ? "" : ` at revision ${f.revision}`;
    return `  ${f.path}: pending: ${reasonText(f.reason)}${at}${then(f.findings)}`;
  }
  const since =
    f.revision === null ? "not linted yet" : `changed since revision ${f.revision}, not linted yet`;
  return `  ${f.path}: pending: ${since}`;
}

/** Whether a file's findings are listed: a `pass` or a `fail`, current or stale. */
const judged = (f: LintFileDetail) => f.outcome === "pass" || f.outcome === "fail";

/** Over the worktree, the files with no current result, when the list leaves them out. */
function notCurrentLine({ pending, stale, unknown }: LintDetails): string[] {
  const parts = [
    ...(pending === 0 ? [] : [`${pending} pending`]),
    ...(stale === 0 ? [] : [`${stale} stale`]),
    ...(unknown === 0 ? [] : [`${unknown} unknown`]),
  ];
  return parts.length === 0 ? [] : [`Not current in this worktree: ${parts.join(", ")}.`];
}

/** A head and the paths under it; nothing for no path. */
const block = (head: string, paths: readonly RelativePath[]) =>
  paths.length === 0 ? [] : [head, ...paths.map((p) => `  ${p}`)];

/** The human rendering of `squeal lint [<path>...]`; `paths` as asked, `null` with none. */
export function formatLintDetails(
  details: LintDetails,
  paths: readonly RelativePath[] | null,
): string {
  const reason = lintReasonLine(details);
  const listed = details.files.filter(judged);
  const failing = listed.filter((f) => f.outcome === "fail").length;
  const where = paths === null ? "" : ` in ${paths.join(", ") || "."}`;
  const linting =
    details.linting === undefined
      ? []
      : [`Linting, ${details.linting.done} of ${plural(details.linting.total, "file")}.`];
  const files = listed.flatMap((f) => [judgedHead(f), ...(f.findings ?? []).map(findingLine)]);
  const others = details.files.filter((f) => !judged(f));
  const notJudged = others.length === 0 ? [] : ["Not judged:", ...others.map(notJudgedLine)];
  const notLinted = block(
    "Not linted (ESLint's config or the lint policy leaves them out):",
    details.notLinted,
  );
  const waiting = block(
    "Not known yet (the first lint in this worktree has not finished):",
    details.waiting,
  );
  return `${[
    ...(reason === null ? [] : [reason]),
    `Lint: ${plural(failing, "file")} with findings${where}`,
    ...linting,
    ...files,
    ...notJudged,
    ...notLinted,
    ...waiting,
    ...(paths === null ? notCurrentLine(details) : []),
  ].join("\n")}\n`;
}

const SINCE: Record<NonNullable<LintChanged["since"]>, string> = {
  session: "since this session started",
  oldest: "since the oldest registered session started",
};

/** What a changed file is now, when its line's change is not its state. */
function nowWords(e: LintChangedEntry): string {
  if (e.outcome === null) return "; now not linted";
  if (e.outcome === "pending") {
    return `; now pending: ${e.reason === null ? "changed since, not linted yet" : reasonText(e.reason)}`;
  }
  if (e.outcome === "unknown") return `; now unknown: ${reasonText(e.reason ?? "not linted")}`;
  return "";
}

/** `  FAIL lint: src/a.ts: 2 findings, +1 no-unused-vars (...); at revision 5`. */
function changedLine(e: LintChangedEntry): string {
  const line = lintEntryLine({
    path: e.path,
    kind: e.kind,
    findings: e.findings,
    added: e.added,
    removed: e.removed,
    revision: e.revision,
    ...(e.stale ? { stale: true as const } : {}),
  });
  return `  ${line}; at revision ${e.revision}${nowWords(e)}`;
}

/** The human rendering of `squeal lint --changed`. */
export function formatLintChanged(changed: LintChanged): string {
  const reason = lintReasonLine(changed);
  const head =
    changed.since === null
      ? "Lint: no session is registered in this worktree, so nothing changed since one started."
      : `Lint: ${plural(changed.entries.length, "file")} changed ${SINCE[changed.since]}`;
  return `${[...(reason === null ? [] : [reason]), head, ...changed.entries.map(changedLine)].join("\n")}\n`;
}
