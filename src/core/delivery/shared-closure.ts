import { CHANGED_HERE, closureLine, closurePaths } from "./provenance.js";

/*
 * Row 005-92 (research hook-messages-2026-11-16, finding 12): one message
 * printed "its closure reads files changed here since this session started:
 * …" 12 times with the same paths. Failures whose imports hold the same
 * changed paths say them once, after the blocks; a failure with other paths
 * keeps its own line. A fact, never a cause (011 C5 as amended, gh-32).
 */

/** The changed paths a failure's imports hold, `undefined` when not known. */
type Closure = readonly string[] | undefined;

const keyOf = (paths: readonly string[]) => JSON.stringify(paths);

/**
 * What a report says of its failures' changed imports: each failure's own
 * line (`null` for one the shared line covers, or one with none known) and
 * the one line after the blocks, `null` unless two blocks or more state the
 * same paths; a group block that states them once already is one block. The
 * paths most blocks state win, the first block's on a tie. The line counts
 * failing checks, as the agent reads them.
 */
export interface SharedClosure {
  readonly own: (paths: Closure) => string | null;
  readonly line: string | null;
}

/** `blocks` holds each block's failures' paths: one for a single failure, all of a group's. */
export function sharedClosure(blocks: readonly (readonly Closure[])[]): SharedClosure {
  const counts = new Map<string, number>();
  for (const block of blocks) {
    const key = blockKey(block);
    if (key !== null) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const [shared] = [...counts].reduce<[string | null, number]>(
    (best, [key, count]) => (count >= 2 && count > best[1] ? [key, count] : best),
    [null, 0],
  );
  if (shared === null) return { own: closureLine, line: null };
  const all = blocks.flat();
  const n = all.filter((p) => p !== undefined && keyOf(p) === shared).length;
  const tests =
    n === all.length ? `the ${n} failing tests` : `${n} of the ${all.length} failing tests`;
  const paths = JSON.parse(shared) as string[];
  const line =
    paths.length === 0
      ? `None of the ${CHANGED_HERE} are imported by ${tests}`
      : `${n === all.length ? `All ${n} failing tests` : capitalizeFirst(tests)} import ${CHANGED_HERE}: ${closurePaths(paths)}`;
  return { own: (p) => (p !== undefined && keyOf(p) === shared ? null : closureLine(p)), line };
}

/** The paths every failure of a block states, `null` when one differs or none is known. */
function blockKey(block: readonly Closure[]): string | null {
  const keys = block.map((p) => (p === undefined ? null : keyOf(p)));
  return keys.every((k) => k === keys[0]) ? (keys[0] ?? null) : null;
}

const capitalizeFirst = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
