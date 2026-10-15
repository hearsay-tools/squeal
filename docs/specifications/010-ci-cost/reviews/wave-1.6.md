# 010 wave 1.6 narrow review

## Verification

Candidate: `cand/010-10`, `a2d4214bbd56087c9cab31a932fa0c63748e31d7`.
Range: `git diff 98fdca2e..a2d4214b -- .github test`.
Scope: 010-17, the 010-16 workflow route and the 010-15 N2 header correction. Earlier findings settled by `reviews/wave-1.5.md` are not reopened.

The dispatched worktree initially had `b3da96f58b731f2b2d4c03f1f0f463b324fbd50e`, one docs-only dispatch commit after the candidate. I detached at the exact candidate before dependency installation and every check below. The tracked and untracked tree was clean before verification and remained clean after the build and probes, before writing this report. No result from the initial HEAD is used as candidate evidence.

```text
$ git switch --detach a2d4214bbd56087c9cab31a932fa0c63748e31d7
HEAD is now at a2d4214b
$ git rev-parse HEAD
a2d4214bbd56087c9cab31a932fa0c63748e31d7

$ npm ci
added 196 packages, and audited 197 packages in 15s
found 0 vulnerabilities
(exit 0; node-domexception deprecation and install-script policy warnings)

$ npm run lint
> biome check .
Checked 1298 files in 1058ms. No fixes applied.
(exit 0)

$ npm run typecheck
> tsc --noEmit
(exit 0)

$ npm run build
> tsc -p tsconfig.build.json && npm run build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
(exit 0)

$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist plugins/pi/dist plugins/opencode/dist
(no output, exit 0)

$ npx vitest run test/version-sensitive.test.ts
Test Files  1 passed (1)
Tests       5 passed (5)
Duration    1.25s
(exit 0)

$ git status --short
(no output, before writing this report)
```

Under the explicit 010-17 brief, no full suite or Squeal checkpoint was required or run: the range changes no test code. The guard was run directly as this review's required independent check. This report claims no local full-suite verdict for the candidate.

### File selection probe

**Proven:** the installed Vitest 5.0.3 discovers 637 baseline files. The workflow's exclusion removes exactly `test/harness/opencode-dispose.test.ts`, and its standalone positional filter selects exactly that one file.

`vitest list --filesOnly --shard=<i>/3 --exclude test/harness/opencode-dispose.test.ts` lists all 636 remaining files for each `i`: `list` does not apply sharding. An initial probe that treated those lists as actual shard assignments failed its uniqueness assertion. That is a limitation of the probe, not duplicate execution in the workflow. I checked the installed runner's `createPool.executeTests`: it invokes the configured sequencer's `shard` method before executing the files. A corrected, read-only probe used `createVitest`, `globTestSpecifications` and that configured sequencer, without executing tests or changing config:

```text
baseline: 637 files, dispose: 1
shard 1/3: 212 files, dispose: 0
shard 2/3: 212 files, dispose: 0
shard 3/3: 212 files, dispose: 0
standalone: ["test/harness/opencode-dispose.test.ts"]
Coverage: 637 baseline files selected exactly once across all shards plus standalone;
no missing or extra files.
(exit 0)
```

The probe also asserted that the combined selection has no duplicate and equals the baseline set. Vitest appends `cliExclude` to the configured exclusions, so the existing `test/fixtures/**` and `node_modules/**` exclusions survive. No probe file or config change remains.

### Candidate CI

`gh run view 38792643283 --repo hearsay-tools/squeal --json headSha,status,conclusion,event,url,jobs` confirms a completed **success** push run of the exact candidate:
<https://github.com/hearsay-tools/squeal/actions/runs/38792643283>.

```text
headSha: a2d4214bbd56087c9cab31a932fa0c63748e31d7
status: completed
conclusion: success
```

**Proven by completed jobs and steps:**

| Job | Conclusion | Shard/subset Test | Dispose step | Job time |
| --- | --- | --- | --- | --- |
| Node 22 (1/3) | success | 386 s | skipped | 415 s |
| Node 22 (2/3) | success | 441 s | skipped | 467 s |
| Node 22 (3/3) | success | 380 s | success, 16 s | 425 s |
| Node 24 subset | success | 113 s | absent | 146 s |

The nightly and version jobs were skipped, as required for this candidate push. The four completed test jobs total **24.22 job-minutes**, excluding queue time. The longest shard Test step was 441 s; shard 3's two test steps total 396 s. Both remain below G3's nine-minute target in this run. This is one run, not 010-20's three-day measurement.

