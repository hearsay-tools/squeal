import type { GateFailedTests, GateFunctionReport } from "../core/code/gate/report.js";
import { functionName } from "../core/delivery/code-format.js";
import { plural } from "../core/text.js";

/*
 * Row 020-53 (#210): the text of a `test-failed` function whose loaders
 * hold no failed file. D5.5 still blocks every function on one selected
 * failure; the text says that failure is outside the function's loaders,
 * and folds the functions with the same failed tests into one line, so one
 * unrelated failure does not print a line per changed function. A function
 * one of whose own loaders failed reads as before.
 */

/** The failed tests behind `f`'s gap when it names some and none is in one of its loaders. */
function outsideOf(f: GateFunctionReport): readonly GateFailedTests[] | null {
  const failed = f.failedTests ?? [];
  if (f.gap !== "test-failed" || failed.length === 0) return null;
  return failed.some((t) => t.loader) ? null : failed;
}

/** The first failed test as `<file> › <test>`, and how many more failed: bounded. */
function causeText(failed: readonly GateFailedTests[]): string {
  const first = failed[0];
  const named = first === undefined ? "" : `${first.path} › ${first.tests[0] ?? ""}`;
  const more = failed.reduce((sum, t) => sum + t.tests.length, 0) - 1;
  return more > 0 ? `${named} and ${plural(more, "more failed test")}` : named;
}

/** `f`'s gap words when its failure is outside its loaders; `null` keeps the gap's own words. */
export function outsideWords(f: GateFunctionReport): string | null {
  const failed = outsideOf(f);
  return failed === null
    ? null
    : `a selected test failed outside its loaders: ${causeText(failed)}`;
}

/** The same set of failed tests: the same files with the same tests. */
const causeKey = (failed: readonly GateFailedTests[]) =>
  JSON.stringify(failed.map((t) => [t.path, t.tests]));

/** One line for the functions of `group`, two or more, with the same failure outside their loaders. */
function foldedLine(group: readonly GateFunctionReport[]): string {
  const [first] = group;
  if (first === undefined) return "";
  const where = `${first.path}:${first.line} ${functionName({ kind: "code", ...first })}`;
  const cause = causeText(outsideOf(first) ?? []);
  return `  ${plural(group.length, "changed function")}: incomplete: a selected test failed outside their loaders: ${cause} (first: ${where}; --json lists them all)`;
}

/**
 * The functions the text lists one per line, in their order, and one line
 * for each set of failed tests that two or more of the others share outside
 * their loaders, in the order of each set's first function.
 */
export function foldOutside(functions: readonly GateFunctionReport[]): {
  readonly listed: readonly GateFunctionReport[];
  readonly folded: readonly string[];
} {
  const groups = new Map<string, GateFunctionReport[]>();
  for (const f of functions) {
    const failed = outsideOf(f);
    if (failed === null) continue;
    const key = causeKey(failed);
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const shared = [...groups.values()].filter((group) => group.length > 1);
  const folded = new Set(shared.flat());
  return { listed: functions.filter((f) => !folded.has(f)), folded: shared.map(foldedLine) };
}
