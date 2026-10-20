# Review of cand/0.1.231: format 20

Candidate: `8b8673e72c25d0ca06d9225c1057dfdd645b2070`.
Base: `8fd70776` (`squeal--v0.1.230`).
Range: `8fd70776..8b8673e7`, rows 011-26 and 011-27, the format raise, review brief and release bundles.

## Verification output

The worktree started at the pinned SHA and stayed clean throughout verification. No product code was changed for this review. The throwaway reproduction lived outside the checkout. `npm run build` was deliberately not run, per the review assignment. Its standalone result is unverified, not a blocker; bundle drift is exercised by the independent suite's four plugin tests.

```text
$ git rev-parse HEAD
8b8673e72c25d0ca06d9225c1057dfdd645b2070
$ npm ci
added 196 packages, and audited 197 packages in 7s
found 0 vulnerabilities
$ npm run lint
> biome check .
Checked 1541 files in 460ms. No fixes applied.
$ npm run typecheck
> tsc --noEmit
```

All three commands exited 0. npm also printed its install-script allowlist warnings for six packages.

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
 FAIL  test/harness/opencode-dispose.test.ts > a report held while dispose meets newer input > serve: an abort of the new turn, then the old Stop's answer, stores nothing
Error: before the new turn's request, the plugin killed the held Stop at +2290, at or after its idle deadline (+2000)
marks, ms since the first idle: idle +0, stop +76 (pid 785478), dispose +129, input +975, kill +2290 (pid 785478); the held Stop's deadline: +2000
  at test/harness/opencode/held-stop.ts:210:27
  at test/harness/opencode-dispose.test.ts:172:9
  notice: attempt 1 of 3 missed its barriers at +2006; attempt 2 at +2002

 Test Files  1 failed | 777 passed | 1 skipped (779)
      Tests  1 failed | 6622 passed | 10 skipped (6633)
   Start at  18:25:37
   Duration  1062.17s (tests 98%, import 2%)
```

Exit 1. This is the single independent full run, over the unchanged pinned candidate, on Node 24.21.0. The lock was held throughout. It started at 16:25:36 UTC with one-minute load 5.55 and ended at 16:43:19 UTC with load 21.32; sampled load reached 69.91 during the run. The failing file was first observed at load 36.54, not a measurement of the exact instant of its failure.

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run test/harness/opencode-dispose.test.ts --maxWorkers=4
 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  18:43:48
   Duration  15.54s (tests 96%, transform 3%, import 1%)
```

Exit 0. This was the only failed file and the only isolated rerun. Its one-minute load was 14.69 at the start and 14.52 at the end. Thus `test/harness/opencode-dispose.test.ts` failed in the loaded suite and passed alone. The failure is the held-Stop timing/barrier miss already named in 011-27's notes; this candidate changes no OpenCode disposal logic or test. It is not attributed to either row.

`test/daemon/handover.test.ts:72` did **not** fail here. `test/scheduler/backlog-slots-overhead.test.ts`, the earlier coordinator gate's failing file, also passed. All changed tests, `test/cli/wait-reads.test.ts`, the four bundle-drift tests, the key-format guard and `test/keys/validity/compare.test.ts` passed in the full run. The validity comparison accepts the explicit raise from the last release's 19 to candidate 20; its green result does not prove coverage of the changed unknown-meta lines, as the brief explicitly assigns to 011-41.

Separately, Squeal's background baseline reported `test/daemon/vacant-wait.test.ts` and the teardown of `test/policy/repository-inputs.test.ts` failing, then both recovered at the same inputs. Both passed in the independent run. These background reports do not replace that run's evidence.

## Verdict

**FAIL**: 1 proven blocker, 0 should-fix findings, 0 nits. Verification limitations and unrelated test failures are kept separate below. The blocker is the new command guidance's behavior from a subdirectory, not the retry CLI's existing path-resolution rule.

## Blockers

### B1. Proven: the new retry hints do not reach the selected file from a subdirectory

Locations: `src/core/status/next-step-text.ts:59`, with its root-relative inputs from `src/cli/named-file-lines.ts:83`, `:126` and `:229`; `src/cli/retry.ts:141` resolves arguments against the caller's cwd.

Contract: 011 C15 as amended 2026-10-20 and 011-24 design section 3 require that "every selected file without a verdict names the command that advances it". R2 includes stale and never-run files and places each file's own command in JSON. The existing cwd resolution is also the premise of gh-39's unmatched-path change.

Reproduction, using the candidate's real `selectNamedFiles`, `readNamedFiles`, `classLines`, `fileEntry` and `retryCommand` over a temporary store:

1. List and key `tests/a.test.ts`, with no result and nothing queued. Record a live daemon and a revision.
2. From `<root>/tests`, select `a.test.ts`. It correctly selects `tests/a.test.ts`.
3. Render its next step and invoke the printed retry from that same cwd.

