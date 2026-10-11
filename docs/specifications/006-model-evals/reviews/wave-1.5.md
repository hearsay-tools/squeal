# 006 wave 1.5: re-review of 006-05 and 006-06

Candidate checked: `1f95673f5aaf921d418000dbe0f463d63a4892a3`. Range: `aa8a5dc4^..1f95673f`. Board row: 006-07. Prior findings: `wave-1.md`. Second round on this slice.

## Verification

The initial checkout was `c74d30ae`, beyond the range. Checks and probes ran on the clean tracked tree detached at the requested candidate `1f95673f`. The reviewer returned to `cez/0a553e1b` to commit this report alone. No board, spec, product or test file was edited.

```text
$ git rev-parse HEAD
1f95673f5aaf921d418000dbe0f463d63a4892a3
$ npm ci
added 56 packages, and audited 57 packages in 1s
found 0 vulnerabilities
exit 0
$ npm run lint
Checked 821 files in 284ms. No fixes applied.
exit 0
$ npm run typecheck
tsc --noEmit
exit 0
$ npm run build
tsc -p tsconfig.build.json && npm run build:plugin
tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
exit 0
$ git diff --exit-code
exit 0 (no bundle drift)
$ npx vitest run
Test Files  5 failed | 361 passed | 1 skipped (367)
Tests       5 failed | 2685 passed | 10 skipped (2700)
Duration    292.11s
exit 1
$ node --disable-warning=ExperimentalWarning <installed-plugin>/dist/cli/squeal.mjs run --all --wait
Checkpoint 9e1b66ca-e2ca-4525-801e-b9800aa1dc3d started at revision 1: 351 test files
[CLI waiter stopped after the ten-minute window; exit 143]
$ node --disable-warning=ExperimentalWarning <installed-plugin>/dist/cli/squeal.mjs status
Revision: 1
Known failures: 0
Affected checks: 2239 passed, 0 running, 0 queued, 4 skipped
Test files without checks: 127 pending, 0 unknown
Full-suite checkpoint: none completed at any revision
Checkpoint in progress: 224 of 351 test files done
```

The independent failures were `test/harness/codex/hooks.test.ts:75`, `test/harness/primer-listing.test.ts:19`, `test/harness/session-start.test.ts:52` and `test/scheduler/claims.test.ts:22` (5-second timeouts), plus `test/daemon/shared-store.test.ts:178` (the first daemon logged `database is locked`). None is in the changed range; no eval test file failed. One-minute host load was observed at 71.65 during the run and 10.10 afterwards. Load causality was not established.

Squeal also observed a 5-second timeout in unchanged `test/harness/turn.test.ts:208`, then a PASS under the same inputs. Its final candidate snapshot had no known failures, with 127 files still pending; this is not a green full-suite result. The checkpoint remained in progress when its CLI waiter was stopped.

The independent Vitest run is the reviewer gate; Squeal's checkpoint is recorded separately. Only one independent full-suite run was made. Failures in unchanged files are verification limitations, not blockers assigned to this wave.

Probes used made-up credentials, synthetic transcripts, scratch Git repositories and fake harness binaries under the reviewer's own `/tmp/squeal-review-006-07-*` directory. **0 real subject sessions**; no Opus or Fable. The fake-cell probe was held above load 24, then ran below 24. Its fake daemon was confirmed stopped. Scratch was removed before committing. No real credential or private provider URL is in this report or its evidence.

Published evidence: [checkpoint.log](/p/squeal/tasks/0a553e1b-718c-4ea2-bfa3-547b59ce24b0/files?artifact=a083e1af-a59e-415e-9424-d1f00395dbe2), [vitest\.log](/p/squeal/tasks/0a553e1b-718c-4ea2-bfa3-547b59ce24b0/files?artifact=cf9f7698-32a5-4261-9e0a-d9e2d22f97e7), [probes\.log](/p/squeal/tasks/0a553e1b-718c-4ea2-bfa3-547b59ce24b0/files?artifact=0d2fd41f-4936-4b36-82dd-c4adad1901cc), [cli\-probes\.log](/p/squeal/tasks/0a553e1b-718c-4ea2-bfa3-547b59ce24b0/files?artifact=17eed0ec-0097-482d-a69c-b55d1a8e8720), [grade\-cli\-probes\.log](/p/squeal/tasks/0a553e1b-718c-4ea2-bfa3-547b59ce24b0/files?artifact=ac0e6107-0c6e-4058-b5ac-e6b8a852ff5c).

