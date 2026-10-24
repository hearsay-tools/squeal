import { plural } from "../text.js";
import type { CodeCheckId } from "../types/code.js";
import type {
  CodeDeltaEntry,
  CodeNews,
  CodeRecount,
  CodeRegistration,
  CodeTooBig,
} from "../types/code-delivery.js";
import { coverageEntryLine, isCoverage } from "./code-coverage.js";
import { isStillFail } from "./code-delta.js";

/*
 * Spec 015 D6: how deliveries and registrations word the code. Factual, as
 * every hook text (001 D6): a number and where to look, never the list a
 * registration would flood the agent with.
 */

/** A function's name; a second one of the same name in its file says which. */
export function functionName(check: CodeCheckId): string {
  return check.occurrence === 0
    ? check.qualifiedName
    : `${check.qualifiedName} (occurrence ${check.occurrence + 1})`;
}

/** D3: the rule the count follows, ESLint's for TS and JS, radon's for Python. */
export const ruleOf = (check: CodeCheckId) =>
  check.path.endsWith(".py") ? "radon rule" : "ESLint rule";

/** `path:line`, or the path when the line is not known. */
export const whereOf = (check: CodeCheckId, line: number | null) =>
  line === null ? check.path : `${check.path}:${line}`;

/**
 * 015-21: how a STILL FAIL line ends, so the agent knows it hears of the
 * function again only once it is back at or under the threshold.
 */
const quietHint = (entry: CodeDeltaEntry, command: string) =>
  `Squeal stays quiet about it until it is at or under ${entry.threshold}, and ${command} code ${entry.check.path} shows its count.`;

/** One told change: the FAIL, PASS, RESOLVED or STILL FAIL line. */
export function codeEntryLine(entry: CodeDeltaEntry, command: string): string {
  const at = `${functionName(entry.check)} (${whereOf(entry.check, entry.line)})`;
  // Spec 015 D9 (row 015-12): `crap` and `uncovered` have lines of their own.
  if (isCoverage(entry)) return coverageEntryLine(entry, at, command);
  switch (entry.kind) {
    case "first-seen-fail":
    case "pass-to-fail":
      return `FAIL complexity: ${at} is ${entry.value}, over ${entry.threshold} (${ruleOf(entry.check)})`;
    case "fail-to-pass":
      return `PASS complexity: ${at} is ${entry.value}, at or under ${entry.threshold}`;
    case "removed":
      return `RESOLVED complexity: ${at} is no longer in the code`;
    case "edited":
      // D6, its last rule: not a new failure, so the line says it was over before the edit.
      return `STILL FAIL complexity: ${at} is ${entry.value} after the edit; it was already over ${entry.threshold} before it (${ruleOf(entry.check)}); ${quietHint(entry, command)}`;
    case "edited-after-fail":
      // 015-21: the agent heard the FAIL, so this is its fix attempt, still over.
      return `STILL FAIL complexity: ${at} is ${entry.value} after the edit, over ${entry.threshold} (${ruleOf(entry.check)}); ${quietHint(entry, command)}`;
  }
}

/** D6's summary of a recount, by what changed. */
export function recountLine(
  recount: CodeRecount & { readonly over: number },
  command: string,
): string {
  const lists = `${command} code lists them.`;
  const over = plural(recount.over, "function");
  switch (recount.reason) {
    case "threshold":
      return `Complexity threshold is now ${recount.threshold}: ${over} over; ${lists}`;
    case "first":
      return `Complexity counted: ${over} over ${recount.threshold}; ${lists}`;
    case "include":
      return `Complexity counted again, the included files changed: ${over} over ${recount.threshold}; ${lists}`;
    case "counter":
      return `Complexity counted again by a new counter: ${over} over ${recount.threshold}; ${lists}`;
  }
}

/** Row 015-40: D6's summary of a `crap.threshold` change. */
export function crapRecountLine(
  { threshold, over }: NonNullable<CodeNews["crapRecount"]>,
  command: string,
): string {
  return `CRAP threshold is now ${threshold}: ${plural(over, "function")} over; ${command} code lists them.`;
}

const kib = (bytes: number) => `${Math.round(bytes / 1024)} KiB`;

