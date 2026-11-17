# Issue 235: selected runs behind automatic quiet

Recommend a selected-file quiet bypass that keeps unrelated catch-up delayed.

**Verdict: not reproduced in this task.** The required load gate skipped the
live probe. Source supports the reported mechanism in both release 0.1.531 and
the examined 0.1.543 tree. This is evidence for a repair proposal, not a tested
fix or proof of the original daemon's state.

## Scope, versions and method

Read on 2026-11-17: [issue 235](https://github.com/hearsay-tools/squeal/issues/235)
(body, no comments); 011 C4/C6/C15 and its status; 019 D1/D6 and its status;
process, vision and styleguide. Source versions:

- Reported runtime: **0.1.531**, from the issue, not independently exercised.
- Release source: `squeal--v0.1.531`, commit
  `7e78f02ef246e73f1e94e766fc5fc2dce313a3e4`.
- Worktree source: **0.1.543**, commit
  `9e58bb28ad73c036916d9f005968b9514cfc2cd7`.
- Probe launcher: Node **v26.13.0**; package manager pinned to **pnpm 12.15.0**.

**Verified by experiment, launcher only (Node v26.13.0):** immediately before
any scheduler run, `run.mjs` read `os.loadavg()[0]` and `os.cpus().length`:

```json
{"at":"2026-11-17T15:02:12.138Z","node":"v26.13.0","oneMinute":36.87,"cpuCount":24,"skipped":true}
```

The command exited **77**, before starting Vitest. No second live attempt,
full suite, build or product edit was made. The supplied time budget was under
20 minutes. The prepared probe and its assertions remain unverified.

## Questions and answers

| Question | Answer | Tag and version |
| --- | --- | --- |
| 1. Does the exact reported CLI timeout reproduce? | Not determined: live execution was skipped because load exceeded CPU count. The issue reports a 60 s timeout, 2 current files and 1 queued, then a later result without another edit; it has no status JSON. | Inferred from report only, reported 0.1.531 |
| 2. Does the selected-file request bypass automatic quiet? | No bypass is present on the traced default `tests` path for an already-queued catch-up file. The request leaves its queue class in place. | Read in source code, 0.1.531 and 0.1.543 |
| 3. Is unrelated catch-up kept separate? | The request selects only named files and does not clear lane quiet. An existing promotion path is a candidate control for selective bypass, but its combined behavior was not run here. | Inferred, 0.1.531 and 0.1.543 |
| 4. Why does the command say “run now”? | The renderer chooses “now” solely when the group has no `after` dependency; it does not inspect automatic quiet. | Read in source code, 0.1.531 and 0.1.543 |
| 5. What does the contract require? | 019 D6 says the narrow run “runs now only the test files of the group that the paths select”. 011 C4 already exempts named batches from quiet; C15 defines the existing promotion semantics. | Read in official docs (repository specs at examined commit) |

## Source findings

**Q2, read in source code, both versions.** `Scheduler.requestGroupPaths`
passes the request to `narrowRequest`. Its `queueNarrow` splits non-current files
into already-pending files (`phase !== null`) and misses. Only misses go through
`ledger.settle`; pending files are counted, with no promotion or reclassification.
The stage then calls `groups.get(group)?.narrow.add(asks, ledger)`.
`GroupTiers` explicitly excludes `TESTS_GROUP` from configured lanes, so default
`tests` has no lane to receive those asks. Request intake wakes the pump; waking
it does not change eligibility. `quietHolds` still excludes catch-up from a
backlog tier or turn while the lane's 120,000 ms catch-up wait is live.

**Q2, inferred, both versions.** This route explains a selected file staying
queued past a 60 s wait when more than 60 s remain on automatic quiet. It does
not establish the original file's queue class, claims or running tiers, because
the issue has no status snapshot. A live replay is still required.

**Q3, read in source code, both versions.** `selectNarrow` selects a test file
by its exact path. The request does not call `BacklogQuiet.end`. That method
clears both quiet maps for every lane and belongs to `run --all`; using that
broad operation would discard unrelated files' delay too. C15's promotion path
instead changes the named files' ordering. The queue treats promoted files as
first-group work, and the tier picker exempts a batch from backlog quiet.

**Q3, inferred, both versions.** The decisive tradeoff is prompt evidence for
explicit demand versus the CPU savings from holding unrelated catch-up. The
prepared control checks that both can hold together. It does not decide the
implementation, promotion lifetime, or interactions with claims and other batches.

**Q4, read in source code, both versions.** `narrowText` uses
`group.after.length === 0 ? "now" : ...`. Its answer has counts and selected
files, not the automatic quiet deadline. `waitForGroup` enters the `group` wait
loop, which reads file classes and the deadline. It does not enter the named
status-wait loop that sends `promote`. Thus `--wait` does not itself supply the
missing promotion. The “run now” line is rendered at request acceptance and
printed again after the wait, which fits the contradictory lines in the report.

**Q5, read in official docs, examined commit.** 011 C4 makes ordinary catch-up
wait for quiet while named demand has exceptions. C6 exposes status and the
reason for queued work. C15 distinguishes named test paths from source-path
selection. 019 D1 separates group moments from explicit requests; D6 narrows the
explicit run to selected files and says current results count without rerunning.
019's status records the 2026-11-06 approval and that the narrow default `tests`
request “only queues”. These facts explain the gap without changing the spec.

## Probe and open questions

The [throwaway probe](probes/issue-235/README.md) uses the real scheduler and a
synthetic adapter. Its two cases plan to check the narrow request at virtual
0/60/120 s, then the same request with explicit promotion as a control. The
fixture has seven files, an isolated store/pool, and no installed daemon.
**Neither case ran.** No observed scheduler output or pass result exists.

Open: reproduce at lower load; confirm the default-lane diagnosis with runtime
state; test unrelated-file isolation through the actual CLI/socket path; check
running batches, claims and subsequent edits. Configured groups' own `quietMs`
and separate lanes are outside this default-`tests` finding. No restart was tried.

## Validation

`node --check` passed for the launcher, probe and isolated Vitest config.
`git diff --check` found no whitespace errors. Biome ignored these research
paths, so its attempted format command processed no files; no lint pass is
claimed. These static checks do not validate the probe's runtime behavior.
Product tests were not run for this documentation-only task.

## Commands and sources

Read-only commands used, from the repository root:

```sh
gh issue view 235 --json title,body,comments,url
git rev-parse HEAD
git rev-parse squeal--v0.1.531^{}
git show squeal--v0.1.531:src/core/scheduler/narrow-run.ts
git show squeal--v0.1.531:src/core/scheduler/group-tiers.ts
git diff --stat squeal--v0.1.531 HEAD -- src/core/scheduler/queue.ts src/core/scheduler/tier-pick.ts src/core/scheduler/quiet.ts src/core/scheduler/narrow-run.ts src/core/scheduler/group-tiers.ts src/cli/run-group-narrow.ts src/cli/run-group-wait.ts src/cli/wait
node docs/specifications/011-core/research/probes/issue-235/run.mjs
```

The scoped diff printed nothing: these traced files are unchanged between the
two versions. Sources below are pinned to the reported release; local paths
name the same files at the examined worktree commit.

- [Narrow selection and queueing](https://github.com/hearsay-tools/squeal/blob/7e78f02ef246e73f1e94e766fc5fc2dce313a3e4/src/core/scheduler/narrow-run.ts), `src/core/scheduler/narrow-run.ts` (`narrowRequest`, `queueNarrow`).
- [Group lane ownership](https://github.com/hearsay-tools/squeal/blob/7e78f02ef246e73f1e94e766fc5fc2dce313a3e4/src/core/scheduler/group-tiers.ts), `src/core/scheduler/group-tiers.ts` (`get`, `#sync`).
- [Quiet gate](https://github.com/hearsay-tools/squeal/blob/7e78f02ef246e73f1e94e766fc5fc2dce313a3e4/src/core/scheduler/quiet.ts), `src/core/scheduler/quiet.ts` (`quietHolds`, `BacklogQuiet.end`); `queue.ts`, `tier-pick.ts` beside it.
- [Narrow command and wording](https://github.com/hearsay-tools/squeal/blob/7e78f02ef246e73f1e94e766fc5fc2dce313a3e4/src/cli/run-group-narrow.ts), `src/cli/run-group-narrow.ts`; `run-group-wait.ts` and `wait/{wait,table,named}.ts` under `src/cli/`.
- Contracts: [011 spec](../spec.md), [011 decisions](../status.md), [019 spec](../../019-run-triggers/spec.md), [019 decisions](../../019-run-triggers/status.md).