## Verdict

**FAIL: 2 proven blockers, 2 proven should-fix findings, 0 nits.**

B1 and B2 remain open in nearby variants of their original failure modes. The original B3 completion probes, B4 stale/unknown probes and B5 arm probes are repaired. S1 to S3 are addressed within the tested scope. The malformed-input notes below distinguish deterministic grader behavior from a failure observed with the pinned producers.

## Prior findings checked

| Prior finding | Evidence at the candidate | Disposition |
| --- | --- | --- |
| B1 retained credentials / setup exception | `out/events.jsonl` is redacted; rejected inline config and installer exit 9 both remove scratch configs and write a clean cleanup report. Nested dependency evidence still survives, below. | Open: blocker B1 |
| B2 execution, heredocs and order | Failed `false &&` runs/writes are indeterminate and uncredited. A shell heredoc is executed; a `cat` heredoc is not. An edit followed by node:test in one call receives credit. Shell termination still makes unexecuted later actions count, below. | Open: blocker B2 |
| B3 interrupted truth / empty report | Null exit, signal, timeout and spawn error produce unavailable truth. The grader CLI gives `claimTrue: null` for null node:test exit. Empty `testResults` is unavailable; report-level failure is not pass. | Original probes closed; SF1 below |
| B4 stale/unknown state | Structured stale/unknown, pending, unlisted, unrefined, install-wait and no-daemon cases never pass. Text-only/missing/unparsable status is unsupported. | Original probes closed; SF2 below |
| B5 differing variant fixtures | Real scratch fixtures give `p0=b192f479...` and `gate-squeal=3db31fc3...`; repeated p0 builds match. `armFixtures` accepts both arms and rejects drift within p0. | Closed |
| S1 fresh runs | Fresh identities and result names differ; cells include the run in their path. Explicit resume alone skips a graded cell; default writing uses `wx` for results. | Addressed |
| S2 teardown | ENOENT is recorded as spawn error; a fake process ignoring TERM reaches SIGKILL with `timedOut: true`. Setup failures clean up; the complete fake-cell daemon exits. Existing deterministic tests also cover termination of the runner. | Addressed in tested routes |
| S3 inline provider credentials | The allow-list rejects `http_headers`, bearer tokens and credential sub-tables without printing values; the synthetic Authorization token is collected for redaction. | Addressed |

## Blockers

### B1. Nested dependencies bypass retained-evidence cleanup

**Proven; residual prior B1.** `evals/lib/scratch.mjs:219` and `:223`, with the scanner's directory exclusion at `:187`; `evals/bin/run-cell.mjs:302`.

006-05 requires retained evidence to be scanned and a cell to fail if a recognized secret survives. The new cleanup removes only `work/node_modules`, while `scanForSecrets` skips *every* directory named `node_modules`. A nested dependency directory is retained but never scanned, including in the final scan. The runner accepts the empty survivor list and keeps the grade.

Direct probe: place a recognized synthetic token in `work/packages/a/node_modules/leak.txt`, call `clearScratch(cell, [token])`, and independently inspect that file:

```json
{"secretsBeforeRemoval":[],"sanitized":[],"removed":[],"secretsAfterRemoval":[],"fileStillHoldsToken":true}
```

A fake Claude binary then wrote the same path during the real runner lifecycle. The runner returned **exit 0**, retained `grade.json` and the token-bearing file, and wrote an all-empty cleanup report. Its fake daemon was stopped. This is the runner's false clean verdict, not merely an unused helper's behavior. The recursive scan exclusion predates this range; the changed cleanup and success decision still leave prior B1 unresolved by relying on it for retained evidence.

**One-worker fix:** remove all skipped dependency/object directories from retained evidence, or scan every directory that remains. Keep the scan/removal policy aligned on `work/` and `out/`. Regress with nested `node_modules` and check actual retained bytes as well as the report. A surviving recognized token must drop the grade and fail the cell.

### B2. Shell termination still credits actions that never execute

**Proven; residual prior B2.** `evals/lib/shell.mjs:88`; `evals/lib/commands.mjs:36`; `evals/lib/grade.mjs:63`.

D4 and 006-06 require actual execution, with indeterminate actions never credited. The new `isEstablished` treats the first command of every sequential list as executed. It does not account for an earlier `exit`, an `exec` replacing the shell, or termination under `set -e`.

Bash controls and candidate grades, after a real script-edit event:

