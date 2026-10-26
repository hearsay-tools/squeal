import { lintReasonLine, reasonText } from "../delivery/lint-format.js";
import { plural } from "../text.js";
import type { LintStatus } from "../types/lint-delivery.js";

/*
 * Spec 017 D8: status's lint line, under the code lines, from the lint store
 * with no daemon (011 C6). Absent while `lint.enabled` is off, so status is
 * then the one before (goal 1).
 */

const SINCE: Record<NonNullable<LintStatus["since"]>, string> = {
  session: "since this session started",
  oldest: "since the oldest registered session started",
};

/** The most reasons a status line names for unknown files. */
const REASONS_NAMED = 2;

/** D9: `; 3 files unknown: the ESLint worker timed out`, the most frequent reasons named. */
function unknownWords({ unknown, reasons }: LintStatus): string {
  if (unknown === 0) return "";
  const named = reasons.slice(0, REASONS_NAMED).map((r) => reasonText(r.reason));
  const rest = reasons.length - named.length;
  const why =
    named.length === 0
      ? ""
      : `: ${named.join("; ")}${rest === 0 ? "" : `; and ${plural(rest, "other reason")}`}`;
  return `; ${plural(unknown, "file")} unknown${why}`;
}

/**
 * D8: `Lint: 12 files with findings, 2 since this session started, 40 stale;
 * squeal lint lists them.`; while the first pass runs, its progress; while
 * off or unreadable, why. A failed keying (D9) adds its own line.
 */
export function lintStatusLines(lint: LintStatus | undefined, command: string): string[] {
  if (lint === undefined) return [];
  const reason = lintReasonLine(lint);
  if (lint.off !== undefined || lint.unreadable !== undefined)
    return reason === null ? [] : [reason];
  const failed = reason === null ? [] : [reason];
  if (lint.linting !== undefined) {
    const { done, total } = lint.linting;
    return [`Lint: linting, ${done} of ${plural(total, "file")}${unknownWords(lint)}.`, ...failed];
  }
  if (lint.files === 0) return [`Lint: no file linted yet${unknownWords(lint)}.`, ...failed];
  const since = lint.since === null ? "" : `, ${lint.sinceRegistration} ${SINCE[lint.since]}`;
  const pending = lint.pending === 0 ? "" : `, ${lint.pending} pending`;
  const stale = lint.stale === 0 ? "" : `, ${lint.stale} stale`;
  const failing = `${plural(lint.failing, "file")} with findings`;
  return [
    `Lint: ${failing}${since}${pending}${stale}${unknownWords(lint)}; ${command} lint lists them.`,
    ...failed,
  ];
}
