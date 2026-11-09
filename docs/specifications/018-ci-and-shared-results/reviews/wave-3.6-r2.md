# Wave 3.6 R2: request progress repair

## Verification

Candidate: `cand/0.1.419` at `48f46f3fc80ebcfaa45263f340f7159d246956dd`.
Range: `38a156cab..48f46f3fc`, including repair commits `23244349f` and `a4d154079`, the R1 brief and amendment, and rebuilt bundles.
Read `reviews/wave-3.6.md` first. This review checks B1 to B3, the extra cases in the R1 brief, and the resumed task's explicit requirement that the new ledger hook cannot count background work or double-count.

All verification below ran on the exact candidate with an empty `git status --porcelain`. Only this report was added afterwards.

```text
$ git fetch origin cand/0.1.419
From https://github.com/hearsay-tools/squeal
 * branch                cand/0.1.419 -> FETCH_HEAD
$ git checkout --detach 48f46f3fc80ebcfaa45263f340f7159d246956dd
HEAD is now at 48f46f3fc chore: 0.1.419 bundles with repair R1 of row 018-12
$ git rev-parse HEAD
48f46f3fc80ebcfaa45263f340f7159d246956dd
$ git status --porcelain
(empty)

$ pnpm run lint
$ biome check .
Checked 2878 files in 1058ms. No fixes applied.
exit 0

$ pnpm run typecheck
$ tsrs --fast --noEmit
exit 0
```

Dependencies were already installed. No install was repeated. No build or local full suite was run, as instructed.

```sh
pnpm exec vitest run \
  test/scheduler/request-progress.test.ts \
  test/scheduler/request-progress-ends.test.ts \
  test/scheduler/request-progress-retry.test.ts \
  test/daemon/request-progress-timers.test.ts \
  test/daemon/departure-timers.test.ts \
  test/daemon/drain-timers.test.ts \
  test/daemon/unused-timers.test.ts \
  test/scheduler/retry.test.ts test/scheduler/narrow-run.test.ts --maxWorkers=4
```

```text
Test Files  9 passed (9)
     Tests  48 passed (48)
  Duration  8.76s
exit 0
```

Affected results:

```sh
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 \
  src/core/scheduler/ledger.ts src/core/scheduler/request-progress.ts \
  src/core/scheduler/retries.ts src/core/scheduler/scheduler.ts \
  test/scheduler/request-progress.test.ts test/scheduler/request-progress-ends.test.ts \
  test/scheduler/request-progress-retry.test.ts
```

The first wait timed out with 745 selected files passing and 4 pending. The repeated read resolved:

```text
Revision: 3 · 48f46f3f + 0
Named test files at revision 3: no known failures; 749 test files,
each with a current result, after 1.2 s.
Worktree: known failures 0; all 1520 test files current
exit 0
```

This is affected-result evidence, not a full-suite checkpoint.

