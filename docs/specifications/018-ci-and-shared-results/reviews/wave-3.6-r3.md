# Wave 3.6 R3: request completion ownership and malformed observed paths

## Verification

Candidate: `cand/0.1.419` at `21adaff513bb94a01ca0f00593de77bbbcc43562`, rebased onto `origin/main` at `e69c19caa`.

Read `wave-3.6-r2.md` first. Scope: the 018-12 R2 repair (`18e775a2b`), its brief and status amendment; and the newly authorized 011-310 / issue #166 changes (`1dd5a98b5`, `1022abdc7`, `f1a4c15fe`, `543930a03`), notes and bundles. The prior candidate's rebased equivalent is `12571f21a`. The review follows both briefs, the 011-310 research and notes, and the affected source and callers.

All code verification ran at the exact candidate with an empty `git status --porcelain`. Throwaway probes were outside the checkout. Only this report was added afterwards.

```text
$ git fetch origin cand/0.1.419
$ git checkout --detach 21adaff513bb94a01ca0f00593de77bbbcc43562
$ git rev-parse HEAD
21adaff513bb94a01ca0f00593de77bbbcc43562
$ git status --porcelain
(empty)

$ pnpm run lint
Checked 2884 files in 1553ms. No fixes applied.
exit 0

$ pnpm run typecheck
$ tsrs --fast --noEmit
exit 0
```

Dependencies were already installed; setup was not repeated. No local full suite or build was run, as instructed.

```sh
pnpm exec vitest run \
  test/scheduler/request-progress.test.ts \
  test/scheduler/request-progress-ends.test.ts \
  test/scheduler/request-progress-forced.test.ts \
  test/scheduler/request-progress-retry.test.ts \
  test/daemon/request-progress-timers.test.ts \
  test/daemon/drain-timers.test.ts test/daemon/unused-timers.test.ts \
  test/scheduler/checkpoints.test.ts test/scheduler/checkpoint-tracker.test.ts \
  test/scheduler/retry.test.ts test/scheduler/narrow-run.test.ts \
  test/daemon/observed-malformed.test.ts \
  test/scheduler/observed-malformed.test.ts \
  test/scheduler/refused-observed.test.ts test/keys/closure.test.ts \
  test/keys/validity/compare.test.ts test/keys/key-format.test.ts \
  test/version-sensitive.test.ts --maxWorkers=4
```

```text
Test Files  18 passed (18)
     Tests  120 passed (120)
  Duration  99.74s
exit 0
```

Independent probes used this candidate's real scheduler, Vitest adapter, shared store and fixture helpers. They lived under `/home/agent/.cache/squeal-review-018-12-r3-71bb3ca8`, with a symlink to the checkout's `node_modules`, and a config selecting only external `*.test.ts` plus the candidate's global teardown.

```sh
pnpm exec vitest run \
  --root /home/agent/.cache/squeal-review-018-12-r3-71bb3ca8 \
  --config /home/agent/.cache/squeal-review-018-12-r3-71bb3ca8/config.mjs \
  --maxWorkers=1
```

```text
Test Files  1 passed (1)
     Tests  4 passed (4)
  Duration  6.02s
exit 0
```

These four probes checked forced overlap, retry key-change behavior, actual stored-pass non-reuse, and the alarm exception's boundaries. The first probe run reached the non-reuse assertions successfully but then failed on a nonexistent probe API (`results.forKey`). Correcting that call to `results.byKey` produced the passing result above. That setup error is not a candidate failure.

A separate external `valid-keys.test.ts` called the existing `comparisons().compare({}, CASES, tree())` harness and asserted equality of keys for every case that keyed at both trees. Command: the same external Vitest command above with `valid-keys.test.ts` as its final argument.

```text
Test Files  1 passed (1)
     Tests  1 passed (1)
  Duration  6.50s
exit 0
95 cases keyed at both trees; changed keys: []
1 baseline-only error: the new malformed-observed-path case
```

