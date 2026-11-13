import type { ProjectName, WorktreeId } from "../types/common.js";
import { type Store, worktreeMetaKey } from "../types/store.js";
import type { NowRequest, Request } from "./request-intake-types.js";

/*
 * Review of 0.1.428, B1 (row 018-28, spec 018 D5): an import into a running
 * daemon's store adds observed entries that its keys take only at the next
 * refinement's apply (`ImportsSeen`, `Scheduler.requestImports`). Until
 * then each of the import's files holds its old key, and status, which reads
 * the store alone, would call it "content differs". The daemon names the
 * imports its keys have not taken in a row of the worktree's: the retry
 * request that hands it an import adds it, the refinement whose apply takes
 * its observed entries removes it, and a start, which keys every import the
 * store holds, empties the row.
 */

/** The `meta` key of `worktreeId`'s row. */
export function importsWaitingMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("importsWaiting", worktreeId);
}

/** The imports whose observed entries `worktreeId`'s keys have not taken yet. */
export function importsWaiting(store: Store, worktreeId: WorktreeId): string[] {
  const value = store.meta.get(importsWaitingMetaKey(worktreeId));
  if (value === null) return [];
  try {
    const ids: unknown = JSON.parse(value);
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Adds `imports` to the imports the keys wait for. */
export function markImportsWaiting(
  store: Store,
  worktreeId: WorktreeId,
  imports: readonly string[],
): void {
  if (imports.length === 0) return;
  store.transaction(() => {
    const ids = new Set([...importsWaiting(store, worktreeId), ...imports]);
    store.meta.set(importsWaitingMetaKey(worktreeId), JSON.stringify([...ids].sort()));
  });
}

/** Removes `imports`, whose observed entries the keys took; the row goes when none is left. */
export function importsKeyed(
  store: Store,
  worktreeId: WorktreeId,
  imports: readonly string[],
): void {
  if (imports.length === 0) return;
  store.transaction(() => {
    const taken = new Set(imports);
    const left = importsWaiting(store, worktreeId).filter((id) => !taken.has(id));
    if (left.length === 0) store.meta.delete(importsWaitingMetaKey(worktreeId));
    else store.meta.set(importsWaitingMetaKey(worktreeId), JSON.stringify(left));
  });
}

/** A start keys every import the store holds: the keys wait for none. */
export function clearImportsWaiting(store: Store, worktreeId: WorktreeId): void {
  store.meta.delete(importsWaitingMetaKey(worktreeId));
}

/**
 * Row 018-28 as the request intake takes it (rows 011-322, 011-323): an
 * import's observed reads. `projects`, whose observed entries the import
 * added, are read again first, so the files whose set grew wait for the
 * refinement's regrow, as another worktree's do; until that regrow is
 * applied, status names the `imports` it waits for (review of 0.1.428, B1).
 * `queueObserved` queues that runner work. The mark is written in the
 * stage's transaction, tried again while the store is busy (spec 021 D2;
 * `research/request-intake.md`, difference 1). `false`: closed, not
 * started, or waiting for an install.
 */
export function importRequest(
  projects: readonly ProjectName[],
  imports: readonly string[],
  queueObserved: () => void,
): Request<boolean> {
  return {
    operation: "taking the observed reads of an import",
    start: { closed: false },
    installWait: { atOnce: false },
    runnerWork: { skip: "waits for no runner work: it queues its own (`queueObserved`)" },
    store: {
      stage: (context) => {
        if (projects.length > 0) context.keys.refreshObserved(projects);
        markImportsWaiting(context.store, context.worktreeId, imports);
        queueObserved();
        // No covered file: the refinement's regrow re-keys the files it reaches, and runs none.
        return { answer: true, covered: [] };
      },
      // Row 011-325, at the integration with row 011-323.
      record: {
        skip: "an import's answer is a boolean and carries no id, so no wait reads a record of its files",
      },
    },
    wake: { skip: "wakes no lane: the pump applies its runner work first" },
  };
}

/**
 * Task 003-26 as the request intake takes it: the daemon lifecycle's
 * refresh once another worktree grew the shared observed paths. It queues
 * the refinement's regrow (`queueObserved`) and writes no store. `false`:
 * closed, not started, or waiting for an install; the lifecycle asks again.
 */
export function observedRequest(queueObserved: () => void): NowRequest<boolean> {
  return {
    operation: "refreshing the observed reads",
    start: { closed: false },
    installWait: { atOnce: false },
    runnerWork: { skip: "waits for no runner work: it queues its own (`queueObserved`)" },
    store: {
      skip:
        "writes no store, so it needs no lock nor busy retry; synchronous: the daemon's " +
        "lifecycle reads its answer at once (daemon.ts:416)",
      covers: { skip: "covers no file: the refinement's regrow re-keys the files it reaches" },
      now: () => {
        queueObserved();
        return true;
      },
    },
    wake: { skip: "wakes no lane: the pump applies its runner work first" },
  };
}
