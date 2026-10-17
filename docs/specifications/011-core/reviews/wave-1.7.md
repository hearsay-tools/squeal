# Wave 1.7 narrow re-review: cand/0.1.205

PASS `74f8ee466a5de85c8e61ab87a527edda575645af`: 0 blockers, 0 remaining should-fix items, 0 new notes or nits. Wave 1.6's S1 is resolved.

## Verification

Second and final round, bounded by `reviews/wave-1.6.md` on `origin/main`, which passed `6cf206037eba171a8ca8328cff7b86cacb139f36`. Reviewed only `6cf20603..74f8ee46`: documentation commit `9a262d5f` and fixture-identity commit `74f8ee46`. No previously settled product behavior was re-opened.

The following checks ran independently on the pinned candidate with a clean tracked tree, before this findings file was added:

```text
$ git rev-parse HEAD
74f8ee466a5de85c8e61ab87a527edda575645af

$ npm ci
added 196 packages, and audited 197 packages in 7s
found 0 vulnerabilities
exit 0

$ npm run lint
> squeal@0.1.205 lint
> biome check .
Checked 1372 files in 464ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.205 typecheck
> tsc --noEmit
exit 0

$ npm run build
> squeal@0.1.205 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.205 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
exit 0

$ git diff --check 6cf20603 HEAD
(no output)
exit 0

$ git status --short
(no output)

$ git diff --name-status 6cf20603 HEAD
M docs/specifications/011-core/spec.md
M docs/specifications/011-core/status.md
M docs/specifications/013-vitest-runner/spec.md
M docs/specifications/013-vitest-runner/status.md
M test/scheduler/withheld-touch.test.ts
```

`npm ci` printed the existing `node-domexception` deprecation and six install-script coverage warnings. The build produced no tracked bundle drift.

No independent full suite or Squeal checkpoint was repeated, as explicitly permitted by this narrow dispatch. Wave 1.6 records the independent full run on `6cf20603` (680 files passed, 1 skipped; 5,797 tests passed, 9 skipped). The coordinator reports that the touched areas on this candidate passed with HOME and GIT_CONFIG_GLOBAL/SYSTEM pointing at nothing (155 files, 936 tests), and that the old fixture failed there with the same missing-author error as CI. Those are supplied results, not a local test run in this re-review.

At `2026-10-17T08:37:11Z`, `gh run view 39017961394 --json status,conclusion,headSha` confirmed the exact candidate SHA, `status: in_progress`, and an empty conclusion. [CI run 39017961394](https://github.com/hearsay-tools/squeal/actions/runs/39017961394) is therefore pending evidence, not a passing gate claimed by this review.

## Blockers

None proven. The prior round had none to re-verify.

## Should-fix

None remaining. S1's documentation follow-up is resolved by `9a262d5f`:

- **011 C4, proven against source:** runner-withheld files are discarded and re-queued under the existing consecutive-discard limit, becoming `unknown` with the runner's reason on exhaustion. `src/core/scheduler/tiers.ts:443` takes this path before result storage; `src/core/scheduler/ledger.ts:399` counts unchanged-key discards and stops at `MAX_DISCARDS` (3). C4 retains the stable-input storage rule. The separate completion-barrier retry accounting is unchanged.
- **011 C4 cancellation, proven against source:** the amendment names queued edit work in the tier's lane and changed tier inputs. Adds and deletes alone no longer cancel: runner refinement must queue edit work in that lane. `src/core/scheduler/backlog.ts:25` checks those conditions; `src/core/scheduler/scheduler.ts:84` repeats the check after runner refinement. Unread build outputs therefore let the backlog finish.
- **011 C14 and 013 V5, proven against source:** `RunReport.withheld` is documented as completed files whose results were withheld. V5 says they are excluded from completion, no results from the touched run are stored, and retries consume the discard budget. `src/core/types/runner.ts:361` states that contract; `src/runners/vitest/moved.ts:101` removes the dropped completed files and their result data. The self-writer paragraph now names exhaustion rather than immediate terminal `unknown`. Both owning status logs record dated amendments.

## Notes and nits

None. Pending CI is a verification limitation, not a finding against this diff.

## What fits

- **Fixture repair, proven by exact diff and helper:** `74f8ee46` changes only the existing fixture commit to `git -c user.name=t -c user.email=t@t commit -qm held` (`test/scheduler/withheld-touch.test.ts:56`). `test/watcher/helpers.ts:16` passes those arguments directly to Git. The identity applies to that command; setup order, fixture contents, scheduler policy, assertions and all three test cases are unchanged.
- **Scope, proven by range diff:** exactly four documentation files and the one test file changed, totaling seven insertions and five deletions. No runtime source, bundle, version, dependency or other file changed since the prior PASS.

## Inputs for the next wave

No repair wave is required by this re-review. Preserve wave 1.6's storage, retry and lane boundaries. The coordinator still needs the candidate's CI conclusion for its landing decision; this verdict does not assert that pending CI has passed.
