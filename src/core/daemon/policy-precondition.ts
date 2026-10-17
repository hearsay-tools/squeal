import { isRecord } from "../fs/index.js";
import { globToRegExp } from "../keys/glob.js";

/** `slow.precondition`'s `timeoutMs` when it names none (D7 as amended 2026-10-17). */
export const PRECONDITION_TIMEOUT_MS = 10_000;

const PRECONDITION_KEYS: ReadonlySet<string> = new Set(["exists", "command", "timeoutMs"]);

/**
 * The `slow.precondition` and `nodeTest[].precondition` rule (spec 004 D7 as
 * amended 2026-10-17, task 004-65): an object with `exists`, a non-empty list
 * of globs that compile, or `command`, a non-empty argv, or both, and
 * `timeoutMs`, a positive integer. A value that does not fit is what was
 * expected, so no precondition applies and the tier runs as before.
 */
export function slowPrecondition(value: unknown): string | { readonly problem: string } | null {
  const expected =
    'an object with "exists" (an array of paths or globs) or "command" (an argv array), and optionally "timeoutMs"';
  if (!isRecord(value)) return expected;
  const unknown = Object.keys(value).find((key) => !PRECONDITION_KEYS.has(key));
  if (unknown !== undefined) return { problem: `has an unknown key "${unknown}"` };
  const { exists, command, timeoutMs } = value;
  if (exists === undefined && command === undefined) return expected;
  if (exists !== undefined) {
    if (!nonEmptyStrings(exists)) {
      return { problem: '"exists" must be a non-empty array of strings' };
    }
    for (const glob of exists) {
      try {
        globToRegExp(glob);
      } catch (error) {
        return { problem: `"exists" has a glob Squeal cannot use: ${(error as Error).message}` };
      }
    }
  }
  if (command !== undefined && !nonEmptyStrings(command)) {
    return { problem: '"command" must be a non-empty array of strings, the program first' };
  }
  if (timeoutMs !== undefined && !(Number.isInteger(timeoutMs) && (timeoutMs as number) > 0)) {
    return { problem: '"timeoutMs" must be a positive integer' };
  }
  return null;
}

function nonEmptyStrings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((s) => typeof s === "string" && s.length > 0)
  );
}
