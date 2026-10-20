# 011 wave 4 (2026-10-19)

Row 011-21, in the human's order: slice 1 now, slice 2 briefed after slice 1 lands. Leave `docs/board.md`, `docs/specifications/*/status.md`, `spec.md`, `package.json` versions and `plugins/*/dist` to the coordinator. Verify with `npm run lint`, `npm run typecheck` and `squeal run --all --wait`, and paste its output; do not run `npm run build` in your tree. `run-reads-fidelity` and `observe-fidelity` fail under the Squeal daemon on main too (001-390); name them, do not fix them.

## W1: 011-21 slice 1, an edit's node:test or pytest tier starts beside the backlog tier

Use /worker. Shape: slice. Read board row 011-21, spec 011 C4 step 5 and the lanes paragraph as amended 2026-10-19 (`status.md`), C10 and C13, and `research/streaming-lanes.md`: findings 1 ("The sweep breaks") and 4 (b), and its Recommendation.

Outcome: while a node:test or pytest backlog tier runs, an edit's tier of that lane starts at once beside it, with no permit, and each run's escaped-process sweep stops only that run's leftovers. Vitest is unchanged: its edit still cancels the backlog tier.

Seams: the lane-busy rule in `src/core/scheduler/scheduler.ts` (`#inFlight`, keyed by lane; `selectTier`'s `busy` at :557) and `selectTier` in `tiers.ts`; the per-lane mark in `EscapedChildren` (`src/core/daemon/escaped.ts`, `mark`, `afterRun`). Lead: `research/probes/streaming-lanes/prototype.patch`, its `SQUEAL_PROTO_BESIDE` path and per-run mark, without the env switch. Whether a lane may run an edit's tier beside its backlog comes from the runner (Vitest no, node:test and pytest yes), not from a lane name test. A guarded source changes: raise `KEY_FORMAT_VERSION` to 15 and pin the hash `test/keys/key-format.test.ts` prints.

Owns: those files, the node:test and pytest adapter seams the patch touches, their tests, new tests under `test/scheduler/` and `test/daemon/`. Write `tasks/011-21/notes.md`. Slots are slice 2: leave the tier shape alone.

Done when, each red on main first where it can be:
1. A node:test backlog tier of 8 files of 2 to 6 s is running and an edit reaches a quick node:test file: its result is current within its own run plus 1 s, before the backlog tier ends, and every backlog file stores.
2. With an edit's tier beside the backlog tier, a backlog file whose input the edit changed is discarded and re-queued; the others store under their keys.
3. Two runs of one node:test lane overlap through `escaped.ts`'s wrapper and the first ends: the second's processes stay alive and its files complete.
4. A Vitest edit during a Vitest backlog tier still cancels it (the existing cancel test unchanged and green).

## W2: 011-21 slice 1, review of cand/0.1.224

Use /reviewer. Shape: review. Pinned to the `cand/0.1.224` SHA named in the spawn; the range is `origin/main..<sha>`: W1's two commits, the release commit (version 0.1.224 and the bundles) and this brief.

Read W1 above, spec 011 C4 step 5 and the lanes paragraph as amended 2026-10-19 (`status.md`), C10 and C13, `research/streaming-lanes.md` (finding 4 (b), Recommendation) and `tasks/011-21/notes.md`. Check that:
- `busyLanes` frees a lane only for an edit's tier beside a lone backlog tier of a runner whose `besideBacklog` is true; never two backlog tiers, never beside an edit's tier, never for Vitest; the tier then selected is an edit's, with no permit;
- the scheduler's `#inFlight`, now keyed by run id, keeps every lane, slow-lane, idle and departure rule it had;
- a backlog file whose input the edit changed is discarded at record and re-queued, the rest stored;
- the per-run sweep mark (`escaped.ts`) stops only its own run's leftovers, the lane-wide mark is unchanged for Vitest, and the overlapping-run naming still holds;
- `besideBacklog` passes through every wrapper (composite, recovering, slow instance, sweep), and `KEY_FORMAT_VERSION` 15 is right against the released 14.

Run `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` once in the candidate tree; a file that fails loaded and passes alone is named. Write `reviews/wave-4.md` with a PASS or FAIL verdict and commit it.

## W2r: 011-21 slice 1, re-review of the repaired cand/0.1.224

Use /reviewer. Shape: review, bounded. Pinned to the `cand/0.1.224` SHA named in the spawn; the repair is `dae70064..<sha>`. Read `reviews/wave-4.md` (B1, the settled list) and append a "Re-review" section to it.

Check only that B1 is closed: `supersededIn` in `src/core/scheduler/tiers.ts` skips a file whose newer key another run holds or has already stored, at the head of `recordTier`'s per-file loop and in the scheduler's `#requeue`, so a stale run's clear, re-queue, unknown, timeout, discard and checkpoint handling never reach it; a same-key failure, crash or timeout still marks the file as before; tests 3 (the backlog tier records first) and 4 (the backlog tier crashes after the edit's PASS) in `test/scheduler/edit-beside-backlog.test.ts` are red without the repair and green with it; `KEY_FORMAT_VERSION` 15's re-pin and the bundles match the tree. The coordinator's gate on this SHA is reported in the spawn. Anything outside B1 is recorded for a later row, not a blocker.

