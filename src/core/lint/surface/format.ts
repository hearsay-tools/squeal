import { plural } from "../../text.js";
import type { LintFinding } from "../../types/lint.js";
import type {
  LintNews,
  LintNewsEntry,
  LintRegistration,
  LintStatus,
  LintSummary,
} from "../../types/lint-delivery.js";

/*
 * Spec 017 D8: how deliveries, registrations and status word lint, in
 * 015's code form (the agreement of 2026-10-26: 015's `codeLines`,
 * `codeTitleWords` and `codeChanges` stay as they are; these sit beside
 * them). Factual: a number and where to look. A file that is pending,
 * unknown or stale is never worded as passing.
 */

/** At most this many rules are named on each side of a FAIL line; the rest by number. */
const NAMED_RULES = 3;

/** The first line of `text`. */
const lineOf = (text: string) => (text.split("\n")[0] ?? "").trim();

/** The first line of `text`, without its full stop: a sentence ends it. */
const firstLine = (text: string) => lineOf(text).replace(/\.$/, "");

/** A finding's rule; a finding no rule made, as a parse error, is named by its message (D9). */
const ruleOf = (f: LintFinding) => f.rule ?? lineOf(f.message);

/** `+2 no-undef, +1 no-console`: the findings by rule, in the order first seen. */
function byRule(sign: "+" | "-", findings: readonly LintFinding[]): string[] {
  const counts = new Map<string, number>();
  for (const f of findings) counts.set(ruleOf(f), (counts.get(ruleOf(f)) ?? 0) + 1);
  const named = [...counts].slice(0, NAMED_RULES).map(([rule, n]) => `${sign}${n} ${rule}`);
  const rest = [...counts.values()].slice(NAMED_RULES).reduce((a, n) => a + n, 0);
  return rest === 0 ? named : [...named, `${sign}${rest} more`];
}

/** `2 findings`; a result no longer stored says so rather than a number. */
const findingsWords = (n: number | null) =>
  n === null ? "findings not stored" : plural(n, "finding");

/**
 * One told change. D8: `FAIL lint: src/a.ts: 2 findings, +1 no-unused-vars
 * ('count' is assigned a value but never used.)`; one added finding alone
 * names its message.
 */
export function lintEntryLine(entry: LintNewsEntry): string {
  switch (entry.kind) {
    case "first-seen-fail":
    case "pass-to-fail":
    case "fail-changed": {
      const stale =
        entry.stale === true
          ? " (an input changed since it was linted; linting resumes when the agent is idle)"
          : "";
      const [only] = entry.added;
      // A finding with no rule is already named by its message.
      const message =
        only?.rule != null && entry.added.length === 1 && entry.removed.length === 0
          ? ` (${lineOf(only.message)})`
          : "";
      const rules = [...byRule("+", entry.added), ...byRule("-", entry.removed)];
      return `FAIL lint: ${entry.path}: ${findingsWords(entry.findings)}${stale}${rules.map((r) => `, ${r}`).join("")}${message}`;
    }
    case "fail-to-pass":
      return `PASS lint: ${entry.path}: no findings`;
    case "removed":
      return `RESOLVED lint: ${entry.path}: deleted or no longer linted`;
  }
}

/** D8: `Lint config changed: 14 files with findings now; squeal lint lists them.` */
export function lintSummaryLine(summary: LintSummary, command: string): string {
  const stale = summary.stale === 0 ? "" : `, ${summary.stale} stale`;
  const files = `${plural(summary.failing, "file")} with findings`;
  return summary.reason === "config"
    ? `Lint config changed: ${files} now${stale}; ${command} lint lists them.`
    : `Lint: ${files}${stale}; ${command} lint lists them.`;
}

/** D9: `Lint: unknown: eslint.config.js does not load: <message first line>.` */
export const lintFailedLine = (reason: string) => `Lint: unknown: ${firstLine(reason)}.`;

