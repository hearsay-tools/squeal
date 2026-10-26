import { plural } from "../text.js";
import type { CodeCheckId, CodeMeasure } from "../types/code.js";
import type {
  CodeDeltaEntry,
  CodeNews,
  CodeNotJudged,
  CodeRecount,
  CodeRegistration,
  CodeTooBig,
} from "../types/code-delivery.js";
import { type BlockContext, coverageEntryLine, isCoverage, named } from "./code-coverage.js";
import { isStillFail } from "./code-delta.js";
import { joined, recordingNames } from "./code-runners.js";

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

/** `name (path:line)`: a function and where it is. */
const atOf = (check: CodeCheckId, line: number | null) =>
  `${functionName(check)} (${whereOf(check, line)})`;

/**
 * One told change: the FAIL, PASS, RESOLVED or STILL FAIL line. `at` is
 * the function and where it is, `null` inside its block (row 015-65).
 */
export function codeEntryLine(
  entry: CodeDeltaEntry,
  command: string,
  at: string | null = atOf(entry.check, entry.line),
  block: BlockContext = { others: [], hint: () => false },
): string {
  // Spec 015 D9 (row 015-12): `crap` and `uncovered` have lines of their own.
  if (isCoverage(entry)) return coverageEntryLine(entry, at, command, block);
  const is = named(at, " is ");
  switch (entry.kind) {
    case "first-seen-fail":
    case "pass-to-fail":
      return `FAIL complexity: ${is}${entry.value}, over ${entry.threshold} (${ruleOf(entry.check)})`;
    case "fail-to-pass":
      return `PASS complexity: ${is}${entry.value}, at or under ${entry.threshold}`;
    case "removed":
      return `RESOLVED complexity: ${is}no longer in the code`;
    case "edited":
      // D6, its last rule: not a new failure, so the line says it was over before the edit.
      return `STILL FAIL complexity: ${is}${entry.value} after the edit; it was already over ${entry.threshold} before it (${ruleOf(entry.check)}); ${quietHint(entry, command)}`;
    case "edited-after-fail":
      // 015-21: the agent heard the FAIL, so this is its fix attempt, still over.
      return `STILL FAIL complexity: ${is}${entry.value} after the edit, over ${entry.threshold} (${ruleOf(entry.check)}); ${quietHint(entry, command)}`;
  }
}

/** Row 015-65: the order of a function's lines in its block. */
const BLOCK_ORDER: readonly CodeMeasure[] = ["complexity", "uncovered", "crap"];

/**
 * Row 015-65 (D6 **One function, several changes**): each function's
 * changes in the order the delivery lists them. A function with one change
 * keeps one line; with two or more, the function and its place head one
 * block, then one line per changed check, each with its own status. The
 * first line that says a test may start a process names `coverage.exclude`
 * when the news asks it.
 */
