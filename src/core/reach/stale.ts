import { testFileId } from "../keys/reverse-index.js";
import { type ImportGraph, newestStoredWalk, type TestWalk } from "../store/import-graph.js";
import type { EpochMs, RelativePath } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { Store } from "../types/store.js";
import type { StaleFallback } from "./types.js";

/*
 * Spec 015 D11 as amended 2026-11-22 (row 015-128): `squeal impact`'s
 * stale-key fallback. A worktree whose test files have no closure or walk
 * at its current keys (Squeal's own main checkout, once its keys moved)
 * read empty lists before. In `squeal impact` only, such a test file takes
 * its newest stored closure (`test_files`) and its newest stored walk, and
 * the report names every one. `closureFor` and `readImportGraph` stay
 * strict for scheduling, keys and validity.
 */

export interface StaleReader {
  /** The strict graph, each missing walk filled with the newest stored one; `null` without a strict graph. */
  readonly graph: ImportGraph | null;
  /**
   * The newest stored closure of a test file with none at its current key:
   * the `test_files` row, else the paths of its newest stored walk (`paths`
   * builds them); `null` with neither.
   */
  closure(
    ref: TestFileRef,
    paths: (walk: TestWalk) => readonly RelativePath[],
  ): readonly RelativePath[] | null;
  /** What fell back so far; `null` when nothing did. */
  summary(): StaleFallback | null;
}

export function staleReader(store: Store, strict: ImportGraph | null): StaleReader {
  const newest = newestStoredWalk(store);
  const walks = new Map<string, TestWalk | undefined>();
  const walkTimes = new Map<string, EpochMs>();
  const closureTimes = new Map<string, EpochMs>();
  const staleWalk = (ref: TestFileRef) => {
    const id = testFileId(ref);
    if (!walks.has(id)) {
      const found = newest(ref);
      if (found !== undefined) walkTimes.set(id, found.recordedAt);
      walks.set(id, found);
    }
    return walks.get(id);
  };
  const graph: ImportGraph | null =
    strict === null ? null : { walk: (ref) => strict.walk(ref) ?? staleWalk(ref) };
  return {
    graph,
    closure(ref, paths) {
      const record = store.testFiles.get(ref);
      if (record !== null) {
        closureTimes.set(testFileId(ref), record.updatedAt);
        return record.closure.paths;
      }
      const walk = strict === null ? undefined : staleWalk(ref);
      if (walk === undefined) return null;
      closureTimes.set(testFileId(ref), walkTimes.get(testFileId(ref)) as EpochMs);
      return paths(walk);
    },
    summary() {
      const times = [...walkTimes.values(), ...closureTimes.values()];
      if (times.length === 0) return null;
      return {
        closures: closureTimes.size,
        walks: walkTimes.size,
        oldestAt: Math.min(...times),
        newestAt: Math.max(...times),
      };
    },
  };
}
