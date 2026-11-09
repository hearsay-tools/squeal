# Wave 3.6 review: request progress and the idle exit

## Verification

Reviewed candidate `cand/0.1.419` at `38a156cab8485d4e83b8d57e2cc60d53c0ae9bdd`.
Range: `7f69b24e0..38a156cab`, including implementation `ffbee2249`, activity-rule amendment `a17361f92`, and bundle commit `38a156cab`.
All checks and probes below ran at that exact commit with an empty `git status --porcelain`. The only subsequent checkout edit is this report.

```text
$ git rev-parse HEAD
38a156cab8485d4e83b8d57e2cc60d53c0ae9bdd
$ git status --porcelain
(empty)

$ pnpm run lint
$ biome check .
Checked 2876 files in 802ms. No fixes applied.
exit 0

$ pnpm run typecheck
$ tsrs --fast --noEmit
exit 0
```

Dependencies were installed by Cezar before review. The brief expressly said not to repeat installation and not to build. No local build or full suite was run.

Targeted checks, including the requested lifecycle rules and the no-key-change alarm:

```sh
pnpm exec vitest run \
  test/daemon/request-progress-timers.test.ts \
  test/scheduler/request-progress.test.ts \
  test/daemon/lifecycle.test.ts \
  test/daemon/departure-timers.test.ts \
  test/daemon/drain-timers.test.ts \
  test/daemon/drain-wait.test.ts \
  test/daemon/unused-timers.test.ts \
  test/scheduler/retry.test.ts \
  test/scheduler/narrow-run.test.ts \
  test/keys/key-format.test.ts \
  test/version-sensitive.test.ts --maxWorkers=4
```

```text
Test Files  11 passed (11)
     Tests  68 passed (68)
  Duration  175.06s
exit 0
```

Squeal was read with its absolute session launcher:

```sh
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 \
  src/core/daemon/lifecycle.ts src/core/daemon/daemon.ts \
  src/core/scheduler/request-progress.ts src/core/scheduler/scheduler.ts \
  src/core/types/scheduler.ts test/daemon/request-progress-timers.test.ts \
  test/scheduler/request-progress.test.ts
```

The first read returned 454 current passes and 640 unknown selected files. This lookup-only baseline did not queue the unknown files, so targeted local checks were justified. The last read, at about 07:12 UTC, returned:

```text
Revision: 0
Current (1079):
  1079 pass
Unknown (15):
  12 waiting for [the parent worktree's] run of its key
  3 never run at their inputs, nothing queued them (the baseline is lookup-only):
    test/daemon/drain-wait.test.ts
    test/scheduler/backlog-slots-overhead.test.ts
    test/scheduler/timed-out-tier.test.ts
Named test files have no verdict: 15 test files without a current result at revision 0
Worktree: known failures 0; not current: 15 of 1518 test files (15 unknown)
exit 3
```

Those 15 Squeal results remain **unverified**, not failures. `drain-wait.test.ts` passed in the independent targeted run above. A separate `status --wait 60000` naming just the two new test files returned: `2 test files, each with a current result, after 2.3 s`, exit 0.

