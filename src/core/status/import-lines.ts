import { plural } from "../text.js";
import type { ImportNotCurrent, ImportStatus, StatusSnapshot } from "../types/status.js";

/*
 * Spec 018 D4 and D5: what `squeal status` says about imports. `--full` gives
 * each import with a test file this worktree lists: its current files and
 * results, and the rest by reason. The default text adds one line only when
 * an import's results are all not current because the environment differs,
 * with its first two differences; silence otherwise (principle 1).
 */

/** D5's reasons, in order, with the words that name each. */
const REASONS: readonly (readonly [keyof ImportNotCurrent, string])[] = [
  ["environment", "environment differs"],
  ["closure", "closure list differs"],
  ["observed", "observed set differs"],
  ["content", "content differs"],
  ["noKey", "no local key yet"],
];

/** Differences the default line names before it counts the rest. */
const DEFAULT_SHOWN = 2;

/** `--full`'s lines: per import, the head and, when any file is not current, its reasons. */
export function importLines(s: StatusSnapshot): string[] {
  return (s.imports ?? []).flatMap((i) => {
    const head = `Imported: ${i.currentFiles} of ${plural(i.testFiles, "test file")} current from ${i.source} (${plural(i.currentResults, "current result")})`;
    const reasons = REASONS.flatMap(([reason, words]) => {
      const n = i.notCurrent[reason];
      if (n === 0) return [];
      const named = reason === "environment" ? environmentText(i, Infinity) : "";
      return [`${n} ${words}${named}`];
    });
    return reasons.length === 0 ? [head] : [head, `  Not current: ${reasons.join(", ")}`];
  });
}

/** The default text's one line, or none (D5). */
export function importDefaultLines(s: StatusSnapshot): string[] {
  return (s.imports ?? []).flatMap((i) => {
    if (i.currentFiles > 0 || i.notCurrent.environment === 0) return [];
    return [
      `Imported results from ${i.source}: none current here, the environment differs${environmentText(i, DEFAULT_SHOWN)}`,
    ];
  });
}

/** ` (a; b)` with at most `shown` differences and how many more; empty when none is named. */
function environmentText(i: ImportStatus, shown: number): string {
  const named = i.environmentDifferences;
  if (named.length === 0) return "";
  const more = named.length - shown;
  const listed = named.slice(0, shown).join("; ");
  return ` (${listed}${more > 0 ? `; ${more} more in squeal status --full` : ""})`;
}