/** D6: a file an edit changed that is too big to count. */
export function tooBigLine({ path, size, limit }: CodeTooBig): string {
  return `${path} is ${kib(size)}, over the ${kib(limit)} limit; its functions are not counted.`;
}

/** The code lines of a delivery, after every test block: changes, the rest by number, then notes. */
export function codeLines(news: CodeNews, command: string): string[] {
  return [
    ...(news.recount === undefined ? [] : [recountLine(news.recount, command)]),
    ...(news.crapRecount === undefined ? [] : [crapRecountLine(news.crapRecount, command)]),
    ...news.entries.map((e) => codeEntryLine(e, command)),
    ...(news.more === 0
      ? []
      : [
          `and ${news.more} more ${changesWord(news)} ${news.more === 1 ? "change" : "changes"}; ${command} code --changed lists them.`,
        ]),
    ...(news.tooBig ?? []).map(tooBigLine),
  ];
}

/** Row 015-12: changes of `crap` or `uncovered` states among them make them code changes. */
const changesWord = (news: CodeNews) => (news.coverage === true ? "code" : "complexity");

/** How many function changes a delivery's code part tells, listed or by number; a STILL FAIL is none. */
export const codeChanges = (news: CodeNews) =>
  news.entries.filter((e) => !isStillFail(e.kind)).length + news.more;

/**
 * A delivery title's words for its code lines of functions: the changes,
 * then the functions told still over (lessons round 1); `null` when it
 * tells no function. Row 015-40: with a `crap` or `uncovered` STILL FAIL
 * among them, the functions still failing a code check, each once.
 */
export function codeTitleWords(news: CodeNews): string | null {
  const changes = codeChanges(news);
  const still = news.entries.filter((e) => isStillFail(e.kind));
  const functions = new Set(
    still.map((e) => JSON.stringify([e.check.path, functionName(e.check)])),
  );
  const words = [
    ...(changes === 0
      ? []
      : [`${changes} ${changesWord(news)} ${changes === 1 ? "change" : "changes"}`]),
    ...(still.length === 0
      ? []
      : still.some(isCoverage)
        ? [`${plural(functions.size, "function")} still failing a code check`]
        : [`${plural(still.length, "function")} still over the complexity threshold`]),
  ];
  return words.length === 0 ? null : words.join(" and ");
}

/**
 * Row 015-40 (wording in status.md, 2026-10-24): the functions told over,
 * each measure apart and one with none left out: `2 functions over 20, 1
 * over CRAP 30 and 1 no in-process test reaches,`. With one measure, no
 * comma ends it.
 */
export function toldOverWords({
  count,
  threshold,
  crap,
  uncovered,
}: NonNullable<CodeNews["toldOver"]>): string {
  const parts: [number, string][] = [
    ...(count === 0 ? [] : [[count, `over ${threshold}`] as [number, string]]),
    ...(crap === undefined
      ? []
      : [[crap.count, `over CRAP ${crap.threshold}`] as [number, string]]),
    ...(uncovered === undefined
      ? []
      : [[uncovered, "no in-process test reaches"] as [number, string]]),
  ];
  const words = parts.map(([n, what], i) => `${i === 0 ? plural(n, "function") : n} ${what}`);
  const last = words.pop() ?? "";
  return words.length === 0 ? last : `${words.join(", ")} and ${last},`;
}

/**
 * Row 015-27: test news's last line, while functions the consumer was told
 * of in full are over (`CodeNews.toldOver`).
 */
export function toldOverLine(over: NonNullable<CodeNews["toldOver"]>, command: string): string {
  return `Complexity: ${toldOverWords(over)} that this session was told about; ${command} code --told lists them.`;
}

/** Row 015-27: complexity news's last line, while tests have known failures. */
export function knownFailuresTailLine(failures: number, command: string): string {
  return `Tests: ${plural(failures, "known failure")}; ${command} status lists them.`;
}

/** D6: the registration's line. */
export function codeRegistrationLine(code: CodeRegistration, command: string): string {
  if (code.counting !== undefined) {
    const { done, total } = code.counting;
    return total === 0
      ? "Complexity: counting has not started."
      : `Complexity: counting, ${done} of ${plural(total, "file")}.`;
  }
  return `Complexity: ${plural(code.over, "function")} over ${code.threshold}; ${command} code lists them.`;
}
