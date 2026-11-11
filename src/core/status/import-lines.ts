import { plural } from "../text.js";
import type { ImportNotCurrent, ImportStatus, StatusSnapshot } from "../types/status.js";

/*
 * Spec 018 D4, D5 and D15: what `squeal status` says about imports. `--full`
 * gives each import with a test file this worktree lists: its files and
 * results current from it, the rest by reason, and, when any is current,
 * that imported files have no coverage record. The default text adds one line
 * only when none of an import's files is current from it and the environment
 * differs for every one of them, with its first two differences; silence
 * otherwise (principle 1), also for a mix of reasons (review wave-1-2 N1).
 * D19: with `shared.ref` set, Node is said once for all imports.
 */

/** D5's reasons, in order, with the words that name each. */
const REASONS: readonly (readonly [keyof ImportNotCurrent, string])[] = [
  ["sameKeyKept", "another result kept at the same key"],
  ["sameKeyNotAdopted", "not adopted yet"],
  ["environment", "environment differs"],
  ["closure", "closure list differs"],
  ["observed", "observed set differs"],
  ["keysPending", "waiting for keys after the import"],
  ["content", "content differs"],
  ["noKey", "no local key yet"],
];

/** D15: CI runs without Squeal's coverage provider, so an imported result brings no record. */
const NO_COVERAGE = "  Imported files have no coverage record until they run here";

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
    return [
      head,
      ...(reasons.length === 0 ? [] : [`  Not current: ${reasons.join(", ")}`]),
      ...(i.currentFiles === 0 ? [] : [NO_COVERAGE]),
    ];
  });
}

/**
 * The default text's one line per import, or none (D5). With `shared.ref`
 * set, an import that differs from here only in Node has none: D19's one
 * Node line counts it (`node-mismatch.ts`).
 */
export function importDefaultLines(s: StatusSnapshot): string[] {
  return (s.imports ?? []).flatMap((i) => {
    if (i.currentFiles > 0 || i.notCurrent.environment < i.testFiles) return [];
    if (s.shared !== undefined && i.node?.only === true) return [];
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
