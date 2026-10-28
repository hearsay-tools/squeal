# Issue 117: a deleted test reported as a current failure

Keep the issue open for an incident-matched reproduction. **Not reproduced on
0.1.370 in two controlled Vitest 5.0.3 cases.** Both retired the deleted test
without a failure transition. This does not establish that the 0.1.368 incident is
fixed. No implementation or policy change is proposed by this research.

## Questions and verdicts

| Question | Answer and evidence class |
| --- | --- |
| What was reported? | **Read in official docs**, issue #117: Squeal 0.1.368 reported 12 tests and one file check as `PASS -> FAIL`, revision 5, after a tracked test was deleted by a clean merge. Its supplied `why --json` marks the missing-module file failure `current`. This is reported evidence, not a local reproduction. |
| Does delayed inventory retain the deleted file? | **Verified by experiment**, 0.1.370: yes. After the deletion batch, revision 2 still had B's key. Both its prior passing checks were `pending`, phase `queued`. |
| Does it publish the reported failure? | **Verified by experiment**, 0.1.370: no in either controlled case. After refresh, B had no key, no known states, and no transition history. The selected-file case returned an empty adapter result with no file errors. |
| Does this prove the incident fixed? | **Inferred**, 0.1.370: no. The incident repository declares Vitest `^4.1.10`; the probe used 5.0.3. Neither the incident daemon/store nor the installed 0.1.368 runtime was replayed. |

## Environment and exact commands

Source: `2970f9b3581b2b58d8edec14034da528687fab32`, package version **0.1.370**.
The session primer also names installed Squeal **0.1.370**, but the probe imports
source, not the installed bundle. The shared harness labels its synthetic scheduler
version `0.0.0-test`; this is fixture metadata, not the source version.
Node **v24.22.1**, Vitest **5.0.3**, Linux x64, **24 CPUs**.

Commands run from this worktree:

```sh
gh issue view 117 --repo hearsay-tools/squeal --json title,body,comments,url
git rev-parse HEAD
node -p 'require("./package.json").version'
node --version
pnpm exec vitest --version
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
pnpm exec vitest run --config research/probes/issue-117/vitest.config.ts research/probes/issue-117/probe.test.ts > research/probes/issue-117/result.txt 2>&1
```

**Verified by experiment**, 0.1.370: initial one-minute load was **20.43**.
Immediately before the first live command it was **21.16**, below 24. Both cases
passed in **7.10 s**. The instrumented repeat began at load **19.17**; its per-case
load samples were **18.92**. It passed **1 file, 2 tests in 6.38 s**, at
2026-10-28 10:14:50 UTC. The repeat was needed to preserve state observations that
the nested adapter captured from console output. A later load sample was **28.80**,
so further live probes were skipped. No full suite ran.

The isolated probe uses real filesystem deletion and a Git commit. It submits the
batch through `Scheduler.handleBatch`, using the harness's stat candidates. It does
not start a daemon or rely on watcher timing. Its two files each contain one passing
test; the fixture's baseline runs those two files only. Adapter calls serialize
behind a promise held before one run. This gives a controlled version of an earlier
tier delaying the revision's runner part.

| Case | At deletion revision 2 | After releasing the held call |
| --- | --- | --- |
| A held; B deleted and queued | B key present; test and file check retain `pass`, validity `pending`, phase `queued` | Only A runs after the baseline. B key removed, states empty, history empty. |
| B selected and held; B deleted | Same pending state | B's requested run completes with zero reported test results and zero file errors. B key removed, states empty, history empty. |

Raw observations and output are in
[`research/probes/issue-117/`](probes/issue-117/).
The final probe retains the tested logic; only formatting/import ordering changed
following the recorded run. Scratch repositories were removed after handles closed.

The coordinator moved the preserved probe from the original command paths above to
`docs/specifications/011-core/research/probes/issue-117/` at integration. Imports and
the config include path now match that location. The README gives the rerun command.
The relocated probe was not rerun; recorded output is from the original paths.

## Source evidence and contract

All local source findings below are **read in source code**, 0.1.370 at the commit above.

- `src/core/scheduler/batch.ts`, `reconcileBatch`, and
  `src/core/scheduler/revision.ts`, `rekeyContent`: the revision's content phase
  updates keys and settles files from the current ledger. It does not remove a test
  solely because its changed path now has a null hash.
- `src/core/scheduler/refinement.ts`, `fetchRunnerPart`: an add or deletion makes
  the change structural. After invalidation, it asks `testFiles()` for a new list.
  `applyRunnerPart` applies that list. `revision.ts`, `applyListing`, removes files
  absent from a successful list. A failed list preserves the old inventory.
