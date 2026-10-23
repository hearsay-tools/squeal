import { plural } from "../text.js";
import type { CodeCheckId } from "../types/code.js";
import type {
  CodeDeltaEntry,
  CodeNews,
  CodeRecount,
  CodeRegistration,
  CodeTooBig,
} from "../types/code-delivery.js";

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

/** One told change: the FAIL, PASS or RESOLVED line. */
export function codeEntryLine(entry: CodeDeltaEntry): string {
  const at = `${functionName(entry.check)} (${whereOf(entry.check, entry.line)})`;
  switch (entry.kind) {
    case "first-seen-fail":
    case "pass-to-fail":
      return `FAIL complexity: ${at} is ${entry.value}, over ${entry.threshold} (${ruleOf(entry.check)})`;
    case "fail-to-pass":
      return `PASS complexity: ${at} is ${entry.value}, at or under ${entry.threshold}`;
    case "removed":
      return `RESOLVED complexity: ${at} is no longer in the code`;
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

const kib = (bytes: number) => `${Math.round(bytes / 1024)} KiB`;

/** D6: a file an edit changed that is too big to count. */
export function tooBigLine({ path, size, limit }: CodeTooBig): string {
  return `${path} is ${kib(size)}, over the ${kib(limit)} limit; its functions are not counted.`;
}

/** The code lines of a delivery, after every test block: changes, the rest by number, then notes. */
export function codeLines(news: CodeNews, command: string): string[] {
  return [
    ...(news.recount === undefined ? [] : [recountLine(news.recount, command)]),
    ...news.entries.map(codeEntryLine),
    ...(news.more === 0
      ? []
      : [
          `and ${news.more} more complexity ${news.more === 1 ? "change" : "changes"}; ${command} code --changed lists them.`,
        ]),
    ...(news.tooBig ?? []).map(tooBigLine),
  ];
}

/** How many function changes a delivery's code part tells, listed or by number. */
export const codeChanges = (news: CodeNews) => news.entries.length + news.more;

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