CI: `gh run list --commit 48f46f3fc80ebcfaa45263f340f7159d246956dd --json databaseId,name,status,conclusion,headSha,url`, then `gh run view 42581516945 --json status,conclusion,jobs`. [Exact-candidate run 42581516945](https://github.com/hearsay-tools/squeal/actions/runs/42581516945) has a successful Node 24 lint/typecheck/version-sensitive job. All three Node 22 shards are still in progress at the last read. Nightly Node 24 and the bundle-version job are skipped. Full-suite CI is **unverified**, not a finding.

Independent real-scheduler probes used the same fixture APIs as the first review. They lived outside the checkout, under `/home/agent/.cache/squeal-review-018-12-r2-71bb3ca8`, with a symlink to this checkout's `node_modules` and a config selecting only that directory's `*.test.ts`, plus this candidate's global teardown.

```sh
pnpm exec vitest run --root /home/agent/.cache/squeal-review-018-12-r2-71bb3ca8 \
  --config /home/agent/.cache/squeal-review-018-12-r2-71bb3ca8/vitest.config.mjs \
  --maxWorkers=1
```

Final probe output:

```text
progress with only old baseline completed 1
forced checkpoint end while own run held null
progress after forced file also completes 1
AssertionError: expected 1 to be +0
Test Files  1 failed (1)
     Tests  1 failed | 5 passed (6)
  Duration  6.01s
exit 1
```

The five passing cases are listed below. The failing assertion is the blocker below. The process restart removed an earlier `/tmp` probe before its result could be recovered. A later attempt to reduce the fixture removed files after the adapter had listed them; that probe setup was corrected by removing them before opening the harness. Neither attempt supplies candidate evidence. Temporary probes were removed before the report commit.

## Verdict

**FAIL**: 1 proven blocker, 0 should-fix findings, 0 nits.

B1 and B3 are resolved. B2's original reproduction is fixed, but its new end hook consumes a forced request's ask on a result that the forced checkpoint rejects. This fails the requested check that the hook cannot count background work.

## Previously blocking findings

| Finding or extra case | Independent result | Assessment |
| --- | --- | --- |
| B1: fast request joins a baseline with slow files | Count is 3 after fast completes and remains 3 after slow baseline ends | Resolved |
| Empty fast request while slow baseline remains open | No requested files; count remains 0 after slow ends | Pass |
| B2: completion, then re-queue before a read | Count is 1 while the later run is held and remains 1 after that background run ends | Original reproduction fixed; completion identity still fails below |
| B3: load retry queues during later reconciliation | Count is 0 while load holds it, then 1 after it runs; another pass adds none | Resolved |
| Retry pending at daemon start | Next scheduler completes the retry and counts 1 | Pass |

## Blocker

### B2-R1, proven: a forced ask ends on an older baseline result

Locations: `src/core/scheduler/ledger.ts:478` and `src/core/scheduler/request-progress.ts:39`.

Required rule: the R1 brief says “the idle exit sees every file end of an open explicit request, and only those”. It requires the end to be recorded at its real boundary. The resumed review also explicitly requires that `FileEnds` cannot count background work. The new `RequestProgress.ended` comment says an ask ends “as the checkpoint counts it”.

`Ledger.applyResults` calls `checkpoints.done(file.ref, checkpointId)` and then calls `ends.ended(file)` unconditionally. The forced checkpoint rejects an older tier's result at `checkpoints.ts:235`, because only its own attributed runs count. The new hook receives only the file object, with no completion attribution or strict-request rule. It counts that rejected baseline result and deletes the outstanding ask. When the actual forced run ends, the ask is already gone.

Real-scheduler reproduction:

1. Create the basic fixture with `createRepo()`. Before `openHarness`, remove all test files except `test/math.test.ts`.
2. Open the harness with `policy: RUN_MISSING`, `tierSize: 1`, and `runnerPartBesideRun: true`.
3. Gate the first baseline run in `runner.beforeRun`. Gate subsequent runs separately. Start the scheduler and wait for the baseline to reach its gate.
4. Accept `requestFullSuite({ force: true })`. Count is 0. This forced request cannot join the non-forced baseline.
5. Release the old baseline run. Wait for the forced run to reach the second gate. The forced checkpoint still has `end: null`.
6. Read progress. Expected **0**: none of the forced request's work ended. Actual **1** from the older baseline result.
7. Release the forced run and wait for idle. `runsOf("test/math.test.ts")` has two completed runs, and the forced checkpoint completes. Progress is still **1**: its actual completion added no activity.

This changes idle timing, even though the final count looks right. For example, with a 60-second idle period, an old baseline end at time 0 and the forced file's end at time 50 leave the idle timestamp at time 0. The daemon can stop at time 60, only 10 seconds after the request ends, instead of time 110. The same count feeds the registered-session unused stop.

This gap is introduced by the replacement of phase polling with unqualified ledger events. The old implementation did not count the baseline result while the forced file remained queued. It covers B2's request-completion identity and the explicitly requested new-hook background-work check.

Fix sized for one worker: carry enough completion attribution through `FileEnds` to distinguish an older run from a strict forced request's required work. Keep a forced ask outstanding until a completion that satisfies that ask. Preserve normal non-forced joining, completion at any accepted key, unknown/crashed terminal handling, and the original B2 regression. Add the one-file forced-overlap reproduction above. Reuse the request/checkpoint completion rule rather than a phase-at-poll test.

## Should-fix

None.

## Nits

None.

## What fits

- A full-suite request now registers `record.testFiles`, so a joined request does not claim its owner's other lane. Empty requests add no asks.
- The event hook preserves the original B2 completion through a later re-queue. Removing an ask on its first accepted end prevents a later background run from counting again in that case.
- Startup, direct retry and reconciliation use the same claim callback. A closed load gate adds no progress.
- The new ledger-level tests cover unknown ends, discard/re-queue, removal and leaving the queue without an end. They and the targeted timer, drain, unused, retry and narrow-run checks pass.
- The repair changes no daemon lifecycle code or key input. The departure/drain rules settled in the first review remain outside this delta. No new key move was found.

## Inputs for the next decision

The ordinary B1 to B3 reproductions and the requested empty-fast/startup-retry cases are settled by this candidate. Retain them. The remaining work is the forced-request completion identity in B2-R1. Keep the idle and unused timers as consumers of the count; departure grace and drain bounds need no change. No new deadline, runtime budget or key format is needed.

This is the second FAIL on this mechanism. `docs/process.md` step 6 sends a second FAIL to the human. The coordinator owns that decision. Exact-release full-suite CI is still required before release.
