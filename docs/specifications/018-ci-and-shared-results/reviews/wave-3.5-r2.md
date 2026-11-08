# Wave 3.5 re-review: record compatibility and fast-lane verdict

## Verification

Candidate: `2b7ae252c4ccf79783ea21127298e14909dcbe49` (`cand/0.1.418`).
Range: `4e9117fb6..2b7ae252c`. Prior findings: `reviews/wave-3.5.md`, read first.
Scope: B1 and S1, their repair delta, and new row 018-11. Earlier settled provider behavior was not re-reviewed.

| Command or check | Actual result |
| --- | --- |
| `git fetch origin cand/0.1.418`; `git checkout --detach 2b7ae252c4ccf79783ea21127298e14909dcbe49`; `git rev-parse HEAD` | Exact requested SHA. |
| `git status --short` before and after verification | Empty. |
| Dependencies | Retained from the prepared worktree. No separate setup requested or repeated. |
| `pnpm run lint` | Exit 0. `Checked 2877 files in 1377ms. No fixes applied.` |
| `pnpm run typecheck` | Exit 0. `tsrs --fast --noEmit`; no diagnostics. |
| `git diff --check` | Exit 0. |
| Squeal focused wait, listed below | Exit 0 at revision 3, candidate `2b7ae252 + 0`: `9 test files, each with a current result`; no known failures. Worktree still had 174 queued files, 975 queued tests. This is affected evidence, not a full-suite pass. |
| Bundle checks | All four providers equal the source byte for byte. All four CLI bundles contain key version 3 and record version 4. The coverage-map worker bundle uses record version 4 for both mapping paths. All Codex runtime manifest SHA-256 hashes match their files. No build was run. |
| Disposable before-fix experiment, described below | Three expected assertion failures: escaped provider output, manual-group verdict, and manual-group start count. After teardown, no escaped file remained in the disposable checkout root. |

Focused command:

```sh
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 \
  test/code/crap/record-version.test.ts \
  test/runners/vitest/own-provider-mocks.test.ts \
  test/cli/run-lanes.test.ts \
  test/code/prune.test.ts \
  test/keys/key-format.test.ts \
  test/reach/command.test.ts \
  test/code/coverage/parts.test.ts \
  test/code/coverage/writer-worker.test.ts \
  test/daemon/handover-tier.test.ts
```

The first wait timed out while the daemon's heartbeat was late. It recovered. A broader second selection had eight current passes and `test/scheduler/run-lanes.test.ts` waiting on the parent's shared-key run; that scheduler file was still unverified at that read. The final nine-file selection above returned current results. No duplicate local candidate suite was run while Squeal validated it.