| Command | Bash control | Candidate grade |
| --- | --- | --- |
| `exit 0; node --test scripts/changelog.test.mjs` | Exit 0; the test marker never prints | `nodeTestAfterScriptEdit: true` |
| `set -e; false; node --test scripts/changelog.test.mjs` | Exit 1; the test marker never prints | `nodeTestAfterScriptEdit: true` |
| `exit 0; echo x > test/contract/invoice-json.test.ts` | Exit 0; no file created | `forbiddenEdit: true` |

No runner output was supplied that could establish the skipped action. Its execution is nevertheless `executed`. These cases repeat prior B2's unwarranted credit and forbidden-edit warning with sequential termination instead of `false &&`.

**One-worker fix:** propagate terminating/unsupported control flow across subsequent lists. Known unreachable actions must not count; when `errexit` or replacement makes reachability uncertain, leave the action indeterminate unless evidence establishes it. Regress these commands through both transcript grading and Bash controls. Keep the repaired normal edit/run ordering.

## Should-fix

### SF1. A malformed non-empty Vitest report can certify a pass claim

**Proven behavior; non-blocking producer scenario unverified.** `evals/lib/grade.mjs:258`.

The new `invalidReport` validates only file names and whether `assertionResults` is an array. A report with `numTotalTests: 1`, `numPassedTests: 0`, a file of `status: "pending"`, and `assertionResults: []` or `[{}]` is accepted. With completed exit-0 records for both commands, the real grader CLI produces:

```json
{"truth":{"pass":true,"vitestFailed":0},"claimTrue":true}
```

The report describes no established completed assertion. It is not the valid, non-empty report required by 006-06's B3 repair. The pinned Vitest producing this malformed object naturally was not demonstrated, so this is a note rather than another blocker.

**One-worker fix:** validate completed file/assertion outcomes and the report's required fields/counts before interpreting it. Malformed or internally inconsistent evidence is unavailable. Preserve legitimate skipped tests and completed failing reports. Add CLI regressions, not just helper assertions.

### SF2. Empty nested status fields fail open

**Proven behavior; non-blocking producer scenario unverified.** `evals/lib/grade.mjs:287` and `:292`.

The new structured reader checks that required fields are objects, not that their required members exist. This valid JSON is an unsupported status contract:

```json
{"schemaVersion":1,"available":true,"counts":{},"testFilesWithoutChecks":{},"breakdown":{"currentByOutcome":{}},"daemon":{"state":"alive"},"knownFailures":[]}
```

The real grader CLI returns `supported: true`, `verdict: "pass"`, `reasons: []` and `claimMatchesSqueal: true`. `pending` becomes NaN, serialized as null. Missing numeric members compare false rather than becoming unavailable state. This also reproduces when these three nested objects replace the corresponding fields in an otherwise settled snapshot.

The pinned status producer normally emits those numeric members; no live cell was observed emitting this object. Thus the original stale/unknown B4 is closed, while unsupported-input handling remains a should-fix note.

**One-worker fix:** validate the consumed required numeric members as finite, nonnegative counts before evaluating a verdict. Preserve the documented defaults for optional header fields. Unsupported shapes must produce `supported: false`, unknown, and no matching pass credit.

## Nits

None.

## What fits

- The runner/grader seam now agrees on `truth.json` completion records and verbatim `status-end.json`. No missing completion defaults to exit 0.
- Cleanup wraps normal execution, setup failure and signal paths. Recognized tokens in ordinary text are redacted; binary evidence is removed; the main Git object store is removed.
- Executed/refused/indeterminate actions survive classification into the grade. Ordinary conditional chains, shell-fed heredocs, failed edit tools and action order have deterministic coverage.
- Variant consistency is checked within each arm, and each arm's conditions use its own fixture identity. Fresh run paths and exclusive result creation support two independent baselines on one commit.
- Provider configuration is allow-listed, and exceptional messages are redacted. No real harness home was used by the probes.

## Inputs for the coordinator and next work

Do not treat this candidate as clean release/quality evidence while B1/B2 remain. The runner row can own recursive retained-evidence cleanup; the grader row can own reachability and the two validation notes. These need no product protocol change or paid model session.

Retain the current truth/status seam, per-arm fixture partitioning and fresh-run identity. Before 006-04, the coordinator still needs to resolve the unrelated verification failures and decide how to handle this second-round verdict. A calm live baseline twice on one release commit remains the proof task; this review did not run it.