CI was read with `gh run list --commit <candidate> --json databaseId,name,status,conclusion,headSha,url` and `gh run view 42576994460 --json status,conclusion,jobs`. [Run 42576994460](https://github.com/hearsay-tools/squeal/actions/runs/42576994460) is for the exact candidate. At the last read:

- Node 24 (lint, typecheck, version-sensitive): **success**, including Build, Bundles match the build, and The build adds no plugin file.
- Node 22 shards 1/3, 2/3, 3/3: **in progress**. Full-suite CI is still unverified.
- Node 24 nightly full suite and Bundle changes bump the version: skipped.

Three discriminating probes used the real scheduler, store and Vitest fixture helpers, in `/tmp/squeal-review-018-12-71bb3ca8`, outside the checkout. The temporary config selected only `*.test.ts` there and used this candidate's `test/global-teardown.ts`. The directory used this checkout's `node_modules`.

```sh
pnpm exec vitest run --root /tmp/squeal-review-018-12-71bb3ca8 \
  --config /tmp/squeal-review-018-12-71bb3ca8/vitest.config.mjs --maxWorkers=1
```

```text
fast-only progress after slow baseline ends 5
progress after completed request file requeued 0
progress after deferred load retry ends 0
Test Files  1 failed (1)
     Tests  3 failed (3)
  Duration  7.18s
exit 1
```

All three failures were assertions of the required behavior, detailed below. An earlier probe attempt was interrupted because the reviewer awaited scheduler idle while holding its slow run. That was a probe error, not candidate evidence. The corrected run above settled each case. Temporary probes were removed before committing this report.

## Verdict

**FAIL**: 3 proven blockers, 0 should-fix findings, 0 nits. No product code was changed.

The normal path works. The new counter does not yet mean “an explicit request's file ended”: it can include another lane's baseline work, miss an end before a re-queue, and omit a retry accepted after a load wait.

## Blockers

### B1, proven: a joined fast request takes ownership of slow baseline work

Location: `src/core/scheduler/scheduler.ts:644`.

Rule: the brief says “it stops `daemon.idleExitMinutes` after the request ends or after its last progress”, and “A daemon with only its own background work (baselines, catch-up) and no open request keeps today's idle exit.” The lifecycle comment at `src/core/daemon/lifecycle.ts:215` says the daemon's own work is no activity.

`queueFullSuite` can join a fast-only request to a baseline that owns both lanes. `ledger.checkpoints.covers([file.ref], false)` then selects every remaining file of that baseline, including slow files the explicit request did not ask for. The progress tracker keeps those files after the fast request completes. Their later background completions reset both idle and unused activity.

Reproduction with existing helpers:

1. Use the five-file `createRepo()` fixture and `openHarness()`, as in `test/scheduler/request-progress.test.ts`. Use `RUN_MISSING`, backlog tiers of one, and mark `test/strings.test.ts` and `test/upper.test.ts` slow.
2. Hold the first fast baseline run. Accept `requestFullSuite({ lane: "fast" })`, so it joins the baseline. Hold the later slow run separately.
3. Release fast work. Wait for the fast request's checkpoint record to be `completed`. `requestProgress()` is 3, as required.
4. Release the two slow baseline files and wait for `slowPending()` to become false.
5. Assert that `requestProgress()` is still 3. Actual: **5**.

A no-consumer daemon with slow files ending at intervals shorter than its idle period can therefore stay up long after its explicit fast request ends. The registered-session unused stop also gets false use from those files.

Fix sized for one worker: register the files this explicit request actually selected, with its lane restriction, rather than the owner's whole checkpoint. Also cover an empty fast request while a slow baseline remains open. Keep checkpoint joining and the baseline's own result attribution unchanged.

### B2, proven: polling the phase loses an end when the file is re-queued

Location: `src/core/scheduler/request-progress.ts:35`.

Rule: the accepted amendment says “each end of a test file an explicit request queued ... is activity”; the brief requires the daemon to stop one idle period after the last such end. Styleguide: “Record a fact where it is known; never infer it later from something that does not prove it.”

The tracker saves a mutable `FileState` reference and counts only if a later timer poll sees `phase === null`. It saves neither a completion event nor the request's key. A real completion followed by a re-queue before that poll is invisible. The reference then remains eligible for a later completion of unrelated work at a different key.

Reproduction with the default lookup-only policy:

1. Start `openHarness()` on `createRepo()` and wait for idle.
2. Accept `requestGroupPaths("tests", ["test/math.test.ts"])`. It queues one file. Wait for idle and confirm `runsOf(path)` has one completed run. Do not poll `requestProgress()` yet.
3. Install a gate for that file's next run. Append a comment to the fixture's test file and call `h.batch(path)`.
4. Wait for that second run to reach the gate, then read `requestProgress()`.
5. Assert one end from the explicit request. Actual: **0**. Release the gate for cleanup.

The daemon can now measure idleness from the request's start instead of its completion. In a longer request, repeated completions followed by re-queues between polls can be missed while other requested files remain pending. Conversely, a later background completion can be counted as if the original request still owned it.

Fix sized for one worker: record and consume the request's end at the scheduler boundary that knows it happened. Do not reconstruct ends from the phase at polling time. Associate each outstanding ask with its requested work so a later background re-key cannot stand for it. Cover completion followed by re-queue before a read, and confirm the later background run adds no end for the finished request. Keep unknown/crashed terminal runs handled explicitly.

### B3, proven: a load-delayed retry has no progress registration when it finally queues

Location: `src/core/scheduler/scheduler.ts:773`.

Rule: the wave outcome explicitly includes `retry`: an accepted explicit request that keeps making progress must not idle-exit mid-request.

The new registration runs only in `requestRetries()`, after its immediate `takeRetries` call. A load retry can be accepted there while the load gate is closed, with no `retryKey` and nothing registered. The existing reconciliation path at `scheduler.ts:429` later claims and queues it, but never calls `#requests.ask`. The startup retry path at `scheduler.ts:371` also lacks this new registration.

Reproduction using `test/scheduler/retry-fixture.ts`:

```ts
const repo = flakyRepo();
const load = loadKnob(); // 16 on 8 CPUs
const store = openRepoStore(repo.commonDir);
const h = await openHarness(repo.main, store, repo.commonDir, options(load));
await failing(h);
rmSync(repo.marker);
ask(store, h, "review-load-retry", "load");
await h.scheduler.requestRetries();
expect(h.scheduler.requestProgress?.()).toBe(0);
load.set(1);
await pass(h); // reconciliation accepts and completes the deferred retry
expect(h.scheduler.requestProgress?.()).toBe(1); // actual: 0
```

That retry produces a real result, but the idle timer receives no progress. With several deferred retries completing across the idle period, a no-consumer daemon can still stop while the explicit retry work makes progress.

Fix sized for one worker: register explicit retry work where a retry is actually claimed and queued, shared by direct requests, interval reconciliation and startup. Keep waiting at a closed load gate as no progress. Add the deferred-load test above and a startup-pending-retry case.

## Should-fix

None.

## Nits

None.

## What fits

- The exact candidate and version are correct. The key-format test passed, and this range changes no key input or version constant. No key move was found.
- The direct group and whole-suite tests count their requested files once, including slow files for a whole-suite request. The counter is monotonic when polled after each completion and before another queue transition.
- Real timer tests pass for a no-consumer request progressing beyond the idle period, exit one period after the last observed end, baseline-only idle exit, and the accepted extension to the registered-session unused stop.
- The timer reads progress before its idle check. The daemon forwards the scheduler's count and tolerates schedulers without this optional method. No status or result provenance is changed by the diff.
- Defect 24's departure grace and session return, 004-29's bounded drain, 001-219's checkpoint drain, 011-163's slow-wait bound, and 001-415's unused stop retain their existing branches. Their focused tests pass. Progress changes `lastActive` and `lastUsed`; departure uses `presence.lastPresentAt`, and an active drain bypasses the unused check, so the new count does not move the departure/drain deadline.
- CI's Node 24 build and bundle checks pass on the exact SHA. Full-suite CI remains pending, not a review finding.

## Inputs for the repair wave

Repair B1 to B3 before another product landing. One scheduler repair row can own these related changes and their tests, with the daemon timer tests retained as contracts.

1. Register exactly the explicit request's files, including its lane and keys. A checkpoint owner can contain work outside the joined request.
2. Count a terminal end where it happens, before a later queue change can erase it. The idle timer should consume durable progress, with no new progress on a repeated read.
3. Register retries at their common claim/queue boundary, including startup and later reconciliation. Waiting, `ping`, baseline work and automatic re-runs still add no progress.
4. Preserve the existing timer order: read new request progress, then check idle/unused state. Leave departure grace and drain bounds based on departure time. The accepted registered-session extension still applies.
5. Add the three reproductions above as regressions. Include a new completion after a re-queue that belongs to background work, so neither losing nor inventing progress can pass. Verify no-consumer stop after the final requested end and after a stalled request.

No new runtime budget, deadline, key input or format version is needed. Keep targeted affected checks, lint and typecheck. Do not run a local full suite or local build for this repair brief. The coordinator needs completed exact-commit CI before release; this report supplies no full-suite pass.
