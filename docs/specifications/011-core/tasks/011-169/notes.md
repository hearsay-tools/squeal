# 011-169: why a promoted edit did not cut the tier on main CI, worker notes (2026-10-24)

Brief W2 of `../wave-28.md`. Shape: survey, then repair. Base main `e9c424d3d` (after 0.1.286). Spec 011 C4 step 5 and C15; `../011-55/notes.md`, `../011-107/notes.md`, `../011-159/notes.md`.

## The cause

A test defect, not a product one. Row 011-159 (0.1.284) made `baseline.onStart: "lookup-only"` the default. It pinned `RUN_MISSING` where a test reads what the start's runs stored, `tier-yields-claim-ends.test.ts` case 1 among them ("the yield reads the 200 s durations the start's run stored"). It did not pin `tier-yields-claim.test.ts`, whose two cases read the same 200 s. Its table lists only the fixture's new `policy` option, "pinned per call below", and no call below names this file.

On the default start nothing runs, so the four slow files have no known duration. The tier's estimate is 0, and its remainder is negative from its start. A promoted file that a yield runs sooner (F, an edit's work here) then gets C4 step 5's overrun rule (row 011-107): the tier yields when it has run 30 s past its estimate, that is 30 s after its start. The promotion's own check decides `overrun` with `yieldsAt` at the tier's start plus 30 s, and the yield timer cuts it there.

The test polls `tier.cancelled` for `CUT_WITHIN_MS` (30 s) from the promotion. The promotion comes about 47 ms after the tier's start: `heldRun` sees the run at its second 50 ms poll. So the poll's window ends about 47 ms after the cut. `expect.poll` checks, then waits 50 ms; a check must fall in those 47 ms. When none does, or the timer fires late on a loaded runner, the poll misses the cut. That is the failure on main CI 40055071516.

Event order of a failing run. The decisions come from one run with a log line in `#decide` and in `waitedFor`'s claim read (reverted); that run passed. The probe's misses below have the same times, to within 3 ms of the cut:

| ms from the tier's start | Event |
| --- | --- |
| 0 | the edit's tier of the four slow files starts, held |
| 47 | `promote(F)`; under the lock `waitedFor` reads F `"free"` (recent, so no claim holds it), `"work"`; `#decide`: remainder −47 ms, `overruns` true, so `{ kind: "overrun", yieldsAt: start + 30 s }`; the bound is armed |
| 47 to 30,047 | the test's poll of `tier.cancelled`, every 50 ms |
| 29,999 | the yield timer's recheck: `#decide` returns `"yield"`; the tier is cancelled |
| 30,047 | the poll's timeout; its last check came before 29,999 |

With the start pinned to `RUN_MISSING`, the same probe reads the remainder as 200 s less 47 ms, and the promotion's own check yields: the cut comes 1 ms after `promote`.

The same reason explains why both cases took about 30 s on every CI run, passing or failing (attempt 1: 30,234 ms and 30,299 ms; attempt 2: 30,311 ms and 30,373 ms), and 30.3 s on this host.

## What the default start also weakened

Test 1 of `tier-yields-claim.test.ts` checks that a promoted file under another worktree's claim makes no tier yield: no cut within `SETTLE_MS` of its promotion. On the default start the tier could not yield within 1.5 s whatever waits, since its overrun bound is 30 s after its start. So test 1 passed with row 011-55's claim rule removed. Its later cut for G came from the overrun bound too, 1.5 s inside the poll.

## Counts

The probe: case 2 of `tier-yields-claim.test.ts`, step for step, in a file outside the suite's include, with `performance.now()` read at the tier's start (`CatchUpRun.startedAt`), at `promote` and at the cut (`CatchUpRun.endedAt`). A failed poll is caught and recorded, then the probe waits up to 60 s for the cut to time it. 200 runs per phase: 10 files of 20 runs each, `--maxWorkers=10`, so 10 runs are in flight at once. A run is mostly idle (3 s CPU in 62 s for both cases alone), so the 10 add little load. "Busy loops": 24 `while :; do :; done` shells, the host's core count, under their own process group (`setsid`), stopped by their pgid at the phase's end. Load is the 1-minute load average, sampled every 30 s; the host was shared with W1, Q1 and other daemons throughout.

| Phase | Start | Check | Runs | Poll missed the cut | Cut after `promote`, ms (min, median, max) | Load |
| --- | --- | --- | --- | --- | --- | --- |
| alone | default (lookup-only) | `CUT_WITHIN_MS` (as on main) | 200 | 5 (2.5%) | 29,949, 29,952, 29,959 | 2.2 to 12.6 |
| 24 busy loops | default (lookup-only) | `CUT_WITHIN_MS` (as on main) | 200 | 19 (9.5%) | 29,943, 29,954.5, 29,965 | 9.0 to 93.6 |
| alone | `RUN_MISSING` | `SETTLE_MS` (the fix) | 200 | 0 | 0, 0, 3 | 60.5 |
| 24 busy loops | `RUN_MISSING` | `SETTLE_MS` (the fix) | 200 | 0 | 0, 0, 8 | 57.6 (the loops ran 22 s, inside one 30 s sample) |

