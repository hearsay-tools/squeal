import { setTimeout as sleep } from "node:timers/promises";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { answerMoves } from "../../src/core/scheduler/rekeyed-moves.js";
import {
  daemonIncarnation,
  type RekeyedTestFile,
  type RevisionNumber,
  type Store,
} from "../../src/core/types/index.js";

/*
 * What `status --wait` needs of a daemon since task 001-258: the revision
 * its reconciliation pass captured, and that it records the re-key moves
 * the wait reads from the store, as the incarnation it registered (task
 * 001-268). The scheduler, store and sink stay real.
 */

/** The daemon a harness's scheduler runs in: its commits name it the writer of the moves. */
export const HARNESS_DAEMON = { startedAt: 1_000, squealVersion: "0.0.0-test", token: "harness" };
export const HARNESS_INCARNATION = daemonIncarnation(HARNESS_DAEMON);

/**
 * A `sync` that captures `captured()` when the wait asks, in the callback of
 * the wait's first read, as the daemon's pass answers it after the start;
 * then runs `meanwhile`, the test's stimulus, before it answers.
 */
export function captureSync(
  captured: () => RevisionNumber,
  meanwhile: (upTo: RevisionNumber) => Promise<void> = async () => {},
) {
  return (): DaemonSync => {
    const revision = captured();
    let state: SyncState = { state: "pending" };
    void meanwhile(revision).then(() => {
      state = { state: "synced", revision, incarnation: HARNESS_INCARNATION };
    });
    return { current: () => state, stop: () => {} };
  };
}

/** The harness's daemon, live: without one a wait never reports quiet (D7), nor trusts the moves. */
export function liveDaemon(store: Store, worktreeId: string, root: string, commonDir: string) {
  store.worktrees.upsert({
    id: worktreeId,
    root,
    commonDir,
    isMain: true,
    registeredAt: Date.now(),
    daemon: {
      ...HARNESS_DAEMON,
      socketPath: "/tmp/squeal-test.sock",
      heartbeatAt: Date.now(),
      heartbeatIntervalMs: 600_000,
    },
  });
}

/**
 * The moves a wait that captured `upTo` reads (`answerMoves`), once the
 * store's refined revision reached it: those at revisions after `after`,
 * and those resolved after `sinceSeq`; by default none resolved.
 */
export async function movesOnceRefined(
  h: { readonly store: Store; readonly worktreeId: string },
  upTo: RevisionNumber,
  { after = 0, sinceSeq = Number.MAX_SAFE_INTEGER }: { after?: number; sinceSeq?: number } = {},
): Promise<RekeyedTestFile[]> {
  const deadline = performance.now() + 60_000;
  for (;;) {
    const answer = h.store.transaction(() =>
      answerMoves(h.store, h.worktreeId, upTo, sinceSeq, HARNESS_INCARNATION),
    );
    if (answer.state === "answered") return answer.rekeyed.filter((file) => file.revision > after);
    if (answer.state === "incomplete") throw new Error("the moves cannot answer");
    if (performance.now() > deadline) throw new Error(`revision ${upTo} was never refined`);
    await sleep(20);
  }
}
