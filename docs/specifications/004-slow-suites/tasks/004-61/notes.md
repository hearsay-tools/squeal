# 004-61 notes: lane flags for a full run

## What changed

- **CLI** (`src/cli/run.ts`, new `src/cli/run-lanes.ts`):
  - `run --fast` and `run --all --fast` request a checkpoint of the fast lane only.
  - `run --slow` and `run --all --slow` are the existing slow-lane request (`runSlowCommand`, unchanged).
  - `run --fast --slow` and `run --all --fast --slow` are plain `run --all`: one full-suite checkpoint, with no lane sent (the human's rule that both flags mean both lanes).
  - The start and verdict lines of a one-lane checkpoint read `Checkpoint <id> (the fast lane only, not a full-suite checkpoint: slow test files are not in it) ...`.
  - `--wait` gives its verdict on the lane's listed files only (`laneFiles`), so a pending slow file never holds a `--fast` wait.
  - A daemon from before lanes ignores `lane` and runs both. The CLI then says `(both lanes: this daemon predates \`--fast\`)`.
- **Protocol.** `RunAllRequest.lane?` and `FullSuiteRequest.lane?` are `"fast" | "slow"`. `parseRequest` rejects any other value.
- **Scheduler.** `queueFullSuite(ledger, force, fresh, only?)` filters the listed files by `slowView(policy).isSlow`. The record carries `lane`, and joins follow the same `covers` rule over the lane's files.
- **Store.** There is no schema migration, since one would lock older Squeal versions out of the shared store. `CheckpointRecord.lane?` is kept in a per-worktree meta map, `checkpoint-lanes.<worktreeId>` (`{ id: lane }`, last 32). It is written by `CheckpointRepo.start` and read back by `get` and `lastCompleted`. The new `CheckpointRepo.lastCompletedFull` skips one-lane checkpoints. An older reader sees a one-lane checkpoint as a full one; that is the accepted downgrade.
- **Header.** `fullSuite.atCurrentRevision` and `lastCompletedRevision` come from the last full checkpoint. `FullSuiteState.lane?` names a one-lane checkpoint that completed after it, and `fullSuiteText` says so: `none completed since revision 3; only the fast lane completed, at revision 7 (the counts ...)`.
- **Pool grant order** (spec 001 D11, `src/core/capacity/{pool,share,marks}.ts`):
  - `PermitPool.acquire(want, lane?)` and `TierCapacity.take(want, lane?)` take a lane. The slow tier passes `"slow"`.
  - A daemon whose waiting acquisitions are all slow-lane writes `slow: true` in its mark.
  - A fast tier leaves free only what older fast waiters lack. A slow tier also leaves free what every fast waiter lacks.
  - `fairShares` ranks fast waiters before slow ones.
  - An older daemon's mark has no `slow` and reads as a fast lane's.

## Decisions the spec did not settle (defaults the coordinator accepted on 2026-10-15)

1. **The slow lane stays a request, not a checkpoint.** The board says a bare `run --slow` stays shorthand for `run --all --slow`, so both route to the existing request, which already queues no fast file. Making the slow lane a checkpoint has two costs:
   - `checkpoints.start` abandons the open one (a baseline).
   - An older daemon would read `run-all` with `lane: "slow"` as both lanes and run everything.

   So only `--fast` produces a lane checkpoint and lane text. The scheduler accepts `lane: "slow"`, and a test covers that it queues no fast file, but no CLI path sends it.
2. **"Under host pressure" is pool scarcity: a contended pool serves fast lanes first** (D11 wording, accepted by the coordinator on 2026-10-15). PSI-driven shrinking (001-379) is still planned, and within one daemon the slow tier already waits for its own fast backlog (004-60). The place where fast and slow tiers compete is the per-user pool across daemons, so "fast first" lives in its reservation and seniority order. When 001-379 lands, its shrink applies on top.
3. **A `--fast` checkpoint abandons an open baseline** it does not join, as `run --all` does today. The baseline's slow files stay queued and run as the slow tier's triggers allow, but no full suite completes until the next `run --all`.

## Tests

- `test/scheduler/run-lanes.test.ts` (real Vitest): `--fast` queues and runs no slow file, records `lane`, and is not `lastCompletedFull`. The header names the lane. `--slow` queues no fast file. `--all` takes every file and is the full suite.
- `test/cli/run-lanes.test.ts` (stand-in daemon): the request carries `lane: "fast"`, and the verdict ignores a pending slow file. The start line names the lane. An old daemon's answer is named. `--fast --slow` and `--all` send no lane, and `--all --slow` sends `run-slow`. `test/cli/fake-daemon.ts` now keeps request bodies (`received`).
- `test/capacity/pool.test.ts`: a younger fast waiter gets the freed permits before an older slow one, whichever reaches its boundary first. It fails without the change: the slow waiter takes both.

## For the next worker

- `src/cli/run.ts` was already over 300 lines (≈345). The lane logic sits in `run-lanes.ts`.
- `status`'s "Checkpoint in progress" line does not name a lane yet (`CheckpointProgress` has no lane). It is a small follow-up if wanted.
