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

- A claim that ends with no result (the claimant's heartbeat goes stale, or the waiter's bound passes) does not check the tiers in flight again. The file then waits for the tier in its lane, as any promoted file behind a tier that does not yield. A claimant's record that stores a result needs no yield: the file takes the result. A fix would arm the yield timer (`#bounds`) at the waiter's bound, which needs `Claims` to expose when it first saw the key (`claims.ts`).
- Status's claim reason (`claimantOf` in `queuedReason` and `standingsOf`) does not ask whether the file may wait: an edit's work (`recent`) or a forced file under another worktree's claim reads `waiting for <worktree>'s run of its key` though this daemon runs it, and a tier may yield to it (test 2's state). Not this row's files (`src/core/status/`).
