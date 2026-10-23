# 011-55: a promoted file under another worktree's claim makes no tier yield, worker notes (2026-10-23)

Brief W4 of `../wave-18.md`; spec 011 C15 and C7 (claims); `../011-51/notes.md`, "Open for later rows", item 1. Base `e051dfc1a` (0.1.270). Commit `86de93c03` is the row.

## Seam map

- `src/core/scheduler/yields.ts`: `waitedFor` decides whether something waits for a tier in its lane. Its promoted-file test now leaves out a file that `waitsOnClaim`: not forced, not an edit's work (`recent`), no result stored at its key (`results.byKey(key, 0)`, a read with no last-used write), and `ledger.claims.holds(key)`. This is the test `selectTier` (`tiers.ts`, the `waits` block) and `claimOf` (`claims.ts`) use to keep a file queued on a claim.
- `src/core/scheduler/queue.ts`: `hasPromoted(where)` now asks `where` of promoted entries only. Before, it asked `where` of every fast entry first; with a filter that reads the store, that was one or two store reads per queued file of the lane at each check.
- `src/core/scheduler/promotions.ts`: the class comment says a promotion holds through a claim but makes no tier yield. No code change.
- Status needed no change. `queuedReason` (`src/core/status/standing.ts`) names a claim before it looks at a tier, so a promoted file under a claim already read `waiting for <worktree>'s run of its key, at most until …` and never `; the tier yields`. The new test pins that line.

## Decisions the spec did not settle

1. The yield rule mirrors selection's claim test exactly, `mayWait` included. A promoted file with a result stored at its key does not count as waiting on a claim, so it still makes the tier yield as before. Such a file is either applied at the next selection (nothing runs) or withheld by `heldFailure` (it runs here); the row leaves that case as it was.
2. `Claims.holds` has two effects: it starts the waiter's bound (`#seen`) at its first sight, and it sets `waiting` until the next `begin`. The first is what C7 says ("when the waiter has seen it"). The second only adds at most one `claimWake` (1 s) on a pump path that skips `selectTier`, since `selectTier` calls `begin` first. No change to `claims.ts`, which is not this row's.

## Tests

`test/scheduler/tier-yields-claim.test.ts`, two worktrees on one store (`catch-up-fixture.ts`):

