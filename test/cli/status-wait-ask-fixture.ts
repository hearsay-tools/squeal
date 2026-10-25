import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { type AskNamed, askNamedRuns } from "../../src/cli/status-wait-ask.js";
import type { NamedWaitOptions } from "../../src/cli/status-wait-paths.js";
import { endRetries } from "../../src/core/retry/index.js";
import type {
  CheckKey,
  PendingPhase,
  RevisionNumber,
  Store,
  TestFileRef,
} from "../../src/core/types/index.js";
import { check, state } from "../status/helpers.js";
import { result } from "../store/helpers.js";
import { A, ADDS, NOW, ref } from "./status-wait-fixture.js";

/*
 * Row 011-207: test file A stale at its key with nothing queued, the
 * daemon's steps after a named wait's ask, and the wait's options.
 */

export const KEY = "key-a-now" as CheckKey;
export const HOLDS = check(A, "holds");

/** A's row at `KEY`, as the daemon writes it. */
export function row(store: Store, worktreeId: string, pending: PendingPhase | null) {
  store.testFileKeys.upsertMany([
    { worktreeId, testFile: ref(A), key: KEY, revision: 4 as RevisionNumber, pending },
  ]);
}

/** An inherited pass made stale: another worktree's pass at A's old key, nothing queued here. */
export function inheritedStale(store: Store, worktreeId: string) {
  row(store, worktreeId, null);
  store.knownStates.upsertMany(
    [ADDS, HOLDS].map((c) => state(worktreeId, c, { validity: "stale", observedAt: 3 })),
  );
  store.results.putMany([result(HOLDS, "key-a-old", { worktreeId: "wt-other" })]);
}

/** The daemon took the request: A queued at its key. */
export function take(store: Store, worktreeId: string) {
  row(store, worktreeId, "queued");
  store.knownStates.upsertMany(
    [ADDS, HOLDS].map((c) =>
      state(worktreeId, c, { validity: "pending", pendingPhase: "queued", observedAt: 3 }),
    ),
  );
}

/** Its run passed at the key and ended the request. */
export function pass(store: Store, worktreeId: string) {
  row(store, worktreeId, null);
  store.knownStates.upsertMany([ADDS, HOLDS].map((c) => state(worktreeId, c, { observedAt: 4 })));
  endRetries(store, ref(A), KEY, { outcome: "passed", at: NOW, worktreeId: worktreeId as never });
}

const synced = (): SyncState => ({
  state: "synced",
  revision: 4 as RevisionNumber,
  incarnation: null,
});

/**
 * A daemon that does `steps` 30 ms apart once the wait's ask is stored, and
 * the promotions it got; `before` runs between the wait's read and its write.
 */
export function daemon(steps: readonly (() => void)[], timeoutMs = 3_000, before?: () => void) {
  const asks: (readonly TestFileRef[])[] = [];
  const promoted: (readonly TestFileRef[])[] = [];
  const ask: AskNamed = async (root, files, asker, withinMs, now) => {
    asks.push(files.map((f) => f.testFile));
    before?.();
    const runs = await askNamedRuns(root, files, asker, withinMs, now);
    for (const [i, step] of steps.entries()) setTimeout(step, 30 * (i + 1));
    return runs;
  };
  const options: NamedWaitOptions = {
    timeoutMs,
    pollMs: 10,
    settleMs: 100,
    now: () => NOW,
    sync: (): DaemonSync => ({ current: synced, stop: () => {} }),
    promote: (_root, files) => promoted.push(files),
    ask,
    asker: "s1",
  };
  return { options, asks, promoted };
}
