import { plural } from "../text.js";

/*
 * Spec 017 D8: status's lint line, under the code lines, from the lint store
 * with no daemon (011 C6). Absent while `lint.enabled` is off, so status is
 * then the one before (goal 1).
 */

// The shape below is 017-10's proposal for 017-09's `types/lint-delivery.ts`; it moves there at integration.

/** D8: status's lint counts, `--json`'s `lint`. */
export interface LintStatus {
  readonly v: 1;
  /** The files that have a lint state. */
  readonly files: number;
  /** Of them, those whose outcome is `fail`, stale ones included. */
  readonly failing: number;
  /** Of `failing`, those that went to `fail` since `since`'s registration. */
  readonly sinceRegistration: number;
  readonly since: "session" | "oldest" | null;
  readonly pending: number;
  /** D5: whole-program files whose key moved, re-linted when the agent is idle. */
  readonly stale: number;
  readonly unknown: number;
  /** D9: why lint is off while `lint.enabled` holds. */
  readonly off?: string;
  /** D7: while the worktree's first pass runs. */
  readonly linting?: { readonly done: number; readonly total: number };
  /** D9: why files are `unknown`, most files first. */
  readonly unknownReasons?: readonly { readonly reason: string; readonly files: number }[];
}

const SINCE: Record<NonNullable<LintStatus["since"]>, string> = {
  session: "since this session started",
  oldest: "since the oldest registered session started",
};

/** The most reasons a status line names for unknown files. */
const REASONS_NAMED = 2;

/** A reason inside a sentence: its first line, with no period of its own. */
const reasonText = (reason: string) => (reason.split("\n", 1)[0] ?? "").replace(/\.+$/, "");

/** D9: `; 3 files unknown: the ESLint worker timed out`, each reason with its count past the first. */
function unknownWords(lint: LintStatus): string {
  if (lint.unknown === 0) return "";
  const reasons = lint.unknownReasons ?? [];
  const named = reasons.slice(0, REASONS_NAMED).map((r) => reasonText(r.reason));
  const rest = reasons.length - named.length;
  const why =
    named.length === 0
      ? ""
      : `: ${named.join("; ")}${rest === 0 ? "" : `; and ${plural(rest, "other reason")}`}`;
  return `; ${plural(lint.unknown, "file")} unknown${why}`;
}

/**
 * D8: `Lint: 12 files with findings, 2 since this session started, 40 stale;
 * squeal lint lists them.`; while the first pass runs, its progress; while
 * off, why.
 */
export function lintStatusLines(lint: LintStatus | undefined, command: string): string[] {
  if (lint === undefined) return [];
  if (lint.off !== undefined) return [`Lint: off: ${reasonText(lint.off)}.`];
  if (lint.linting !== undefined) {
    const { done, total } = lint.linting;
    return [`Lint: linting, ${done} of ${plural(total, "file")}${unknownWords(lint)}.`];
  }
  if (lint.files === 0) return [`Lint: no file linted yet${unknownWords(lint)}.`];
  const since = lint.since === null ? "" : `, ${lint.sinceRegistration} ${SINCE[lint.since]}`;
  const pending = lint.pending === 0 ? "" : `, ${lint.pending} pending`;
  const stale = lint.stale === 0 ? "" : `, ${lint.stale} stale`;
  const failing = `${plural(lint.failing, "file")} with findings`;
  return [
    `Lint: ${failing}${since}${pending}${stale}${unknownWords(lint)}; ${command} lint lists them.`,
  ];
}