`promote` came 19 to 56 ms after the tier's start (median 45 to 48 ms). In every missed run the cut came at 29,982 to 30,003 ms after the tier's start, the same as in the runs that passed: the miss is the poll's 50 ms step against a window of about 47 ms, and load moves the poll's checks more than the timer. Both pinned phases took 16 s and 22 s in all.

## Red before the fix

Each check ran copies of the test files outside the suite's include. The two product mutations were reverted after each run (`git checkout` of `claims.ts` and `yields.ts`). Squeal's FAILs at revisions 14, 16, 18 and 20 in this worktree are those windows; each cleared at the next revision.

1. The new `SETTLE_MS` polls on the default start (the fix's polls with no `RUN_MISSING`): `tier-yields-claim` case 1 fails at G's cut (line 63) and case 2 at F's (line 92); `tier-yields-ended` case 2 fails at B's yield (line 72). With the pin, all pass. So the old polls waited for the overrun cut, 30 s after the tier's start, not for the promotion's or the edit's.
2. Row 011-55's claim rule removed (`peekClaim` returns `"free"`): the fixed `tier-yields-claim` case 1 fails at `expect(tier.cancelled).toBe(false)` (line 52); the version on main passes.
3. The 30 s threshold dropped (`remainderMs > 0` yields): the fixed `tier-yields-ended` case 1 fails at `expect(tier.endedAt).toBeNull()` after B's edit (line 54); the version on main passes.

## Other tests on these fixtures with no policy

The audit: a Vitest setup file that wraps `TierYields.prototype.check` and logs each tier it cancels, with the cause, the longest known duration of its files and how long it had run on the scheduler's clock. It ran over the 57 test files that use `catch-up-fixture.ts`, `tier-yields-fixture.ts`, `tier-yields-claim-fixture.ts` or the fixtures built on them (246 tests, all passed): 74 cancels, 4 of them yields of a tier with no known duration.

| File | Cut polls | What the audit and a mutation show | Fixed here |
| --- | --- | --- | --- |
| `tier-yields-claim.test.ts` | 2 | yields of tiers with no known duration at 30 s; now 2 yields with known durations, under 30 s | yes |
| `tier-yields-ended.test.ts` | 2 | the same; now 1 yield, 1 supersession, known | yes |
| `tier-yields-fairness.test.ts` case 5 | 2 | `catchUpSide` with no policy (line 79). The yield to the g1 edit (line 90) is the overrun's, at 30,003 ms (31,795 ms on CI attempt 2): exposed as `tier-yields-claim` was. Its no-yield check (line 97) is weak: with the cut mark removed, the main version passes and a pinned copy fails at line 97 | row 011-174 |
| `tier-ended-files.test.ts` | 4 | `oneRunning` (line 83) says "A, B and C of `ms` known each" but has no policy. Its 4 cuts are supersessions, which do not depend on durations, so the 30 s race does not reach it. Its no-cancel checks are weak: with the 30 s threshold dropped, the main version passes all 5 cases and a pinned copy fails 3 (lines 131, 154, 205 of the file on main) | row 011-174 |
| `editor-scratch.test.ts` | 3 | no policy; the 3 cuts are supersessions; its file is 100 ms known, so the remainder rule keeps it on either start | not needed |
| `focused.test.ts` | 1 | pins its own `BASELINE`; 1 yield with known durations | not needed |

The other 4 yields of tiers with no known duration are intended: the two "no known duration" cases of `tier-yields-overrun.test.ts`, and case 2 of `tier-yields-claim-ends.test.ts`, whose cut needs the claim's end first, since a recheck decision comes before the remainder rule.

The audit hook, for a later row:

```ts
const check = TierYields.prototype.check;
TierYields.prototype.check = function (context, ledger, tiers, revision) {
  const before = new Map(tiers.map((t) => [t.runId, t.cancel?.signal.aborted === true]));
  check.call(this, context, ledger, tiers, revision);
  for (const tier of tiers) {
    if (before.get(tier.runId) === true || tier.cancel?.signal.aborted !== true) continue;
    const longest = Math.max(0, ...tier.files.map(({ file }) => file.durationMs ?? 0));
    appendFileSync(out, `${JSON.stringify({ test: expect.getState().currentTestName,
      reason: tier.cancel.signal.reason, longest, ranMs: context.now() - (tier.startedAt ?? 0) })}\n`);
  }
};
```

## The fix

Tests only; no product change (the coordinator's reply to request 5a6a03b3: "No product change in this row").

- `test/scheduler/tier-yields-claim.test.ts`: both cases call `sides(..., { policy: RUN_MISSING })`, so this worktree's start runs every file and stores the 200 s (and F's 300 s). The polls for the promotion's cut (G's in case 1, F's in case 2) wait `SETTLE_MS`, not `CUT_WITHIN_MS`. `promote` takes the lock and cuts under it before it returns, so a cut that the promotion decides has come within `SETTLE_MS` ("a cancel that was going to come has come"). The overrun cut, 30 s after the tier's start, can no longer pass the poll.
- `test/scheduler/tier-yields-ended.test.ts` (by the coordinator's agreement, request 5a6a03b3, its own commit): `oneEnded` passes `policy: RUN_MISSING`, so A and B have the `ms` its comment says. Case 2's poll for the yield to B's edit waits `SETTLE_MS`. Case 1's supersession poll stays at `CUT_WITHIN_MS`: a supersession is decided at the revision whatever the durations.

## Brief corrections

- The cut decision is in `src/core/scheduler/yields.ts` (`TierYields.#decide`, `waitedFor`), not in `tiers.ts`; `tiers.ts` selects tiers. The claim read is `peekClaim` in `claims.ts`.
- 0.1.280's focused turn plays no part: the tier is an edit's (`kind: "edit"`), and `focusedWaiting` is false, as no focused entry waits. The cause is 0.1.284's start (011-159), through `sides()`'s default policy.
- The brief's 200 runs per phase at about 30 s a run would take 100 minutes one at a time; the probe ran 10 at once (above).

## Does the default start's 30 s overrun yield match C4 step 5?

Yes: C4 step 5 counts a file with no known duration as 0 and says a tier also yields when it has run 30 s past its estimate, so a tier with no known durations yields 30 s after its start, as 011-107's notes found under `lookup-only`.

## Row 011-174: the two tests left (2026-10-24)

The coordinator resumed this worker on `cez/32fe48c6` after `5dac4b72e` (board row 011-174, main `8dd84a8d7`). Shape: repair, tests only. No load phase.

| Commit | File | Change |
| --- | --- | --- |
| `8bf1c0848` | `test/scheduler/tier-yields-fairness.test.ts` | case 5's `catchUpSide` passes `policy: RUN_MISSING`, so the four files have the 100 s their runs stored; the poll for the yield to the g1 edit waits `SETTLE_MS` |
| `0d5fdbc3a` | `test/scheduler/tier-ended-files.test.ts` | `oneRunning`'s `catchUpSide` passes `policy: RUN_MISSING`, so A, B and C have their `ms`; its cut polls are supersessions and stay at `CUT_WITHIN_MS` |

Red before, each on the committed file with one product mutation, reverted after the run (`git checkout -- src/core/scheduler/yields.ts`):

1. The cut mark removed (`#decide` never returns `{ kind: "cut" }`): case 5 fails at `expect(again.cancelled).toBe(false)`, line 99. On main it passed (above).
2. The 30 s threshold dropped (`remainderMs > 0` yields): `tier-ended-files.test.ts` fails 3 of its 5 cases at `expect(tier.cancelled).toBe(false)`, lines 136, 159 and 210 (131, 154 and 205 on main). Line 162, in line 159's case, is not reached once 159 fails; it comes after B's end, when every file of the tier has ended, so no yield has a file to cut there.
3. Case 5 with the new `SETTLE_MS` poll and no `RUN_MISSING` (a copy outside the suite's include): it fails at the poll, line 92, as the overrun cut comes 30 s after the tier's start.

Durations on this host: case 5 takes 1.8 s (about 30 s before, 31.8 s on CI attempt 2). `tier-ended-files.test.ts` is unchanged: its case "an ended file a later revision re-keys alone…" takes 60.1 s on main and with the pin, as B's run takes a minute.

Squeal's FAILs at revisions 28 and 31 in this worktree are the two mutation windows; each cleared at the next revision.

Corrections to the 011-169 sections above:

- The line numbers 133, 156 and 207 for `tier-ended-files.test.ts` were those of a copy with two lines added at its top; the table now names the lines on main. Board row 011-174 quotes the copy's numbers.
- The probe, audit and copy files were in `.ai/cezar/t/32fe48c6/probe/`. That directory was emptied when this worker was resumed, so they are gone. The audit hook above and the probe's description are what is left.

With these two files, every test file the 011-169 audit found with no start policy and a weak check or a cut poll exposed to the overrun bound is pinned. No other row is open from that audit.