- `src/core/scheduler/ledger.ts`, `removeFile`: removes the key and queued file,
  retires its checks, and completes its checkpoint work.
- `src/core/scheduler/scheduler.ts`, the pump near lines 880–955: runner work drains
  before selecting another tier. A pending drain makes the pump wait. This explains
  why case 1 never started B after its reconciled deletion. It does not prove every
  lane or asynchronous ordering safe.
- `src/runners/vitest/adapter.ts`, `testFiles` and `run`: listing uses
  `globTestSpecifications`; running constructs a specification for every requested
  path. The run path has no simple file-existence rejection at specification creation.
  `src/core/scheduler/store-decision.ts`, `storeDecision`, checks changed inputs
  before accepting a completed result. The probe did not observe a missing-module
  result reaching that decision.

**Read in official docs**, current 011 C2, C4, C5, C6, C14 and `status.md`:
C2 separates immediate content reconciliation from runner refinement. C4 ties current
validity to keys and says failed listing preserves inventory. C5 defines file-level
load failures and transitions. C6 distinguishes current failures and inactive historical
files. C14 gives adapters deletion invalidations and inventory/run operations. These
contracts make retained pending inventory different from a new current regression.
The vision requires trustworthy revision provenance and stated uncertainty.

**Read in source code**, incident repository at
`f5dececb4e0f0995f1afff2f4396b50e3f42527a`: `packages/cezar/vitest.config.ts`
names the `server` project and includes `src/**/*.test.ts`; its `package.json`
declares Vitest `^4.1.10`. The exact installed version at the incident is not determined.
The fetched `squeal.config.json` sets `runner.tierSize: 4`, `timeoutMs: 900000`,
and baseline `lookup-then-run-missing`. The probe uses one-file tiers.

Exact source fetches:

```sh
gh api repos/hearsay-tools/cezarion/contents/squeal.config.json?ref=f5dececb4e0f0995f1afff2f4396b50e3f42527a --jq .content | base64 -d
gh api repos/hearsay-tools/cezarion/contents/packages/cezar/vitest.config.ts?ref=f5dececb4e0f0995f1afff2f4396b50e3f42527a --jq .content | base64 -d
gh api repos/hearsay-tools/cezarion/contents/package.json?ref=f5dececb4e0f0995f1afff2f4396b50e3f42527a --jq .content | base64 -d
git diff --name-only squeal--v0.1.368..HEAD -- src/core/scheduler src/core/state src/runners/node-test src/runners/vitest
```

The last command lists scheduler changes, including runtime-policy work, between the
reported and examined versions. The adapter paths listed by that command have no diff.
That is not a behavioral equivalence claim.

## Limits and next evidence

**Inferred**, 0.1.370: the deciding evidence would be an incident-matched sequence
that records the deleted file's selection key, revision batch, inventory completion,
raw adapter error, and state commit. A future bounded probe should use the incident's
installed Vitest version and project layout, and distinguish a delayed inventory from
a failed or timed-out inventory. These were not tested here. Neither case exercised a
real clean merge, multi-project concurrency, the watcher, a CLI `why` rendering, or
Codex push delivery. No existing hold was changed.

Squeal reports the research TypeScript as untested because its default test config
does not load it. The explicit probe command above supplies the experimental evidence;
it does not establish repository-wide test health. Final `pnpm exec biome check research/probes/issue-117/probe.test.ts research/probes/issue-117/vitest.config.ts` passed (2 files, no fixes).
`git diff --check` passed.
The absolute session CLI command `squeal status --wait 60000` with those two paths
returned **No verdict**: neither path is covered. Its snapshot had 0 known failures
and 1,313 of 1,314 repository test files unknown. The exact command was
`/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 research/probes/issue-117/probe.test.ts research/probes/issue-117/vitest.config.ts`;
its output is preserved as `squeal-status.txt` beside the probe. Full-suite, build, and product typecheck were not run for research.

Sources: [issue #117](https://github.com/hearsay-tools/squeal/issues/117),
[incident server config](https://github.com/hearsay-tools/cezarion/blob/f5dececb4e0f0995f1afff2f4396b50e3f42527a/packages/cezar/vitest.config.ts),
[incident package](https://github.com/hearsay-tools/cezarion/blob/f5dececb4e0f0995f1afff2f4396b50e3f42527a/package.json),
[011 contract](../spec.md), [amendments](../status.md), and the local source paths above.