function functionLines(news: CodeNews, command: string): string[] {
  const byFunction = new Map<string, CodeDeltaEntry[]>();
  for (const e of news.entries) {
    const key = JSON.stringify([e.check.path, e.check.qualifiedName, e.check.occurrence]);
    byFunction.set(key, [...(byFunction.get(key) ?? []), e]);
  }
  let owed = news.excludeHint === true;
  const hint = () => {
    const told = owed;
    owed = false;
    return told;
  };
  return [...byFunction.values()].flatMap((entries) => {
    const [first] = entries;
    if (first === undefined) return [];
    if (entries.length === 1) {
      return [codeEntryLine(first, command, undefined, { others: [], hint })];
    }
    const sorted = [...entries].sort(
      (a, b) => BLOCK_ORDER.indexOf(a.measure) - BLOCK_ORDER.indexOf(b.measure),
    );
    const line = entries.find((e) => e.line !== null)?.line ?? null;
    return [
      `${atOf(first.check, line)}:`,
      ...sorted.map(
        (e) =>
          `- ${codeEntryLine(e, command, null, { others: sorted.filter((o) => o !== e), hint })}`,
      ),
    ];
  });
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

/** Row 015-64: D1's summary of a coverage check switched off or files newly excluded. */
export function coverageChangeLine({
  off,
  excluded,
}: NonNullable<CodeNews["coverageChange"]>): string {
  const parts = [
    ...(off.includes("crap") ? ["CRAP off (crap.enabled)"] : []),
    ...(off.includes("uncovered") ? ["untested off (coverage.untested)"] : []),
    ...(excluded === 0 ? [] : [`${plural(excluded, "file")} no longer checked (coverage.exclude)`]),
  ];
  return `Coverage checks changed: ${parts.join("; ")}.`;
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
    ...(news.coverageChange === undefined ? [] : [coverageChangeLine(news.coverageChange)]),
    ...functionLines(news, command),
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
 * over CRAP 30 and 1 untested,`. With one measure, no
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
    ...(uncovered === undefined ? [] : [[uncovered, "untested"] as [number, string]]),
  ];
  const words = parts.map(([n, what], i) => `${i === 0 ? plural(n, "function") : n} ${what}`);
  const last = words.pop() ?? "";
  return words.length === 0 ? last : `${words.join(", ")} and ${last},`;
}

/** `a`, `a and b`, `a, b and c`. */
const andList = (words: readonly string[]) =>
  words.length < 2 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;

/** A changed file not judged with its reason: `a.ts (600 KiB, over the 512 KiB limit)`. */
const notJudgedFile = (file: CodeNotJudged) =>
  file.reason === "too-big"
    ? `${file.path} (${kib(file.size)}, over the ${kib(file.limit)} limit)`
    : `${file.path} (could not count)`;

/**
 * Row 015-49 (D6, a changed file not judged): `4 files this session
 * changed are not judged: a.ts (could not count), b.ts (600 KiB, over the
 * 512 KiB limit), c.ts (could not count) and 1 more`.
 */
function notJudgedWords({ files, more }: NonNullable<CodeNews["notJudged"]>): string {
  const total = files.length + more;
  const named = files.map(notJudgedFile);
  const list = more === 0 ? andList(named) : `${named.join(", ")} and ${more} more`;
  return `${plural(total, "file")} this session changed ${total === 1 ? "is" : "are"} not judged: ${list}`;
}

/**
 * Row 015-27: test news's last line, while functions the consumer was told
 * of in full are over (`CodeNews.toldOver`). Row 015-49: also while files
 * it changed are not judged (`CodeNews.notJudged`); `null` while neither.
 */
export function toldOverLine(
  { toldOver, notJudged }: Pick<CodeNews, "toldOver" | "notJudged">,
  command: string,
): string | null {
  const parts = [
    ...(toldOver === undefined
      ? []
      : [`${toldOverWords(toldOver)} that this session was told about`]),
    ...(notJudged === undefined ? [] : [notJudgedWords(notJudged)]),
  ];
  return parts.length === 0
    ? null
    : `Complexity: ${parts.join("; ")}; ${command} code --told lists them.`;
}

/** Row 015-27: complexity news's last line, while tests have known failures. */
export function knownFailuresTailLine(failures: number, command: string): string {
  return `Tests: ${plural(failures, "known failure")}; ${command} status lists them.`;
}

/** D6: the registration's line; row 015-75 ends it with the runners whose runs give no records. */
export function codeRegistrationLine(code: CodeRegistration, command: string): string {
  // Row 015-75: the one mention of sources no record measures, at the session start.
  const names = code.notMeasured ?? [];
  const sentence =
    names.length === 0
      ? ""
      : ` Coverage comes from ${joined(recordingNames(), "and")} runs only; functions that only ${joined(names)} tests run read not measured.`;
  return `${complexityLine(code, command)}${sentence}`;
}

/** D6: `Complexity: 62 functions over 20; squeal code lists them.`, or the count's progress. */
function complexityLine(code: CodeRegistration, command: string): string {
  if (code.counting !== undefined) {
    const { done, total } = code.counting;
    return total === 0
      ? "Complexity: counting has not started."
      : `Complexity: counting, ${done} of ${plural(total, "file")}.`;
  }
  return `Complexity: ${plural(code.over, "function")} over ${code.threshold}; ${command} code lists them.`;
}