The source inspection agrees: with no refused observed path, the runtime part and closure arguments remain the same. Probes were deleted before committing this report.

Affected results were read repeatedly with:

```sh
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 \
  src/core/scheduler/request-progress.ts src/core/scheduler/ledger.ts \
  src/core/scheduler/checkpoints.ts src/core/scheduler/scheduler.ts \
  src/core/scheduler/keying.ts src/core/scheduler/refused-observed.ts \
  src/core/keys/closure.ts test/keys/validity/verdict.ts
```

Repeated waits advanced from 313 current / 741 pending, through 641 / 413, to this last result:

```text
Revision: 6 · 21adaff5 + 0
Current (752): 752 pass
Pending (302): 33 in a running tier or awaiting its final checks,
237 queued behind it, 32 waiting for the parent worktree's shared result
Named test files have no verdict: the deadline passed after 60.9 s
Worktree: known failures 0; not current: 302 of 1524 test files
(33 running, 269 queued), 1716 tests (137 running, 1579 queued)
exit 3
```

These 302 affected files are **unverified**, not passing. No full-suite checkpoint was requested.

CI was read with `gh run view 42593079334 --json status,conclusion,jobs`. [Exact-candidate run 42593079334](https://github.com/hearsay-tools/squeal/actions/runs/42593079334) has head SHA `21adaff513bb94a01ca0f00593de77bbbcc43562`. At the last read, Node 24 (lint, typecheck, version-sensitive, build and bundle checks) passed. All three Node 22 shards remain in progress. The nightly Node 24 and bundle-version jobs are skipped. Full-suite CI remains **unverified**; this is not a review blocker.

## Verdict

**PASS**: 0 blockers, 1 proven nonblocking timing note, 0 nits.

The prior B2-R1 forced-attribution blocker is resolved. The original B1, B2 and B3 cases remain fixed. The new malformed-observed-path scope passes. The retry key-change case below does not establish a stop during a live request or indefinite life without progress. This applies the parent clarification: an extra count that only delays exit by one idle period is not a blocker.

## Prior findings and required cases

| Case | Evidence at this candidate | Disposition |
| --- | --- | --- |
| B2-R1: forced request overlaps an older baseline | Independent one-file probe: 0 before release; 0 after the baseline ends while the forced run is held and checkpoint end is null; 1 after the forced run ends and checkpoint completes | Resolved |
| B1: fast request joins a baseline with slow work | Real-scheduler regression: 3 after the fast checkpoint completes; still 3 after slow work ends | Remains resolved |
| Empty fast request while slow baseline stays open | Selected files empty; count remains 0 after slow work | Pass |
| Original B2: completion then re-queue before a read | Count 1 with the edit run held; still 1 after that later run | Remains resolved |
| B3: retry deferred by load | Count 0 while waiting; 1 after reconciliation queues and completes it | Remains resolved |
| Retry pending at daemon start | The next scheduler completes it as passed and counts 1 | Pass |
| Ordinary baseline, no explicit request | No count from its fast or slow file ends | Pass |
| Unknown end, discard, removal, repeated reads | Ledger regressions distinguish terminal ends from re-queues and add no duplicate end | Pass |

The acceptance decision now comes from `Checkpoints.done` (`src/core/scheduler/checkpoints.ts:236`) and the retry's existing `endRetry`. `Ledger.#ended` (`ledger.ts:487`) forwards an end only if the checkpoint accepted it and `retryKey` is clear. `RequestProgress` records that event once; it no longer judges strict checkpoint attribution. The forced-overlap probe confirms the timing, not just the final total.

No lifecycle timer changed in this repair. The passing request-progress, drain and unused timer tests preserve the settled idle, departure and registered-session rules, including file ends as use for the unused stop. No new evidence reopens the lifecycle rules settled in the first review.

## New scope: malformed stored observed paths

The persisted incident path is `\home\agent\AppData\Local\Hearsay Squawk\cache`.

- `WorktreeKeys.effectiveObserved` (`src/core/scheduler/keying.ts:622`) filters paths through the same acceptance rule closure assembly uses. Its callers cover closure assembly, import rewalk, observed growth and release of inherited inputs. A refused path does not reach the throwing normalizer through these consumers.
- The real daemon regression passed a clean control, seeded first start, restart and an actual second git worktree. All malformed starts key the file alike, differ from the clean control and persist the path note once per worktree.
- `RefusedObserved.keyed` (`src/core/scheduler/refused-observed.ts:29`) keeps valid runtime identity unchanged. A refused set instead gives the key a `squeal-refused-observed/1` mark containing that set and the original runtime identity. The shared observed set is retained, so restart and another worktree retain the mark. The runtime-policy getter used to judge run records is unchanged.
- The independent scheduler probe first ran a one-file fixture to a stored current pass with observing enabled. It closed the scheduler, added the malformed path to the shared observed set, then started a lookup-only scheduler over the same store and tree. The original stored result still exists, but the file has a different key, no run occurs, and the old pass is not current. This checks actual reuse, beyond comparing key strings.
- The key-format and comparison tests pass. Valid-input key equality is checked separately above. No format or adapter version was raised.

The `lastThrows` exception (`test/keys/validity/verdict.ts:190`) applies only when the baseline error contains that case's declared text and the candidate has no error. The new declaration names the incident's precise normalization error. The driver returns only the error when a case throws, so the baseline produced no usable case output to reuse. Once the baseline can key that input, the exception is inert. Independent controls confirm that with `lastThrows` present: differing keys on valid inputs still compare as different; differing outputs at equal keys still fail their verdict; unexpected baseline errors and candidate errors still differ. Existing comparison tests also verify that those errors produce a format alarm. The exception does not bypass coverage or other cases.

## Nonblocking note

### N1, proven: a retry's ask can survive its lapse and count a later edit run

Locations: `src/core/scheduler/retries.ts:156`, `src/core/scheduler/request-progress.ts:67`, and `src/core/scheduler/ledger.ts:487`.

Independent reproduction:

1. Start a one-file flaky fixture under `RUN_MISSING`, with automatic failure re-runs disabled. Let its first run fail. Remove the external failure marker.
2. Ask an environment retry and hold its forced run in `runner.beforeRun`.
3. Append a comment to the test file and reconcile it with `h.batch`. Its key changes. The retry record at the old key now has `claim: null`, `end: null`; progress is 0. This request has lapsed in this worktree, as the retry contract requires.
4. Release that run and hold the next run at the new key. Progress is still 0.
5. Release the next run. The old retry record remains unclaimed and pending at its old key, but progress becomes 1.

The tracker retains the same file object because it stays running or queued. Once `lapseRetry` clears `retryKey`, a later accepted result consumes the stale ask. The request did not accept that result at its old key.

This is an extra activity tick at the later real file end. It can delay idle exit until one idle period after that end. It does not show a live matching-key request losing its progress: the reproduced request had already lapsed here. The worker's stated variant ends the old retry before the later run, so it likewise has no open work of that retry left to abandon. The worker supplied no separate reproduction of that variant; its exact path remains unverified. In either described variant, consuming the retained ask deletes it, and repeated reads or further background runs cannot count it again. A stalled later run produces no end and no tick. No indefinite keep-alive without real file ends was demonstrated.

A future bounded cleanup, if authorized, could remove a retry-only ask at lapse or withdrawal while retaining any separate explicit request for the same file. Keep the acceptance owners and the forced-overlap regression intact. This note does not authorize another 018-12 repair round.

## Blockers

None.

## What fits and inputs for the next decision

Keep the forced-overlap regression and the earlier request-progress cases. The two candidate scopes can proceed on this review. The lifecycle and keying boundaries need no further change for these accepted outcomes. Preserve the refused-path mark and shared evidence; merely dropping the malformed path would reuse an older valid-only result.

The report is a candidate review, not release evidence. Exact-release full-suite CI must pass before release. Pending affected checks and CI are unverified as recorded above; they are not findings against the candidate.
