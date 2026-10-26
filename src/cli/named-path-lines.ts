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
 */
export function namedPathLines(selection: NamedSelection): string[] {
  return selection.paths.flatMap((p) => {
    if (p.selects === 0 || p.kind === "test-file") return [];
    const readers = `it selects the ${plural(p.selects, "test file")} that ${p.selects === 1 ? "reads" : "read"} it`;
    return p.kind === "not-run"
      ? [`Not run by Squeal: ${p.path} is ${NOT_LISTED}; ${readers}, whose verdict is not its own`]
      : [`Not a listed test file: ${p.path}; ${readers}`];
  });
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