1. The other worktree runs F's key, held. Here an edit's tier of four 200 s files runs, held, with F (re-keyed by `f.config.json`, so not an edit's work) and G queued behind it. A wait on F: the tier is not cancelled within `SETTLE_MS`, F's standing is `claim` with the other root, and its line names the claim with no "yield". A wait on G (no claim): the tier yields and G runs. At the end F ran once in the other worktree and none here, and this worktree took its result.
2. The same claim, but F is an edit's work here (`src/f.ts`, F sorted after the four by its 300 s known), at the tier's own revision. A wait on F makes the tier yield, and F runs here: an edit's work never waits on a claim (C7).

Red before: test 1 failed on the base at `expect(tier.cancelled).toBe(false)`. Test 2 passes on the base by nature: it pins the `recent` clause. With `queue.isRecent(ref)` removed from `waitsOnClaim`, test 2 failed at its `tier.cancelled` poll. The existing `tier-yields.test.ts` test 3 still pins a promoted file with no claim in one worktree.

## Open for later rows

- Closed by the repair below (row 011-123): a claim that ends with no result did not check the tiers in flight again.
- Status's claim reason (`claimantOf` in `queuedReason` and `standingsOf`) does not ask whether the file may wait: an edit's work (`recent`) or a forced file under another worktree's claim reads `waiting for <worktree>'s run of its key` though this daemon runs it, and a tier may yield to it (test 2's state). Not this row's files (`src/core/status/`).

## Repair W5: review `../../reviews/0.1.271.md` B1 (2026-10-23)

Brief W5 of `../wave-18.md` ("Wave 18.5"), which folds in row 011-123. Base `c3538db61`, the two commits above unchanged in cand/0.1.271 (`70bd5840f`). Commit `ff656cb20` is the repair.

### What changed

- `src/core/scheduler/yields.ts`: `waitedFor` returns `"work"`, `"recheck"` or `null`. `"recheck"`: only promoted files a yield runs nothing sooner for wait for the tier, each held by another worktree's claim or with a result stored at its key to take. `#decide` then returns the internal `RECHECK` (after the runner rule: a tier whose runner cannot cancel gets no recheck), `check` publishes no standing for it, and `boundOf` arms the yield timer at `now + CLAIM_RECHECK_MS` (1 s). Each recheck asks `Claims.holds` again, which reads the claimant's heartbeat (two intervals, C7) and the waiter's bound (`runner.timeoutMs` + 6 s, or 600 s) from its first sight. A claim that ended makes the file `"free"`, and the tier yields as C15 says.
- `src/core/scheduler/scheduler.ts`, `#recheckTiers`: under the lock, `#adopt` (results other worktrees stored, as a reconciliation pass takes them) before `#cutTiers(null)`. A claimant's record is then taken first, and its file leaves the queue with no run and no cut. `#adopt` takes nothing while runner work waits, as before.
- `src/core/scheduler/claims.ts`: `peekClaim(context, ledger, ref)`, `claimOf` by reads only, moved from `yields.ts` (`waitsOnClaim` in `86de93c03`). `"stored"` is new: a result at the key that stands here (the accept rule's `heldFailure` test, without the format copy) makes no yield. A held foreign failure is `"free"`: it runs here.
- The busy-lane wait in `scheduler.ts:795` is unchanged: the yield timer covers a busy lane and a free one alike, so the pump needs no new wake.

### Decisions the brief did not settle

1. The cadence is the claim recheck's 1 s, not a timer at the waiter's bound: a timer there misses a claimant that dies earlier (review, "Inputs for the fix wave"). The cost is one check of the tiers in flight, one `keysSince` read and, per promoted file of the lane, one `byKey` and one `claimed` read each second, only while such a file waits.
2. A stored result arms the recheck too, so a result that lands before this worktree saw any claim is taken within a second, not at the next reconciliation pass (30 s idle). Where `#adopt` cannot take it (runner work waits, or the file crashed at that key here, which `StoredKeys` skips), the recheck repeats each second until the tier ends or the file leaves the queue.
3. `#adopt` runs at every recheck, the file-ended and overrun ones too. It writes nothing when no key is new (task 001-412).

### Tests

`test/scheduler/tier-yields-claim-ends.test.ts`, on the two-worktree setup of `tier-yields-claim.test.ts` (helpers now in `tier-yields-claim-fixture.ts`): F held by the other worktree after an environment-only re-key, here behind an edit's tier of four 200 s files, held, and promoted for 60 s. Each test first checks that three rechecks (3 s) leave the tier running and that the wait names the claim. Nothing in the tests makes an edit, a promotion or a reconciliation pass after that, unless the test says so.

1. Heartbeat lost: the claimant's beat stops and its last heartbeat is three intervals old. The tier is cancelled and F runs here within 10 s (`RECHECK_WITHIN_MS`, ten rechecks).
2. The waiter's bound, from first sight: `runner.timeoutMs` 40 s here (bound 46 s), a clock this test moves. 20 s on, a second request; the tier runs on. 30 s more (50 s since the first sight, 30 s since the second request): the tier is cancelled and F runs here within 10 s. A bound that restarted at the second request would not have passed.
3. The claimant's result: the claimant's run ends and stores F's result. F is current here within 10 s, the tier is not cancelled, and F ran 0 times here.
4. A result stored before the wait's first check: the claimant records before the promotion. F is current here within 10 s, the tier is not cancelled, and F ran 0 times here.

`tier-yields-claim.test.ts` keeps the live claim, the unclaimed file G that cuts the tier, and the edit's file that cuts it.

Red before: tests 1 to 3 failed on `c3538db61` at their first poll (the tier's cancel for 1 and 2, F current for 3). Test 4 was written after the first fix; it fails with `"stored"` counted as `"free"` (the tier is cut, line 132) and without the recheck's `#adopt` (F is not current, line 130). Without `#adopt`, test 3 fails too (line 104).

`test/scheduler/catch-up-fixture.ts` gains `stopBeat()`, as `claims-fixture.ts` has; no other test uses it.

### Open for later rows

- `yields.ts` is 406 lines, above the styleguide's 300 (352 before row 011-55). `waitedFor` and `recreates` could move out together.

