import { cap, plural } from "../text.js";
import type { LintFinding } from "../types/lint.js";
import type {
  LintNews,
  LintNewsEntry,
  LintReasons,
  LintRegistration,
  LintSummary,
} from "../types/lint-delivery.js";

/*
 * Spec 017 D8: how deliveries, registrations and status word the lint
 * checks, after 015 D6's code form. Lint owns its words, its overflow and
 * its title (015's agreement, 2026-10-26): the callers join them beside the
 * code's, whose functions stay as they are. Factual, as every hook text
 * (001 D6): never an instruction.
 */

/** The longest message a lint line quotes. */
export const LINT_MESSAGE_MAX_CHARS = 160;

/** A message as a line quotes it: its first line, capped. */
export const messageText = (message: string) =>
  cap(message.split("\n", 1)[0] ?? "", LINT_MESSAGE_MAX_CHARS);

/** A reason inside a sentence: its first line, capped, with no period of its own. */
export const reasonText = (reason: string) => messageText(reason).replace(/\.+$/, "");

/**
 * The findings of one side, by rule in their first order: `+2 no-console`.
 * An added rule whose findings share one message names it in parentheses;
 * a finding with no rule (a parse error, D9) is named by its message.
 */
function findingsWords(findings: readonly LintFinding[], sign: "+" | "-"): string[] {
  const byRule = new Map<string, LintFinding[]>();
  for (const f of findings) {
    const key = f.rule ?? `\0${messageText(f.message)}`;
    byRule.set(key, [...(byRule.get(key) ?? []), f]);
  }
  return [...byRule.values()].flatMap((group) => {
    const [first] = group;
    if (first === undefined) return [];
    const message = messageText(first.message);
    if (first.rule === null) return [`${sign}${group.length} ${message}`];
    const one = sign === "+" && group.every((f) => messageText(f.message) === message);
    return [`${sign}${group.length} ${first.rule}${one ? ` (${message})` : ""}`];
  });
}

/** A FAIL whose key moved since its lint (D5): its findings are the last known. */
const STALE_WORDS = "stale: an input it reads changed, linted again when the agent is idle";

/** D8: one change's line, `FAIL lint: src/a.ts: 2 findings, +1 no-unused-vars (...)`. */
export function lintEntryLine(entry: LintNewsEntry): string {
  const { path } = entry;
  switch (entry.kind) {
    case "first-seen-fail":
    case "pass-to-fail":
    case "fail-changed": {
      const words = [
        // A result no longer stored has no count to give; its change still names its findings.
        ...(entry.findings === null ? [] : [plural(entry.findings, "finding")]),
        ...findingsWords(entry.added, "+"),
        ...findingsWords(entry.removed, "-"),
      ];
      const stale = entry.stale === true ? `; ${STALE_WORDS}` : "";
      return `FAIL lint: ${path}: ${words.join(", ") || "findings"}${stale}`;
    }
    case "fail-to-pass":
      return `PASS lint: ${path}: no findings`;
    case "removed":
      return `RESOLVED lint: ${path}: no longer linted`;
  }
}

/** `14 files with findings`, and the stale ones apart. */
const failingWords = ({ failing, stale }: { readonly failing: number; readonly stale: number }) =>
  `${plural(failing, "file")} with findings${stale === 0 ? "" : `, ${stale} stale`}`;

/**
 * D8: once the first lint of every file, or the pass after a config,
 * plugin or ESLint change, ended: one summary line, the view seeded by count.
 */
export function lintSummaryLine(summary: LintSummary, command: string): string {
  const lists = `${command} lint lists them.`;
  return summary.reason === "config"
    ? `Lint config changed: ${failingWords(summary)} now; ${lists}`
    : `Lint checked every file: ${failingWords(summary)}; ${lists}`;
}

/**
 * D9: why lint cannot say more, one line: off, its store unreadable, or
 * every file `unknown` as the config does not load; `null` for none.
 */
export function lintReasonLine({ off, unreadable, failed }: LintReasons): string | null {
  if (off !== undefined) return `Lint: off: ${reasonText(off)}.`;
  if (unreadable !== undefined)
    return `Lint: the lint store cannot be read: ${reasonText(unreadable)}.`;
  if (failed !== undefined) return `Lint: unknown: ${reasonText(failed)}.`;
  return null;
}

/** D8: a delivery's lint lines, after the code's: the reasons, the summary, the changes, the rest by number. */
export function lintLines(news: LintNews, command: string): string[] {
  const reason = lintReasonLine(news);
  return [
    ...(reason === null ? [] : [reason]),
    ...(news.summary === undefined ? [] : [lintSummaryLine(news.summary, command)]),
    ...news.entries.map(lintEntryLine),
    ...(news.more === 0
      ? []
      : [
          `and ${news.more} more lint ${news.more === 1 ? "change" : "changes"}; ${command} lint --changed lists them.`,
        ]),
  ];
}

/** How many lint changes a delivery tells, listed or by number. */
export const lintChanges = (news: LintNews) => news.entries.length + news.more;

/** A delivery title's words for its lint lines, `2 lint changes`; `null` when it tells none. */
export function lintTitleWords(news: LintNews): string | null {
  const changes = lintChanges(news);
  return changes === 0 ? null : `${changes} lint ${changes === 1 ? "change" : "changes"}`;
}

/** D8: the registration's line: why lint cannot say more, the first pass's progress, or the count. */
export function lintRegistrationLine(lint: LintRegistration, command: string): string {
  const reason = lintReasonLine(lint);
  if (reason !== null) return reason;
  if (lint.linting !== undefined) {
    const { done, total } = lint.linting;
    return total === 0
      ? "Lint: linting has not started."
      : `Lint: linting, ${done} of ${plural(total, "file")}.`;
  }
  return `Lint: ${failingWords(lint)}; ${command} lint lists them.`;
}
