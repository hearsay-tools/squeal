import { plural } from "../text.js";
import type {
  ImportNode,
  ImportNotCurrent,
  ImportStatus,
  StatusSnapshot,
} from "../types/status.js";

/*
 * Spec 018 D4, D5 and D15: what `squeal status` says about imports. `--full`
 * gives each import with a test file this worktree lists: its files and
 * results current from it, the rest by reason, and, when any is current,
 * that imported files have no coverage record. The default text says one
 * line about the newest import only (row 018-32). Only the environment
 * differences that keep an imported pass apart are named (D10). D19: with
 * `shared.ref` set, Node is said once for all imports.
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

/**
 * Row 018-32: files whose environment differs only in fields D10 accepts
 * for an imported pass; the import stored them at the export's keys, since
 * it could not re-key them (D11), or it predates the re-key.
 */
const ONLY_ACCEPTED =
  " (only in fields an imported pass may differ in, but the import kept the export's keys)";

/** Differences the default line names before it counts the rest. */
const DEFAULT_SHOWN = 2;

/** `--full`'s lines: per import, the head and, when any file is not current, its reasons. */
export function importLines(s: StatusSnapshot): string[] {
  return (s.imports ?? []).flatMap((i) => {
    const head = `Imported: ${i.currentFiles} of ${plural(i.testFiles, "test file")} current from ${i.source} (${plural(i.currentResults, "current result")})`;
    const reasons = REASONS.flatMap(([reason, words]) => {
      const n = i.notCurrent[reason];
      if (n === 0) return [];
      const named = reason === "environment" ? environmentText(i) : "";
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
 * The default text's line about imports, or none (D5 as amended by row
 * 018-32). It names the newest import with a test file here, newest by
 * import time (`readImports`' order), never an older one, and how many of
 * its files match this worktree: the files whose key here equals the
 * import's, current from it, another result kept there, or not adopted yet.
 * Silent when every file matches (D15). It counts the files whose
 * environment differs and names the differences that keep an imported pass
 * apart, so a mix of reasons is not read as the environment's alone (review
 * wave-1-2 N1). With `shared.ref` set, D19's line says Node
 * (`node-mismatch.ts`): an import that differs from here only in Node gets
 * no line, another names no Node.
 */
export function importDefaultLines(s: StatusSnapshot): string[] {
  const i = s.imports?.[0];
  if (i === undefined) return [];
  const { sameKeyKept, sameKeyNotAdopted } = i.notCurrent;
  const matching = i.currentFiles + sameKeyKept + sameKeyNotAdopted;
  if (matching === i.testFiles) return [];
  const node = s.shared?.node === undefined ? undefined : i.node;
  if (node?.only === true) return [];
  const named = i.environmentDifferences.filter((d) => node === undefined || !isNode(d, node));
  const verb = matching === 1 ? "matches" : "match";
  const environment =
    named.length === 0
      ? ""
      : `; the environment differs for ${i.notCurrent.environment}${listed(named)}`;
  return [
    `Imported results from ${i.source}: ${matching} of ${plural(i.testFiles, "test file")} ${verb} this worktree${environment}`,
  ];
}

/** `--full`'s text after "environment differs": every difference named, or why none is. */
function environmentText(i: ImportStatus): string {
  const named = i.environmentDifferences;
  return named.length === 0 ? ONLY_ACCEPTED : ` (${named.join("; ")})`;
}

/** ` (a; b)` with at most `DEFAULT_SHOWN` differences and how many more. */
function listed(named: readonly string[]): string {
  const more = named.length - DEFAULT_SHOWN;
  const shown = named.slice(0, DEFAULT_SHOWN).join("; ");
  return ` (${shown}${more > 0 ? `; ${more} more in squeal status --full` : ""})`;
}

/** Whether `difference` is the Node difference D19's line names (`describeDifferences`' text). */
function isNode(difference: string, node: ImportNode): boolean {
  const text = `Node ${node.exported} in the export, ${node.here} here`;
  return difference === text || difference.endsWith(`: ${text}`);
}
