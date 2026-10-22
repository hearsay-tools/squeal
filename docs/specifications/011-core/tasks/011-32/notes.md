# 011-32 notes (W1 of wave 12, 2026-10-22)

One successor per handoff: 011 C9 as amended 2026-10-20, design `tasks/011-30/design.md` section 2 and R2. Base main at db1b15068 (0.1.256). Brief `tasks/wave-12.md`, W1.

## What changed

- `src/core/delivery/handoff.ts` (new): the claim `{ from, to, at, boundAt }` in the `meta` row `daemon-handoff:<worktree>` (`WORKTREE_META_ROWS.daemonHandoff`). `claimHandoff` reads and writes in one transaction and returns `null` when a live claim for the same incarnation is already there. `liveHandoff` is the boundary's read. `clearHandoff` ends it. `handoffFrom` is the old daemon's incarnation, or `version@startedAt` for a record with no start token (before 001-270). `SUCCESSOR_LOCK_WAIT_MS` moved here from `src/harness/shared/ensure.ts`, because the bound is computed from it (`HANDOFF_BOUND_MS`, 130 s) and `src/core` cannot import the harness.
- `src/harness/shared/ensure.ts`: `handOver` replaces `stepDown`. It returns `none`, `joined` or `claimed`. `ensure` spawns the successor only on `claimed` and returns `alive` on `joined` (the old daemon still answers). `ensureIfStale` spawns only on `claimed`. `stepDownIfOlder` is now its eligibility check (`asksStepDown`) plus its requests (`requestStepDown`), and it behaves as before.
- `src/core/daemon/daemon.ts`, `#register`: deletes the claim in the registering transaction.
- `src/core/daemon/open.ts`, `lockWaitTimedOut`: a successor's wait (`--await-lock`, including the case where it took the lock and could not read the last daemon) deletes the claim in the same transaction as its note. If that transaction cannot start, the note is written alone, as before.

## Decisions the spec did not settle

- **A boundary that finds a live claim returns `alive`.** The old daemon still answers its socket, and a successor waits. Row 011-34's stopping reading then tells the session that a handoff is running.
- **A vacant-lock waiter's timeout keeps the claim.** That waiter (no `--await-lock`) is not the claimed successor, and C9 ends the claim only on "that successor's lock wait". Pinned by `test/daemon/handoff-claim.test.ts`.
- **A successor of a claim that was never written** (the busy-store fallback) clears whatever claim is there when its wait times out. The next boundary then spawns one more successor. Accepted: it needs a busy store and a timed-out wait together.
- **The claim read is not guarded against a throw.** As with `heldStop`'s read, a store that fails a plain `meta` read fails the hook. Only the claim's write is wrapped, because C9 names the busy write as the fallback.

## Measurements

- The claim's cost on the hook's side (design 011-30, "What is not known"): 200 reads and claims on a store with 2,000 note rows, at a one-minute load of 29 on 24 CPUs. Read: median 0.011 ms, p95 0.018 ms. Claim (one `BEGIN IMMEDIATE` read and write): median 0.045 ms, p95 0.073 ms, max 0.2 ms. The store was in `/tmp`, uncontended. This is far within the 2 s hook budget. A store held busy costs up to the hook's busy timeout (`STATUS_BUSY_TIMEOUT_MS`, 1 s), and then the hook spawns as before.

## Tests

| Test | What it checks | Red on base |
| --- | --- | --- |
| `test/harness/handoff.test.ts`, "six boundaries ... spawn once" | Three concurrent SessionStarts, then PostToolBatch, SessionStart and PostToolBatch, against a stand-in that accepts every step-down: one `awaitLockMs` spawn, three step-downs (the concurrent three ask before any claim exists), a claim from `0.1.0@1#t` to the hook's version. | Yes: six spawns. |
| same file, "claims with ... a 130 s bound" | The claim's four fields. | Yes: no claim. |
| same, "past the claim's bound" | One ms before the bound a boundary asks nothing; at the bound it asks and spawns. | Yes. |
| same, "after the successor's lock wait ended the claim" | A cleared claim, as `lockWaitTimedOut` leaves it, lets the next boundary spawn at once. | No, by design: base always spawns. |
| same, "another incarnation" | A claim for an earlier incarnation does not stop a step-down of the current one. | No, by design. |
| same, "a store too busy" | With a write transaction held on another connection and a 50 ms busy timeout, two boundaries each spawn, and no claim is left. | No, by design: it pins the fallback. |
| same, "finds a live claim" | `ensure` returns `alive`, asks nothing and spawns nothing. | Yes. |
| `test/daemon/handoff-claim.test.ts` | A registering daemon deletes the claim; a successor's timed-out wait deletes it with its note; a vacant waiter's timed-out wait keeps it. | Yes for the first two. |
| `test/daemon/handover.test.ts`, "six SessionStart hooks ... one --await-lock process" | Real daemons: a `buildAt("0.1.0")` daemon, three concurrent hooks, then three hooks one second apart. One `awaitLockMs` spawn, and one `--await-lock` pid seen in `ps` from the first hook until the successor serves. | Yes: `[120000, 120000, 120000]`. |

## For the next row

- 011-34 reads the claim with `readHandoff` and its bound from `boundAt`. Without a claim, the 130 s bound is `HANDOFF_BOUND_MS` from the shutdown's start.
- `squeal start` takes part in the handoff through `claimHandoff`, as a hook does.
