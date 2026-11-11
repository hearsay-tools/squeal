# Issue 178: incomplete CI parts

Recommend treating partial export as a proposed D9 policy change, while keeping incomplete runs untrusted.

**Verdict:** the export refusal is reproduced on Squeal **0.1.430**, commit
`1ac649d408c9043997fd4eeb0c0ed3a079b1da4c`. A real two-shard control exports;
a synthetic `crashed` part beside a completed shard refuses. The original
CI log independently confirms the reported refusal on **0.1.425**. This
matches the current D9 contract. No product change is proposed here.

## Questions and evidence

| Question | Answer and tag | Version examined |
| --- | --- | --- |
| 1. Does one crashed part prevent completed parts from exporting? | Yes: mixed input exits 1 and creates no export. **verified by experiment**; the crashed header was constructed from a real recorded part. | Squeal 0.1.430; Vitest 5.0.3; Node 24.22.1 |
| 2. Is that contrary to the current contract? | No. D9 requires all shards passed and refuses an incomplete set. **read in official docs** (repository spec and amendment log). | Spec at `1ac649d408` |
| 3. Does deleting the crashed part solve it? | No. The surviving shard 2/2 gives a missing-shard refusal, exit 1. **verified by experiment**. | Squeal 0.1.430 |
| 4. What must a partial-export decision preserve? | Keep incomplete-run evidence unusable, and retain commit, environment, snapshot, duplicate and input-evidence checks. Partial availability must not imply suite completion. **inferred** from the named guards and D9. | Squeal 0.1.430; spec at `1ac649d408` |

## Reproduction

**verified by experiment, Squeal 0.1.430.** Initial host check:
`uptime` reported one-minute load **14.19**; `getconf _NPROCESSORS_ONLN`
reported **24**. Live reproduction was permitted. The retained probe began
2026-11-11 01:24:12 UTC, with load **12.73** and 24 CPUs; subsequent recording
checks were **12.73, 14.20, 14.20**, all below 24. No full suite ran.

Exact entry command, exit **0**:

```sh
node docs/specifications/018-ci-and-shared-results/research/probes/issue-178/probe.mjs > docs/specifications/018-ci-and-shared-results/research/probes/issue-178/output.txt 2>&1
```

The [probe](probes/issue-178/probe.mjs) creates two one-assertion files and a
global setup. It uses the committed CLI bundle, `CI=true`, and
`vitest run --shard=1/2 --maxWorkers=1` then `--shard=2/2`. Export runs in a
fresh clone of the same fixture commit. The [transcript](probes/issue-178/output.txt)
records every expanded command, stdout, stderr and process exit status.

| Input or action | Observed result | Exit |
| --- | --- | --- |
| Record each complete shard | One part with one test file each | 0 each |
| Export both complete parts | `Exported 2 test files, 4 results`; output exists | 0 |
| Unhandled rejection in global setup, shard 1/2 | `ended without the end of a run; no part` | 1 |
| Synthetic crashed shard 1/2 plus complete shard 2/2 | `is of a run that did not complete (crashed); wrote nothing`; no output | 1 |
| Complete shard 2/2 alone | `no part of shard 1/2: export the parts of every shard, after all of them passed; wrote nothing`; no output | 1 |

The synthetic part retains the real part's commit, shard and project data,
sets `header.end` to `crashed`, empties `testFiles`, and removes coverage
records. This isolates the exporter; it does not claim to recreate the
original crash. An earlier exploratory rejection inside a test was attributed
to that file and yielded `end: completed`; the global-setup abort above yielded
no part. Neither was evidence of an actual locally produced `crashed` header.

## Contract and historical evidence

**read in official docs, spec at `1ac649d408`.** [D9](../spec.md#d9-the-export-job-after-the-shards)
says export runs “after every shard has passed” and refuses “an incomplete
shard set.” The [status log](../status.md), 2026-11-09 review of 0.1.421 B3,
records that a missing shard previously produced a partial export with exit 0;
refusal was the repair. D8 also keeps input stability as a condition.

**read in source code, Squeal 0.1.430.** `partsRefusal` calls `reuseRefusal`
for every part; a non-completed end returns `incomplete` before union or keying.
Removing the part reaches `shardRefusal`, which still requires every index
exactly once. `ciExportCommand` returns 1 without writing when refused.
`recordedRun` includes no test files for a crashed or interrupted run;
`readRawRuns` produces no part when a process never reports run end.
These are distinct cases, with the same practical loss of partial export.

**read in official docs (GitHub Actions log), Squeal 0.1.425.** The named
[CI run](https://github.com/hearsay-tools/cezarion/actions/runs/42832873309)
at `819ec5af0cb2752774be7b23cc593d7686f055c7` used `squeal--v0.1.425`.
Its export job refused shard 1's `squeal-part-48b7e900-2e8b-44c0-b3c7-55ed1553bcc5.json`
as `crashed` and exited 1; publish was skipped. The retained
[excerpt](probes/issue-178/ci-log-excerpt.txt) recovers the version and exact
message missing from the [issue](https://github.com/hearsay-tools/squeal/issues/178).
The original crash cause is not determined: this bounded probe did not inspect
that test run's parts or reproduce its test.

## Recommendation and open questions

**inferred, Squeal 0.1.430.** Partial export could preserve useful completed
shards, but it changes a rule that previously fixed false suite completeness.
The human must choose whether to amend D9. If approved, skipped shards must
remain explicit missing evidence. Do not make a crashed part reusable merely
to make the export job green. The shared `reuseRefusal` also protects
`squeal code --base --parts` (020 D13.2); weakening it broadens the change.

Still undecided: whether partial export is wanted; whether missing artifacts
and explicit incomplete parts have the same policy; how partial coverage is
reported; and the exit policy when no usable result remains. No partial-export
implementation or trust-boundary change was tested.

## Verification limits

`node --check .../probes/issue-178/probe.mjs`, local-link checks and
`git diff --check` passed. The probe itself exited 0. The installed CLI's
`squeal status --wait 60000` on the findings and probe returned exit 3:
no test closure holds either path. Its worktree summary was 0 known failures
and 683 unknown test files out of 1,598. No full-suite pass is claimed;
no product code changed.

## Source locations

All source paths below were read at `1ac649d408c9043997fd4eeb0c0ed3a079b1da4c`:

- [export-check.ts](../../../../src/core/ci/export-check.ts), `partsRefusal` (72), `reuseRefusal` (117), `shardRefusal` (175).
- [export.ts](../../../../src/core/ci/export.ts), pre-key refusal (113) and input certification.
- [ci-export.ts](../../../../src/cli/ci-export.ts), refusal (93), empty export (113).
- [ci-runs.ts](../../../../src/runners/vitest/ci-runs.ts), raw run handling (87), `recordedRun` (126), `endOf` (145).
- [parts.ts](../../../../src/core/ci/parts.ts), `PartEnd` contract (38).
- [export-check.test.ts](../../../../test/ci/export-check.test.ts), existing crashed/interrupted refusal assertions. Read only; not run for this research.
