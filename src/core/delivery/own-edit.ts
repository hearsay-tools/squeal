import type { Consumer, KnownState, RelativePath, RevisionNumber, Store } from "../types/index.js";
import { changedAfter, registration } from "./registered.js";

/*
 * Task 001-220, decided by the human: a PASS -> UNKNOWN whose only cause is
 * the consumer's own edit landing during the file's run is not news. The
 * Vitest adapter's source stamps (task 001-146) name the files that moved;
 * the file is queued again at the key the edit gave it, so its next result
 * is delivered against the PASS the consumer was told.
 */

/**
 * The whole reason of such an unknown: the adapter's line (`withoutFiles` in
 * `src/runners/vitest/moved.ts`), prefixed by the runner's name when the
 * composite runner reports it. Another line or another runner's failure
 * beside it is another cause.
 */
const MOVED_ONLY =
  /^(?:[\w-]+: )?vitest adapter: (.+) changed on disk after this run loaded it; the run may have executed bytes no check key names \(task 001-146\)$/;

/** The paths the reason names, or `null` when it is not only the 001-146 line. */
export function movedPaths(reason: string): readonly string[] | null {
  const match = MOVED_ONLY.exec(reason);
  return match?.[1] === undefined ? null : match[1].split(", ");
}

/**
 * Whether an unknown `state` is pending again and its reason names only
 * files the consumer changed since it registered. The consumer's changes are
 * read once, on the first unknown asked about.
 */
export function ownEditUnknown(
  store: Store,
  consumer: Consumer,
  revision: RevisionNumber,
): (state: KnownState) => boolean {
  let changed: ReadonlySet<RelativePath> | undefined;
  const changes = () => {
    if (changed !== undefined) return changed;
    const from = registration(store, consumer);
    changed =
      from === null ? new Set() : changedAfter(store, consumer.worktreeId, from, revision).changed;
    return changed;
  };
  return (state) => {
    if (state.outcome !== "unknown" || state.validity !== "pending" || state.summary === null) {
      return false;
    }
    const paths = movedPaths(state.summary);
    return paths?.every((p) => changes().has(p)) === true;
  };
}
