# Wave 17 (2026-10-16)

One row, reported as hearsay-tools/squeal#1 (its first acceptance criterion): a busy shared store still costs an edit its pass and freezes the daemon. Leave `docs/board.md`, `docs/specifications/*/status.md`, `spec.md`, key pins, `package.json` versions and `plugins/*/dist` to the coordinator. Verify with `npm run lint`, `npm run typecheck` and `squeal run --all --wait`, and paste its output. Do not run `npm run build` in your tree.

## W1: 001-422, a busy store delays an edit by the hold, not by the next pass

Use /worker. Shape: slice. Read the board row, `tasks/001-412/notes.md` ("What the daemon did next", "What remains"), issue #1 (`gh issue view 1`), and spec 001 D8, D10 and D12.

Outcome: while another connection holds the store's write lock, the daemon's event loop is never held by one busy wait for more than about 250 ms, and every write it gave up on runs within a second of the lock freeing.

Contract:
- A batch whose `handleBatch` throws `isBusy` is retried as a pass at once, then with backoff capped so a freed lock is taken within 1 s; its attempts wait in short slices, not 5 s.
- Heartbeat, harness, leaving and consumer-expiry writes (`lifecycle.ts`) wait a short slice and are retried soon, coalesced, never stacked.
- A busy error in the scheduler's pump is not a stall left for the next batch: the pump resumes after the same backoff.
- One note per busy episode, after it ends: how long, and what waited (a revision, a tier's files queued again). No bare `daemon error: database is locked`.
- Every other write (desk, tier records) keeps its 5 s wait.

Seams: `enqueue` in `src/core/watcher/change-feed.ts`, `createDaemonLoop` in `src/core/daemon-loop/index.ts`, `attempt` and `heartbeat` in `src/core/daemon/lifecycle.ts`, `#stall` in `src/core/scheduler/scheduler.ts`. Lead: a per-transaction busy timeout in `src/core/store/connection.ts`, set and restored inside one synchronous write, so no other write's wait changes.

Owns: those files, `daemon.ts`'s `onError` wiring, and new tests. Write `tasks/001-422/notes.md`. Naming who held the lock is out of scope.

Done when:
- A real-daemon test beside a 12 s writer (`test/daemon/long-writer.ts`): an edit made during the hold has its revision stored within 1 s of the lock freeing, a heartbeat lands within 1 s, the socket answers a ping within 1 s throughout, and one note names the wait.
- A scheduler-level test: a busy error during a tier's record resumes the pump once the lock frees, with no new batch.

## W2: 001-432, review of cand/0.1.201

Use /reviewer. Shape: review. Pinned to the `cand/0.1.201` SHA named in the spawn; the range is `8737cdc0..<sha>`: W1's commits, the bundles and version 0.1.201.

Read W1 above, issue #1, spec 001 D8, D10 and D12, and `tasks/001-422/notes.md`. Check that:
- no write outside the pass and the timers changes its busy wait, and a slice override cannot leak to another statement;
- a retried pass loses no edit and stores no revision twice, and a close during a backoff ends it;
- a busy episode notes once, and a non-busy error still notes as before;
- the pump resumes after a busy error without spinning, and a non-busy stall still waits for the next batch;
- each test fails on `8737cdc0`.

Write `reviews/wave-17.md`; commit it.

## W3: 001-434, re-review of cand/0.1.203 after the B1 repair

Use /reviewer. Shape: review, narrow. Pinned to the `cand/0.1.203` SHA named in the spawn. Round 2 of `reviews/wave-17.md`: B1 only, plus the rebase.

The candidate is 001-422's four commits, the coordinator's B1 repair (`fix(001-432): a busy resume runs only for the stall it was armed for`) and the build (0.1.203 above main's 0.1.202, key format 11 re-pinned in place). Round 1 covered the rest at `f9c29e11`.

Check that:
- the round-1 probe passes, and both orderings in `test/scheduler/busy-record.test.ts` fail without the repair;
- a busy resume restarts only a pump a busy store stopped, and a later busy episode still resumes;
- another error abandons the busy wait, so the episode's note never claims that the pump's write ran;
- two lanes, one busy and one landing, still resume the pump;
- the version, key pin and bundles match a build of the tree.

Write round 2 into `reviews/wave-17.md`; commit it.