```text
Selected from tests/: [{"project":"","path":"tests/a.test.ts"}]
Unknown (1):
  1 never run at its inputs, nothing queued it: tests/a.test.ts; `squeal retry tests/a.test.ts` runs it once
JSON command: squeal retry tests/a.test.ts
Following hint:
  exit 1
  Not retried: tests/tests/a.test.ts is not a test file Squeal has keyed in this worktree.
```

No run is queued for the selected file. The same root-relative argument construction feeds the verdict line's group and all retry standings, including stale and timed-out files. The worker's notes item 4 acknowledges the mismatch and suggests R3, but neither the accepted amendment nor this row's brief defers usable command arguments to R3. This fails R2's present contract.

Fix sized for one worker: give the command renderer enough root/cwd context to emit arguments that resolve to the selected files from the invocation directory, or emit absolute arguments. Keep display paths and the no-fallback selection rule as they are. Apply the same argument rendering to class lines, verdict groups and each JSON entry. Add a regression that starts below the root, follows the emitted command, and asserts that the selected file/key gets the request. Cover at least a never-run and stale file, and retain the existing root-cwd cases. This needs no scheduler, key or result-row change.

## Should-fix

None.

## Nits

None.

## What fits

- R1 uses one `notCurrentText` for status, registration, Stop's status and news paths, and both waits' final worktree clauses. The three additive JSON fields survive the `snapshot.ts` seam. `fileClassOf` moved unchanged to the accepted `core/state` location, so header and named verdict classification share one rule. `test/status/not-current.test.ts` seeds no-check files, a re-keyed file still held by an open run, slow files and failed-setup files. It also checks liveness, listing and runner-part guards on `all N test files current`.
- R2 has seeded tests for design section 3's rows across `next-step-rows`, `next-step-pending`, `status-wait-reasons`, `pending-retries`, `checkpoint`, and the pure `next-step` tests. These prove the root-cwd guidance but miss B1's follow-the-command case. The stale-file/live-claim order is explicit before the stale/unknown mapping and has a regression. Counted failures remain refused without `--reason`; stale, never-run and timed-out files can request a no-result run without a reason.
- The global-setup probe's conclusion is supported by the adapter and store: the CLI has no normal per-project list of setup inputs, so the running slow-file warning names a setup only when a setup check has recorded it. The single-file retry hint remains. The scheduler records structured timeout, install, runner and setup causes. Old records without a cause get the generic step; an unrecognized cause is dropped while its reason is retained.
- The shared files retain both rows' intent: `status-wait-lines.ts` has R1's worktree clause and R2's unmatched/settled reason groups; `format-status.ts` has the not-current clause and retry timing; `snapshot.ts` supplies live open runs to both counts and retries; `types/status.ts` retains both additive shapes; `status.test.ts` retains the count pins and cause field.
- The `status-wait-paths.ts` delta enriches only unmatched-path metadata and rendering. It does not add a root fallback or change the valid-closure selection rule; 011-44 still owns its closure-read cost. `readNamedFiles` runs at the final snapshot. The added header counts reuse the states and keys already supplied by their callers, adding no store read to a poll. 011-42's read-budget test passed in the independent suite.
- `test/evals/evidence-squeal.test.ts` feeds the real status, registration, news and Stop formatters into the parser, plain and wrapped as hook JSON. It also reads each real wait formatter's final verdict line alone, so the new clause is exercised without `Affected checks` above it. The parser retains the earlier header/status paths and guards incomplete listing/refinement counts.
- Format 19 can be read as 20. R1 adds derived header counts and presentation; moving `fileClassOf` does not alter the existing classification rule. It changes no key, acceptance decision or stored result. R2's scheduler delta adds `cause` only to the per-worktree unknown-files meta record; its reader and presentation use that cause, but keys and result rows do not. The retry CLI change explicitly authorizes an existing no-result request path; it does not reinterpret a cached result. The format raise satisfies the interim source guard, while the read-as-one entry preserves the prior release's result meaning. The changed-line coverage gap in `scheduler/unknown-files.ts` and `ledger.ts` `markUnknown` remains the explicitly assigned 011-41 work, not a blocker in this bundle.
- R3/R4's short status, `--full`, snapshot form and `Outstanding:` integration are later board rows. Their absence is outside this candidate's assigned scope.

## Inputs for the repair and next wave

Repair B1 before landing this bundle. Preserve `fileClassOf`, the three header fields, claim-before-retry ordering, optional reasons only for no-result runs, and unmatched-path selection behavior. Do not add any full-worktree state read to a wait poll. Re-review the command-rendering delta and its follow-the-command regression.

For R3/R4, reuse `nextStep` and the single not-current formatter. Carry invocation context to every command-producing surface, including JSON. Keep the setup-list limitation explicit. 011-41 still needs validity-corpus cases for the structured unknown meta rows; it must not treat the present format raise as that coverage proof.