**Proven by completed job logs:** all three Node 22 jobs used v22.23.3 and executed the exclusion command. Only shard 3 logged the standalone command and its result. Read-only log retrieval used `gh api repos/hearsay-tools/squeal/actions/jobs/<id>/logs --allow-escape-sequences` for job IDs `116620857069` (1/3), `116620856988` (2/3), `116620857008` (3/3) and `116620856560` (Node 24).

```text
Node 22 (1/3), shard Test:
Test Files  211 passed | 1 skipped (212)
Tests       1751 passed | 8 skipped (1759)
Duration    385.09s

Node 22 (2/3), shard Test:
Test Files  212 passed (212)
Tests       1794 passed | 2 skipped (1796)
Duration    440.03s

Node 22 (3/3), shard Test:
Test Files  212 passed (212)
Tests       1799 passed | 5 skipped (1804)
Duration    379.74s

Node 22 (3/3), separate step:
$ npx vitest run test/harness/opencode-dispose.test.ts
✓ test/harness/opencode-dispose.test.ts (3 tests) 14124ms
Test Files  1 passed (1)
Tests       3 passed (3)
Duration    14.86s

Node 24 subset, on v24.21.0:
Test Files  70 passed (70)
Tests       444 passed | 2 skipped (446)
Duration    112.64s
```

The API timestamps place the standalone step at 19:26:51 to 19:27:07 UTC, immediately after shard 3's Test completed at 19:26:51. The 16 s step wall time includes command overhead; Vitest reported 14.86 s, of which the file's tests took 14.124 s. Shards 1 and 2 mark that step `skipped`. No failure or cancellation path was exercised in this successful run; those paths are verified below by the expression and GitHub's documented semantics.

## Verdict

**PASS a2d4214bbd56087c9cab31a932fa0c63748e31d7**. Zero blockers, zero should-fix items, zero nits. The 010-16 workflow route conforms to amended D5, the candidate CI is green, and the 010-15 N2 header nit is closed.

## Blockers

None.

## Should-fix

None.

## Nits

None. The 010-15 N2 header nit is closed.

## What fits

- **Proven, D5 coverage:** `.github/workflows/ci.yml:53` applies the same exact file exclusion to all three Node 22 shards. The separate command at line 60 contains no shard or exclusion argument. Together they preserve the entire baseline selection exactly once on Node 22.
- **Proven, D5 sequencing:** the separate step follows the shard's synchronous `vitest run`; it has no parallel background command. It shares a job only with shard 3, so it starts after that shard's tests and teardown finish. The separate GitHub jobs run on their own runners.
- **Proven by source and documented expression semantics, failure and cancellation handling:** line 59 uses `${{ !cancelled() && matrix.shard == 3 && steps.test.outcome != 'skipped' }}`. `cancelled()` is a status check function, which suppresses GitHub's implicit `success()` check. Thus either `success` or `failure` from the completed Test step allows the separate step on shard 3; a skipped Test step or cancellation forbids it. No `continue-on-error` was added, so a failed shard stays failed even if the separate test succeeds. GitHub documents both the implicit status check and `!cancelled()` for steps that should run after success or failure: <https://docs.github.com/en/actions/reference/workflows-and-actions/expressions#status-check-functions>. Failure and cancellation paths were not induced by mutating or rerunning CI.
- **Proven, narrow route:** no other Node 22 step, matrix setting, job condition, Node 24 job, nightly job or trigger changed against `98fdca2e`. Build and bundle comparison still belong to shard 1. In particular, the scheduled Node 24 full-suite command has no exclusion, and retains this test.
- **Proven, barrier preserved:** no test source, helper or product source changed in this range. The test's 2,000 ms deadline and barrier retain their meaning. This is the workflow route accepted in amended D5 and `status.md`, not a product fix for the loaded-machine idle deadline.
- **Proven, N2 closed:** `test/version-sensitive.txt:43` now says only “drive timers. Node 22 only.” The obsolete run-cell exit-code exemption is gone. The actual exemptions and selection entries are unchanged; `evals/run-cell` remains selected on Node 24, consistent with lines 77 to 82. All five guard tests pass.

## Inputs for the next wave

- Retain the global shard exclusion and the single shard-3 step together when changing this layout. A missing half either drops coverage or reintroduces the loaded shard overlap.
- The spec 008 question about the product's idle deadline on loaded machines remains a separate board item. This review does not resolve it or reopen prior review conclusions.
- The first main landing's `version` range, the first actual nightly and 010-20's three-day measurements remain coordinator follow-up under the existing spec.
- No GitHub mutation, rerun or push was made. The coordinator owns integration and landing.
