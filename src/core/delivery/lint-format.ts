import { cap, plural } from "../text.js";
import type { LintCheckId, LintTransitionKind } from "../types/lint.js";

/*
 * Spec 017 D8: how deliveries, registrations and status word the lint
 * checks, after 015 D6's code form. Lint owns its words, its overflow and
 * its title (015's agreement, 2026-10-26): the callers join them beside the
 * code's, whose functions stay as they are. Factual, as every hook text
 * (001 D6): never an instruction.
 */

// The shapes below are 017-10's proposal for 017-09's `types/lint-delivery.ts`; they move there at integration.

/** A finding as a line names it: its rule, `null` for one no rule made (a parse error, D9). */
export interface LintFindingWords {
  readonly rule: string | null;
  readonly message: string;
}

/** D8: one lint change told in its own line. */
export interface LintDeltaEntry {
  readonly kind: LintTransitionKind;
  readonly check: LintCheckId;
  /** The file's findings now; 0 for a `pass` and a removed file. */
  readonly findings: number;
  /** D2: evidence only, matched in two stages. */
  readonly added: readonly LintFindingWords[];
  readonly removed: readonly LintFindingWords[];
}

/** D8: what a delivery tells of the lint checks. */
export interface LintNews {
  readonly v: 1;
  /** At most `LINT_LISTED_MAX`, failures first. */
  readonly entries: readonly LintDeltaEntry[];
  /** The changes past the cap, told by number. */
  readonly more: number;
  /** D8: a config, plugin or ESLint change: the files with findings once the pass after it ended. */
  readonly configChange?: { readonly failing: number };
  /** D9: why every file the config covers is `unknown`, once per pass while it lasts. */
  readonly unknown?: { readonly reason: string };
}

/** D8: the registration's one line. */
export interface LintRegistration {
  readonly v: 1;
  readonly failing: number;
  /** While the first pass runs. */
  readonly linting?: { readonly done: number; readonly total: number };
  /** D9: why lint is off while `lint.enabled` holds. */
  readonly off?: string;
}

/** The longest message a lint line quotes. */
export const LINT_MESSAGE_MAX_CHARS = 160;

/** A message as a line quotes it: its first line, capped. */
const messageText = (message: string) =>
  cap(message.split("\n", 1)[0] ?? "", LINT_MESSAGE_MAX_CHARS);

/** A reason as a sentence ends it: its first line, with no period of its own. */
const reasonText = (reason: string) => messageText(reason).replace(/\.+$/, "");

/**
 * The findings of one side, by rule in their first order: `+2 no-console`.
 * With one message for the rule, it follows in parentheses; a finding with
 * no rule is named by its message.
 */
function findingsWords(findings: readonly LintFindingWords[], sign: "+" | "-"): string[] {
  const byRule = new Map<string, LintFindingWords[]>();
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

/** D8: one change's line, `FAIL lint: src/a.ts: 2 findings, +1 no-unused-vars (...)`. */
export function lintEntryLine(entry: LintDeltaEntry): string {
  const { path } = entry.check;
  switch (entry.kind) {
    case "first-seen-fail":
    case "pass-to-fail":
    case "fail-changed": {
      const words = [...findingsWords(entry.added, "+"), ...findingsWords(entry.removed, "-")];
      return `FAIL lint: ${path}: ${[plural(entry.findings, "finding"), ...words].join(", ")}`;
    }
    case "fail-to-pass":
      return `PASS lint: ${path}: no findings`;
    case "removed":
      return `RESOLVED lint: ${path}: no longer linted`;
  }
}

/** D8: the config summary, once the pass after a config, plugin or ESLint change ended. */
export function lintConfigLine({ failing }: { readonly failing: number }, command: string): string {
  return `Lint config changed: ${plural(failing, "file")} with findings now; ${command} lint lists them.`;
}

/** D9: a config that does not load, `Lint: unknown: eslint.config.js does not load: ...`. */
export const lintUnknownLine = ({ reason }: { readonly reason: string }) =>
  `Lint: unknown: ${reasonText(reason)}.`;

/** D8: a delivery's lint lines, after the code's: the summaries, the changes, the rest by number. */
export function lintLines(news: LintNews, command: string): string[] {
  return [
    ...(news.configChange === undefined ? [] : [lintConfigLine(news.configChange, command)]),
    ...(news.unknown === undefined ? [] : [lintUnknownLine(news.unknown)]),
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

/** D8: the registration's line, or the first pass's progress, or why lint is off. */
export function lintRegistrationLine(lint: LintRegistration, command: string): string {
  if (lint.off !== undefined) return `Lint: off: ${reasonText(lint.off)}.`;
  if (lint.linting !== undefined) {
    const { done, total } = lint.linting;
    return total === 0
      ? "Lint: linting has not started."
      : `Lint: linting, ${done} of ${plural(total, "file")}.`;
  }
  return `Lint: ${plural(lint.failing, "file")} with findings; ${command} lint lists them.`;
}
