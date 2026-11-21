# Wave 20 third review

FAIL `8d69025d84f1e057505c55278a32097538347bb9`: **one proven blocker remains, B8**. B4 is closed by the human's amended design and independent completion witnesses. N2 is closed. The held-intake B8 witness now passes, but a mixed current/queued request still applies cleanup to a later ordinary run.

Reviewed `bff830405..8d69025d8`, bounded by `2849c80cb:docs/specifications/023-results-at-commit/reviews/wave-20-rereview.md` and the parent's third-look brief. Fetched and checked out the candidate detached; HEAD matched. Used the reviewer skill. Read the prior findings, repair delta and D4.11 amendment at `e390dd466`. The actual rebased repair commits are `dd6759310` (B4), `aeb3690d7` (B8) and `89dc31162` (N2). Generated bundle content was excluded.

## Verification

| Command or evidence | Actual result |
| --- | --- |
| Dependency setup | Used installed dependencies; no install repeated. |
| `pnpm run lint` | Exit 0: 3,947 files checked. Existing unrelated `noProto` warning and two literal-key infos. |
| `pnpm run typecheck` | Exit 0, no diagnostics. |
| `pnpm run build` | Exit 0, all four plugin builds; no tracked change. |
| `pnpm run check:private` | Exit 0: `13801 added lines in 117 files over bc30db2a6b0537c89ba12ba7c6a2d50ef1026a24, ok`. Empty private denylist warning. |
| Installed `squeal checks` | Default tests, 2,092 files; excludes e2e, typecheck and build. |
| Clean targeted command below | Exit 0: **16 files, 102 tests passed**, 76.68 s. |
| Final focused installed `squeal status --wait 60000` | Exit 0 at revision 30: five named files each current, no known failures. Only this review file was untracked. Worktree: 41 of 2,092 files not current (1 running, 39 queued, 1 unknown). No whole-worktree pass is claimed. |
| Exact-candidate CI | [CI 44912382428](https://github.com/hearsay-tools/squeal/actions/runs/44912382428) remained in progress at the last read. Full-suite evidence is unverified. [Private material 44912382545](https://github.com/hearsay-tools/squeal/actions/runs/44912382545) passed. |
| Benchmark comparison, process 6c | Unverified: no base/candidate comparison supplied. This is not a blocker. |

Direct tests used explicit paths and the required timeout and worker limit. The task calls for independent witnesses; affected evidence was also incomplete. No full suite ran. `squeal.config.json` stayed unchanged. All throwaway probes were removed before the clean run. Builds and probe removal left the candidate tree clean.

```sh
timeout 600 pnpm exec vitest run --maxWorkers=2 \
  test/cli/status-at-run-cold.test.ts \
  test/cli/status-at-run-give-back.test.ts \
  test/cli/status-at-run-units.test.ts \
  test/cli/status-at-run-marks.test.ts \
  test/cli/status-at-run-unkept.test.ts \
  test/cli/status-at-run-batches.test.ts \
  test/cli/status-at-not-selected.test.ts \
  test/cli/status-at-report-files.test.ts \
  test/cli/status-at.test.ts \
  test/scheduler/take-back-flags.test.ts \
  test/scheduler/take-back.test.ts \
  test/daemon/run-group-paths-at.test.ts \
  test/daemon/run-groups-watch.test.ts \
  test/keys/key-format.test.ts \
  test/version-sensitive.test.ts \
  test/runners/boundaries.test.ts
```

The final Squeal wait named `status-at-run-cold.test.ts`, `take-back-flags.test.ts`, `run-group-paths-at.test.ts`, `key-format.test.ts` and `version-sensitive.test.ts`. Temporary node:test probes caused a version-sensitive-list failure; their removal restored that check. The expected mixed-request probe failure disappeared when its file was removed. Neither is an unexplained clean-candidate failure.

## Prior findings checked

| Finding | Third-look result |
| --- | --- |
| B4: false cannot-fit refusal | **Closed.** The human amended D4.11: “No call is refused before running”; it runs to its budget and gives back work not started. Both independent witnesses below now compare all 16 files using default `--run`. The refusal branches and first-batch guard are removed. |
| B8: cleanup applied to ordinary run | **Still open.** The original held-intake cancellation now passes, including the real scheduler witness. Mixed current/queued selections still leave a cleanup flag on a file the request did not queue; see blocker 1. |
| N2: missing node:test recorder validity coverage | **Closed.** The added marked-recorder case exercises sync and async spawn with custom environments. `key-format.test.ts` passes in both the probe run and clean run; Squeal also reports it current and passing. |

For B4, both end-to-end witnesses use an empty-store git fixture, coverage off, and 16 node:test files importing a changed source. Parent `availableParallelism()` is mocked to 2, giving width one; the child uses `--test-concurrency=1`. Both calls use `parseAt(["--at", base, "--run"])`, with the default 300-second budget and no override. One fixture has all fast files. The other gives only the first file a 21-second wait. Both return code 0 with `16 unchanged, 0 unknown`. Neither reports a refusal or stops after its first batch. These are the two earlier B4 failure shapes.

For held-intake B8, hold `runner.affected()` during a flagged source request with owner `third-late`. Perform the daemon's order: `requests.takenBack([owner])`, then `scheduler.takeBack([owner])`. Release intake. The answer has `queued:0`, take-back counts are all zero, no run starts, and `requests.flagged([file])` is false. The new tombstone and zero-queued filter close this witness.

The first independent command ran the two probe files plus `key-format`, `take-back-flags` and `run-group-paths-at`: **27 passed, 1 failed**, 80.79 s. Only the mixed-request assertion failed. Extending that witness to actual process cleanup produced **1 passed, 1 failed**, 3.10 s: held-intake passed; the ordinary run was wrongly recorded. These failures establish the remaining blocker.

## Remaining blocker

### 1. B8: a mixed request flags a current file and later stops its ordinary run's child — proven

**Locations:** `src/core/daemon/run-groups-watch.ts:116`–119 and `:155`–165; `src/core/scheduler/narrow-run.ts:251`–265 and `:295`–313; `src/core/scheduler/covered-files.ts:25`.

T3 permits cleanup for runs started for a flagged `--run` request. B8's repair requires flags only for accepted work. `flagAccepted` checks the aggregate `queued` count, then flags every selected ref absent from `narrow.notRun`. A current file is absent from `notRun` too: `coveredOf` returns `state:"current"`, while `notRunOf` includes only `state:"not-queued"`. A positive queued count for B therefore flags already-current A. No run consumes A's flag until a later edit makes A run for an ordinary request.

**Independent witness:** use the real scheduler with two manual-group files A and B, each importing its own source. A fake runner controls completion; the flags, `withRunGroups`, token recording and `stopRuns` are unchanged product code.

1. Run A normally to make it current. Leave B unknown.
2. Submit flagged `[A,B]` with owner `mixed`. The actual response is `queued:1`, `narrow.current:1`, `narrow.selected:[A,B]`, `narrow.notRun:[]`. Both files are now flagged, although only B was accepted for running.
3. Hold B running. Edit A's source and submit an ordinary request for A, with no `at` or owner. Release B, then A.
4. In A's ordinary runner call, start a detached sleeping Node process with `env:runOptions.childEnv`, representing a test-started server. The stale flag marks this ordinary run. Real cleanup records the run and sends the server SIGTERM. Its process stat is then absent.

Observed output:

```text
ordinary run c88f3910-1419-4231-942a-bb59f8ba637c recorded true server 2669822 live null
stopped 1 process a `--run` run started: 2669822 ... SIGTERM, run c88f3910-1419-4231-942a-bb59f8ba637c
```

The probe supplies `workers: () => () => false`: its adapter runs inside the test process, so the detached child represents test work rather than a daemon runner worker. Actual token injection, process identity checks, recording and termination run unchanged. This proves the scheduler/daemon boundary and its process consequence. A full CLI race fixture was not run. The CLI's missing-file snapshot can become partly current before daemon intake; the scheduler interface must handle that response safely.

**Repair sized for one worker:** carry the actual per-file accepted queued/running refs from the scheduler decision into cleanup registration. Aggregate `queued` plus `selected` minus `notRun` cannot identify them. Keep the one-hour take-back tombstones and the held-intake fix. Add this mixed-current control through a subsequent ordinary run, while retaining cleanup for B. Do not discard the entire mixed request or clear a token from work already running.

## What fits and next-wave inputs

Keep B4's removal of refusal logic, its default-budget execution and give-back behavior. Keep the held-intake cancellation and N2 validity case. B1–B3, B5–B7 and N1 remain settled by the prior review; this narrow delta did not reopen them. No additional product regression was established outside the remaining B8 case.

Dispatch B8 to the scheduler/daemon accepted-work owner. The deciding contract is per-file acceptance at intake, followed by daemon flag registration; the current-file state must survive that boundary. Supply exact-candidate CI and the missing benchmark comparison before release. This review does not claim either passed.
