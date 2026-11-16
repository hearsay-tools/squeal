# Row 011-375: a SIGKILLed daemon's claim on the day's full check

Wave 111 W2, shape slice. Base main d5f73b118.

## Mechanism

The claim now names its holder process while its check runs.

- `claimFullCheck` writes two `meta` rows in one write transaction: `store.full-check` (the start, epoch ms, as before) and a new row `store.full-check.holder` = JSON `{ at, process }`. `process` is a `LeaseProcess` (pid, `/proc` start time, PID namespace), the same holder record the worktree write lease uses (review 0.1.442 B3, `src/core/daemon/lease-process.ts`).
- A daemon takes a claim over before the 24 h end only when all three hold: the holder row parses, its `at` equals the start row, and `leaseProcessAlive(process)` is `false` (the pid is gone, reused with another start time, or a zombie). A taken-over claim has `before = null`, so a takeover that is given back deletes the start row.
- A check that answered (ok, or a fault marked) keeps the start row and deletes the holder row (`keepClaim`, one sliced write, at most `RELEASE_WITHIN_MS`). So an answered claim is never taken over: row 011-235's rule holds.
- A check that did not answer gives the claim back as before and deletes the holder row with it (`releaseClaim`).
- The claim code moved to `src/core/daemon/full-check-claim.ts` (full-check.ts was 338 lines; biome forbids a barrel re-export). `test/daemon/full-check.test.ts` changed only its import line for that move.

## Why two live daemons cannot both run the day's check

The claim and the takeover are one write transaction, so two daemons see each other's writes in order. A daemon takes a held claim only when its holder is surely dead (`false`). A live holder reads `true`. A holder whose life cannot be told (another PID namespace, an unreadable stat) reads `null` and stays held for the day. The second of two racing daemons therefore finds the first one's fresh holder row, names a live process, and gets no claim.

## Older rows and older daemons

- A start row with no holder row (written by a daemon before this row, or answered) stays held for 24 h, as before.
- An older daemon reads only the start row. It ignores the holder row and behaves as before. A holder row whose `at` differs from the start row is ignored.

## Known residue

- A daemon killed after its check answered but before the holder row was deleted leaves a dead holder: the next daemon runs one more check that day. One extra check, never a missed one.
- The orphaned check process still runs to its end (row 011-373) and its answer still goes nowhere; the replacement's own check finds the same fault, so no fault goes unreported.
- Without `/proc` (macOS), liveness falls back to `kill(pid, 0)`. A reused pid reads alive, so the claim stays held: the old 24 h behaviour, never a double check.

## Tests

- `test/daemon/sigkill-children.test.ts`, new case "its claim on the day's full check ends with it": grows the store, SIGKILLs the daemon while its check reads, ends the orphaned check, starts a replacement and waits for a new start row and for the holder row to go (the replacement's check answered). Before the fix it failed: "the replacement's claim not met in 60000 ms" (load average 74 on 24 vCPUs). After the fix it passed in 12.2 s (load average about 58).
- `test/daemon/full-check-holder.test.ts` (new): takeover of a gone holder; no takeover for an unknown-life holder, a missing, stale or unreadable holder row; an answered check keeps its start and drops the holder; a check that could not run gives both rows back.