## W3: 011-21 slice 2, one-file slots for node:test and pytest backlogs

Use /worker. Shape: slice. Read board row 011-21, spec 011 C4 step 5 and C10 as amended for slots 2026-10-19 (`status.md`), `research/streaming-lanes.md` finding 1 (slots, "Per-file overhead") and its Recommendation, `reviews/wave-4.md` (B1 and the stale-run rule, `supersededIn`), and `tasks/011-21/notes.md` (slice 1's seams and its notes for slice 2).

Outcome: a node:test or pytest lane runs its backlog as up to W slots, each starting the next queued file (pytest: the next batch) as it frees and storing that file's results when it ends; Vitest keeps tiers and the cancel.

Seams: `busyLanes` and `selectTier` in `src/core/scheduler/tiers.ts` (a slot lane holds up to W backlog tiers in flight, each of one file or one pytest batch), the scheduler's `#inFlight` (keyed by run id since slice 1), the pool lease (`take(1)` per slot), and the record path's commit (`ledger.commit`, `mergeApplied` in `ledger.ts`: the per-file record is the dear part on a large store, so slots ending while a record holds the lock are recorded together). Lead: `research/probes/streaming-lanes/prototype.patch`'s `SQUEAL_PROTO=stream` path, without the env switch. Whether a lane runs slots comes from the runner, as `besideBacklog` does. Raise `KEY_FORMAT_VERSION` to 16 and pin the printed hash.

Owns: those files, the node:test and pytest adapter seams the patch touches, their tests, new tests under `test/scheduler/`. Write `tasks/011-21/notes.md` (append). Slice 1's tests stay green unchanged.

Done when, each red on main first where it can be (the research's tests 4 to 7, then the pytest open question):
1. 16 node:test files of 1 to 5 s at W = 4 finish within 5 % of the list-scheduling makespan, no slot idle while files are queued, and checkpoint progress moves per file.
2. A departure during the backlog exits after the files in flight record; no new file starts; the rest stay queued.
3. 300 node:test files of about 50 ms run in at most 1.2 times today's single-tier time, with fewer record commits than files.
4. Another daemon's waiter gets its share within one slot's file of the holder, not one tier.
5. A pytest lane runs one batch per slot (light files packed, a heavy file alone); measure a small real pytest fixture's backlog against today's tiers and record it, with the load, in the notes.

## W4r: 011-21 slice 2, re-review of the repaired cand/0.1.225

Use /reviewer. Shape: review, bounded. Pinned to the `cand/0.1.225` SHA named in the resume; the repair is `1fb03098..<sha>`. Read `reviews/wave-4.md` (Wave 4, slice 2: S2-B1, S2-B2, S2-S1) and append a "Slice 2 re-review" section to it.

Check only that: S2-B1 is closed (`SlotRecords.record` handles each slot's outcome from its creation, so a failed record never rejects unhandled while a later slot's reads are pending; `slot-records.test.ts`'s unhandled-rejection case is red without it, and your `SQLITE_BUSY` probe exits 0); S2-B2 is closed (`RunQueue.backlogTurn` lets the fifth-tier turn take a backlog file in a lane of slots; `slots-backlog-turn.test.ts` is red without it, and your fairness probe selects a backlog file fifth); S2-S1 is closed (test 4 of `edit-beside-backlog` holds the backlog's crash behind an explicit barrier, and tests 3 and 4 fail with `supersededIn` disabled); the `KEY_FORMAT_VERSION` 16 re-pin, `test/version-sensitive.txt` and the bundles match the tree. The coordinator's gate on this SHA is reported in the resume. Anything outside the three findings is recorded for a later row, not a blocker.