/** D9: `Lint: off: <reason>.` */
export const lintOffLine = (reason: string) => `Lint: off: ${firstLine(reason)}.`;

/** The lint lines of a delivery, after every test block and the code lines: summary, changes, the rest by number, reasons. */
export function lintLines(news: LintNews, command: string): string[] {
  return [
    ...(news.summary === undefined ? [] : [lintSummaryLine(news.summary, command)]),
    ...news.entries.map(lintEntryLine),
    ...(news.more === 0
      ? []
      : [
          `and ${news.more} more lint ${news.more === 1 ? "change" : "changes"}; ${command} lint --changed lists them.`,
        ]),
    ...(news.failed === undefined ? [] : [lintFailedLine(news.failed)]),
    ...(news.off === undefined ? [] : [lintOffLine(news.off)]),
  ];
}

/** How many lint changes a delivery tells, listed or by number. */
export const lintChanges = (news: LintNews) => news.entries.length + news.more;

/** A delivery title's words for its lint lines; `null` when it tells no change. */
export function lintTitleWords(news: LintNews): string | null {
  const changes = lintChanges(news);
  return changes === 0 ? null : `${changes} lint ${changes === 1 ? "change" : "changes"}`;
}

/** `Lint: linting, 340 of 600 files.`, or that it has not started. */
const lintingWords = ({ done, total }: { done: number; total: number }) =>
  total === 0 ? "linting has not started" : `linting, ${done} of ${plural(total, "file")}`;

/** D8 Registration: one line, only while lint is on. */
export function lintRegistrationLine(reg: LintRegistration, command: string): string {
  if (reg.off !== undefined) return lintOffLine(reg.off);
  if (reg.unreadable !== undefined) {
    return `Lint: unknown: the lint store cannot be read: ${firstLine(reg.unreadable)}.`;
  }
  if (reg.failed !== undefined) return lintFailedLine(reg.failed);
  if (reg.linting !== undefined) return `Lint: ${lintingWords(reg.linting)}.`;
  const stale = reg.stale === 0 ? "" : `, ${reg.stale} stale`;
  return `Lint: ${plural(reg.failing, "file")} with findings${stale}; ${command} lint lists them.`;
}

const SINCE: Record<NonNullable<LintStatus["since"]>, string> = {
  session: "since this session started",
  oldest: "since the oldest registered session started",
};

/**
 * D8 Status: `Lint: 12 files with findings, 2 since this session started,
 * 40 stale; squeal lint lists them.`, then the unknown files by reason and
 * D9's reasons, each a line.
 */
export function lintStatusLines(status: LintStatus, command: string): string[] {
  if (status.off !== undefined) return [lintOffLine(status.off)];
  if (status.unreadable !== undefined) {
    return [`Lint: unknown: the lint store cannot be read: ${firstLine(status.unreadable)}.`];
  }
  const linting = status.linting === undefined ? "" : `; ${lintingWords(status.linting)}`;
  // While the first lint runs with no finding yet, "0 files with findings" would not be true.
  const counted = status.linting === undefined || status.failing > 0 || status.stale > 0;
  const parts = [
    `${plural(status.failing, "file")} with findings`,
    ...(status.since === null ? [] : [`${status.sinceRegistration} ${SINCE[status.since]}`]),
    ...(status.stale === 0 ? [] : [`${status.stale} stale`]),
    ...(status.pending === 0 ? [] : [`${status.pending} not linted yet`]),
    ...(status.unknown === 0 ? [] : [`${status.unknown} unknown`]),
  ];
  return [
    counted
      ? `Lint: ${parts.join(", ")}${linting}; ${command} lint lists them.`
      : `Lint: ${lintingWords(status.linting ?? { done: 0, total: 0 })}.`,
    ...status.reasons.map(
      (r) => `Lint: unknown: ${plural(r.files, "file")}: ${firstLine(r.reason)}.`,
    ),
    ...(status.failed === undefined ? [] : [lintFailedLine(status.failed)]),
  ];
}