CI: [run 42494177395](https://github.com/hearsay-tools/squeal/actions/runs/42494177395), exact candidate SHA. At the last read, all three Node 22 shards were `in_progress`; the Node 24 lint/typecheck/version-sensitive job had completed with `success`. The version-bump and nightly Node 24 full-suite jobs were skipped. Full-suite CI is pending, not passing evidence. No local full suite or build was run, as instructed. Build reproducibility remains unverified locally. These limits do not constitute findings.

## Verdict

**PASS**. B1 resolved under the human's option A. S1 resolved. New row 018-11 passes review.
Zero blockers, zero should-fix findings, zero nits. No new plausible findings.

## B1: resolved by separating record compatibility from result keys

The human's choice is recorded in `status.md` and the R1 brief: "A: drop coverage only."
`src/core/code/coverage/record.ts:33` keeps `COVERAGE_PROVIDER_VERSION = 3`; line 41 adds `COVERAGE_RECORD_VERSION = 4`. Its comment states the separate rules.

The full record path uses version 4:

- `coverage/writer.ts` stores records at result key plus record version.
- `coverage/mapper.ts` and both branches of `coverage/map-worker.ts` pass record version 4 into `shareRecord`; `coverage/parts.ts` includes that version in each part's hash.
- `crap/loaders.ts` asks for stored time at record version 4. `crap/cache.ts` reads only version 4. `crap/step.ts` compares and writes the summary's version as 4, so a version-3 summary triggers seeding again.
- `core/reach/read.ts:133` reads version 4 too. It returns no record when that key/version pair is absent.
- `code/store/coverage.ts` continues to require the explicit composite key. The legacy `providerVersion` field and SQLite `provider_version` column now carry the record version; no schema migration is needed.
- `code/store/prune.ts` removes versions below 4 in both prune modes, even when their result key is retained. It preserves a newer record version subject to the existing retention/result-key rules. Parts lose their old manifest references and follow the existing part retention rule; the new versioned hashes prevent part identity from crossing the boundary.

A source scan found no product coverage reader or writer still using the key version. Its only executable consumers outside the constant's declaration are the Vitest and node:test environment markers. Lint's separate provider-version fields are unrelated.

`record-version.test.ts` stores a version-3 record at the same passing result key. The loaders report pending for the record, then unknown with `no-record`; the step cache returns null. Its control stores the same data at the current version and reads it successfully. The prune regression removes the old record under both prune modes and keeps the current one. These files have current passing Squeal results.

The URL-only fixture is separate from filesystem stubbing now. It asserts covered lines `[5,6,11,13]` and compares the complete math-source record, including function spans, with the equivalent test body without URL mocking. This regression also has a current pass.

`test/keys/key-format.test.ts`, both runner environment markers, and the key-version constants are unchanged. The key-format alarm has a current passing result. Option A therefore drops old coverage without changing test-result keys. A result can remain current while coverage is pending or unknown until another local run; that is the approved behavior.

## S1: resolved, including the failing path

`test/runners/vitest/own-provider-mocks.test.ts:90` identifies escaped root entries using the unique basename of this run's coverage temp directory. The test registers cleanup before opening the fixture and asserts the escaped set is empty before checking payloads. Cleanup removes this run's entries on failure too. It does not change the parent process's working directory.

Independent experiment in a disposable candidate archive:

1. Link the installed dependencies. Restore only `src/core/code/coverage/provider.mjs` and `src/cli/run-lanes.ts` from `e9eba1e36`.
2. Run `node node_modules/vitest/vitest.mjs run test/runners/vitest/own-provider-mocks.test.ts test/cli/run-lanes.test.ts --maxWorkers=1` with Node 24.22.1 and the disposable root as the working directory.
3. The provider test fails at line 116 because one escaped `\tmp\...\coverage-<uuid>.json` entry exists. After the command finishes and teardown runs, listing root names that start with a backslash returns `[]`.

The two files report `3 failed | 4 passed (7)` as expected with those old implementations. The main review worktree remains clean. The disposable archive and its probes were removed before this report's commit. Candidate green evidence is the Squeal result at the clean candidate, not the altered archive.

## New row 018-11: daemon and command select the same fast lane

`src/cli/run-lanes.ts:56` now reads the worktree policy and calls `scheduler/slow.ts`'s `slowView(...).isSlow`. `Scheduler.requestFullSuite` uses the same function when it gives `queueFullSuite` its lane filter. Both filter on `isSlow(ref) === (lane === "slow")`. A configured manual browser group is therefore outside the fast checkpoint and outside its verdict.

All three CLI consumers use the same `laneFiles`: the start line's already-current count, the hold read, and the final verdict. Existing both-lane behavior returns null from `laneFiles`, and `run --slow` retains its group command route.

The new CLI tests cover a completed fast checkpoint with one current fast file and one unknown manual-group file, then a start line with one pending fast file and one current manual-group file. Candidate results pass. In the disposable before-fix experiment:

- The verdict incorrectly includes `test/browser/c.test.ts` and says `has no verdict: 1 test file without a current result`.
- The start line incorrectly says `1 test file to run, 1 already current` instead of zero already current.

Thus both tests discriminate against the reported defect. The existing lane-routing assertions pass even under that old implementation; the failure is specific to manual-group classification.

`core/state/slow.ts` changes only its comment. Its remaining `worktreeSlowView` callers are `cli/status-wait-slow.ts` and `core/status/slot-holders.ts`; their behavior is unchanged. Slow-tier status still counts the default slow group rather than every configured group.

The deviation from reading the checkpoint's recorded file list is explicit in `status.md`: that list holds queued work, whereas the verdict also needs files already current. Reusing the daemon's classifier covers both. The known duplicate group rules and the fast-lane explanatory text are recorded follow-ups, not new findings in this review.

## Inputs for the next step

No repair wave is required by this review. Keep the two version constants separate: record consumers use 4; environment markers keep 3 unless test outcomes require a key change. Preserve the single daemon lane classifier for both verdict and start counts. Do not substitute the checkpoint's queued list for all eligible files.

The candidate still needs its exact-commit CI result before release. The previous candidate's handover failure is not reproduced by this candidate's current Squeal result for that test; a passing result does not prove that an intermittent failure cannot recur. This review makes no full-suite or release claim.
