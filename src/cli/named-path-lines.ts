import { plural } from "../core/text.js";
import { unmatchedText } from "./named-file-lines.js";
import type { NamedSelection } from "./named-selection.js";
import type { SelectionResult } from "./verdict.js";

/**
 * Row 011-206 (gh-83, 011 C15): after `Selected:`, a line per named path
 * that is not a listed test file and selects the test files that read it,
 * so `Selected:` keeps naming test files only (the evals parser splits it).
 * One Squeal does not run says so, and that their verdict is not its own. A
 * path that selects nothing is named on the verdict line (row 011-63).
 * Row 011-401: a partial list (`NamedSelection.partial`) is said first.
 */
export function namedPathLines(selection: NamedSelection): string[] {
  // Row 011-401 (gh-242): a list that may still grow gives its counts as lower bounds.
  const some = selection.partial === undefined ? "the" : "at least";
  const lines = selection.paths.flatMap((p) => {
    if (p.selects === 0 || p.kind === "test-file") return [];
    const readers = `it selects ${some} ${plural(p.selects, "test file")} that ${p.selects === 1 ? "reads" : "read"} it`;
    return p.kind === "not-run"
      ? [`Not run by Squeal: ${p.path} is ${NOT_LISTED}; ${readers}, whose verdict is not its own`]
      : [`Not a listed test file: ${p.path}; ${readers}`];
  });
  return selection.partial === undefined ? lines : [partialLine(selection), ...lines];
}

/**
 * Row 011-401 (gh-242): `Selection: at least 1 test file; the list is partial while Squeal
 * catches up with revision 14`, or with the edits the daemon's pass has not stored;
 * `no test file yet` when it selects none so far.
 */
function partialLine(selection: NamedSelection): string {
  const revision = selection.partial?.revision ?? null;
  const target = revision === null ? "your latest edits" : `revision ${revision}`;
  const n = selection.files.length;
  const count = n === 0 ? "no test file yet" : `at least ${plural(n, "test file")}`;
  return `Selection: ${count}; the list is partial while Squeal catches up with ${target}`;
}

const NOT_LISTED = "not a test file any runner here lists";

/**
 * The named paths that leave no clean verdict, as the verdict line names
 * them: row 011-206's test files Squeal does not run, then D2's paths that
 * select nothing (row 011-27); empty when there is none.
 */
export function pathsText(selection: NamedSelection): string {
  const notRun = selection.paths.filter((p) => p.kind === "not-run").map((p) => p.path);
  const skip = new Set(notRun);
  const unmatched = selection.unmatched.filter((p) => !skip.has(p));
  const rest: NamedSelection = {
    ...selection,
    unmatched,
    unmatchedPaths: selection.unmatchedPaths.filter((p) => !skip.has(p.resolved)),
  };
  return [
    ...notRun.map((path) => `Squeal does not run ${path}, which is ${NOT_LISTED}`),
    ...(unmatched.length === 0 ? [] : [unmatchedText(rest)]),
  ].join("; ");
}

/**
 * Whether only the named paths leave the selection without a verdict, every
 * selected file current and passing: the verdict line names them first.
 */
export function heldByPaths(
  result: SelectionResult,
): result is { readonly result: "none"; readonly reason: "unmatched" | "not-run" } {
  return result.result === "none" && (result.reason === "unmatched" || result.reason === "not-run");
}
