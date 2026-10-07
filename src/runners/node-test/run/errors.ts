import { fileURLToPath } from "node:url";
import type { WorktreePaths } from "../../../core/fs/worktree-paths.js";
import type { CheckError, SourceLocation } from "../../../core/types/index.js";
import type { SerializedTestError } from "./events.js";

/** The thrown value of a failed test, as the reporter copied it. */
interface Cause {
  readonly name?: unknown;
  readonly message?: unknown;
  readonly stack?: unknown;
  readonly actual?: unknown;
  readonly expected?: unknown;
  readonly operator?: unknown;
  readonly generatedMessage?: unknown;
}

/**
 * A `CheckError` from a `test:fail`'s `details.error` (spec 003 D5): the
 * `cause` is what the test threw, the `ERR_TEST_FAILURE` around it only says
 * which kind of failure it was. An assertion with its own message keeps
 * `actual`, `expected` and `operator` as the diff; a generated message
 * already holds them.
 */
export function toCheckError(
  error: SerializedTestError | undefined,
  paths: WorktreePaths,
): CheckError {
  const cause = error?.cause;
  if (typeof cause === "object" && cause !== null && typeof (cause as Cause).message === "string") {
    const c = cause as Cause;
    const stack = typeof c.stack === "string" ? c.stack : null;
    return {
      name: typeof c.name === "string" ? c.name : "Error",
      message: paths.relativizeText(c.message as string),
      stack: stack === null ? null : paths.relativizeText(stack),
      location: stack === null ? null : firstProjectLocation(stack, paths),
      diff: assertionDiff(c),
    };
  }
  const message =
    cause === undefined || cause === null ? (error?.message ?? "test failed") : String(cause);
  return {
    name: typeof error?.name === "string" ? error.name : "Error",
    message: paths.relativizeText(message),
    stack: null,
    location: null,
    diff: null,
  };
}

function assertionDiff(cause: Cause): string | null {
  if (cause.generatedMessage !== false || !("actual" in cause) || !("expected" in cause)) {
    return null;
  }
  const show = (value: unknown) => JSON.stringify(value) ?? String(value);
  const operator = typeof cause.operator === "string" ? `operator: ${cause.operator}\n` : "";
  return `${operator}expected: ${show(cause.expected)}\nactual: ${show(cause.actual)}`;
}

/**
 * The `CheckError` of a file that failed with no failing check, built from
 * its stderr, where the syntax error or the module-not-found stack lives
 * (research, runner-api 6). The message is the first error line, joined to
 * the next one when it ends in a colon (tsx: "Transform failed with 1
 * error:" then the location); the stack is the whole stderr.
 */
export function stderrError(stderr: string, paths: WorktreePaths): CheckError | null {
  const text = paths.relativizeText(stderr).trim();
  if (text === "") return null;
  const lines = text.split("\n");
  const at = lines.findIndex((line) => ERROR_LINE.test(line));
  const first = lines[at] ?? "";
  const next = lines[at + 1]?.trim() ?? "";
  const headline =
    at === -1 ? text : first.endsWith(":") && next !== "" ? `${first} ${next}` : first;
  return {
    name: ERROR_LINE.exec(first)?.[1] ?? "Error",
    message: headline,
    stack: text,
    location: firstProjectLocation(stderr, paths),
    diff: null,
  };
}

/** `Error: ...`, `SyntaxError: ...`, `Error [ERR_MODULE_NOT_FOUND]: ...` at the start of a line. */
const ERROR_LINE = /^((?:[A-Z]\w*)?Error)\b[^:\n]*:/;

/** `/abs/file.ts:3:14` or `file:///abs/file.ts:3:14`, inside or outside parentheses. */
const POSITION = /(file:\/\/\/[^\s():]+|\/[^\s():]+):(\d+):(\d+)/g;

/** The first position in `text` that names a project file: outside `node_modules`, inside the root. */
export function firstProjectLocation(text: string, paths: WorktreePaths): SourceLocation | null {
  for (const match of text.matchAll(POSITION)) {
    const [, where, line, column] = match;
    if (where === undefined) continue;
    const file = where.startsWith("file:") ? fileURLToPath(where) : where;
    if (!paths.isProjectFile(file)) continue;
    const location = paths.location(file, Number(line), Number(column));
    if (location !== null) return location;
  }
  return null;
}
