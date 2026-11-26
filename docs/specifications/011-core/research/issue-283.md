# Issue 283: named runs wait behind revision runner work

Date: 2026-11-26. [Issue 283](https://github.com/hearsay-tools/squeal/issues/283).
Examined: Squeal **0.1.636**, source commit `b0ef44b56ddeb0ddac6e8d8142bf40146f029ab7`.
The traced scheduler, request and CLI sources have no diff from release tag
`squeal--v0.1.636`. Owner: 011 C2/C4/C6/C15; related 019 D6.

## Verdict

**Inferred, 0.1.636:** fold this evidence into #271's focused-request
diagnosis, keeping #283's longer, mid-session incident as a separate case.
The shared acceptance mechanism is established; a shared cause of the
original delays is not. Ask the human whether to change C15's explicit
unlisted-revision barrier or retain it with bounded progress diagnostics.
This triage authorizes no implementation and changes no contract.

**Verified by experiment, 0.1.636:** a named existing edited test remains
untaken behind held revision runner work, including an actual `testFiles()`
call. Releasing the call permits acceptance and the target's current result.
The same `lists revision` text also appears when only `invalidate()` is
held and no new `testFiles()` call has happened.

**Inferred, 0.1.636:** the original two 60-second incidents are **not
reproduced**, because this bounded probe uses two synthetic files and
650 ms promise gates, without the reporting repository, incident store or
runner processes. The report alone does not prove full-repository Vitest
or node:test enumeration, nor identify the operation consuming 60 seconds.

## Questions answered

| Question | Tagged answer, version 0.1.636 |
|---|---|
| Can an explicit known test wait before acceptance during a mid-session edit? | **Verified by experiment:** yes, in both controlled runner-call gates. |
| Does the receipt establish full test-file enumeration? | **Verified by experiment:** no. Held `invalidate()` yields the same wording with zero new listing calls. |
| Where is the dependency? | **Read in source code:** every narrow run uses `runnerWork.always`; intake puts selection behind earlier runner work. Listed-file selection itself needs no `affected()` call. |
| Is this contrary to the current contract? | **Read in official docs:** C15 explicitly prevents any tier from starting before the revision's runner part finishes, including promoted files. Bypassing it needs a contract decision. |
| Is it #271, #273 or held #235? | **Inferred:** #271 is the closest shared acceptance surface. #273 is new-path selection during discovery; #235 is automatic quiet after selection. Neither is demonstrated by this probe. |

## Experiment and exact results

**Verified by experiment, 0.1.636:** the launcher command
`~/.codex/plugins/data/squeal-hearsay/bin/squeal --version` returned
`0.1.636`. `squeal checks` through that absolute launcher reported the
default `tests` group, 2,276 files, edit-triggered; 1,864 pass and 412 not
current at that read. This was inventory, not a test run claim.

`cat /proc/loadavg` initially returned `0.80 0.58 1.28 3/763 1112911`;
`nproc` returned `16`. Immediately before the final probe it returned
`0.84 0.61 1.12 1/708 1119498`. Node: `v26.13.0`; Vitest: `5.0.3`.
No heavy work, full suite, real runner listing or quiet-host timing was
attempted. The probe uses one worker and mostly waits on promises. Boat.dev
instructions were read; this correctness probe did not need a sandbox.

The throwaway probe and observations are in
[`probes/issue-283/`](probes/issue-283/README.md). It uses the real scheduler,
store and group-request recorder with the existing fake-runner fixture.
Both files first have current baseline results. It edits the target; the
`testFiles` case additionally creates a source path to require discovery.

```sh
pnpm exec vitest run --config docs/specifications/011-core/research/probes/issue-283/vitest.config.ts docs/specifications/011-core/research/probes/issue-283/probe.test.ts
```

Final run, exit 0: `Test Files 1 passed (1)`, `Tests 2 passed (2)`,
duration `3.13s`. The normal projects include only `test/` and `src/`, so
Squeal does not run this throwaway file; that is why it ran directly.
[`result.json`](probes/issue-283/result.json) records:

| Held call | Receipt after 650 ms | New listing calls | New target runs | After release |
|---|---|---:|---:|---|
| `invalidate()` | `requested: null`, holder `listing`, revision 1 | 0 | 0 | accepted; only target selected; one new target run; current |
| `testFiles()` | `requested: null`, holder `listing`, revision 1 | 1 | 0 | accepted; only target selected; one new target run; current |

Probe development also produced two failures, neither a product verdict:
the first proxy failed to bind fake-runner methods (baseline not current);
after correcting the proxy, an assertion expecting `testFiles()` after an
ordinary edit failed. The latter prompted the two cases above. They passed
once, then passed again after adding persisted observations. No real CLI
60-second timeout or exit-code-3 reproduction is claimed.

## Source trace and tradeoff

**Read in source code, 0.1.636:**

- `src/core/scheduler/narrow-run.ts:73` selects already listed paths
  directly, before its source-path `affected()` branch. Nevertheless,
  `:129` requires a reconciliation pass after the request, and `:143`
  assigns every narrow request `runnerWork.always`.
- `src/core/scheduler/request-intake.ts:115` applies that pass rule;
  `:150` places the narrow plan behind `afterRunnerWork`. The synthetic
  fixture has no daemon reconciliation-pass provider, so it proves the
  runner-work dependency alone, not the extra real-daemon pass dependency.
- `src/core/scheduler/refinement.ts:114` invalidates changed paths;
  `:133` calls `listTestFilesOf` only for structural changes, recreated
  projects or a failed listing. Plain edits need not enumerate test files.
- `src/core/scheduler/runner-work.ts:338` sets `refining` across the whole
  fetch/apply operation. `scheduler.ts:991` exposes that flag as `listing()`.
  `src/core/daemon/run-group.ts:165` records `listing` when the lock is
  free. `src/cli/group-pending.ts:94` renders the issue's phrase;
  `:114` renders the pending-deadline explanation.
- `test/daemon/run-group-listing.test.ts:37` already pins the broader
  held-runner-work behavior and acceptance after release (source read,
  not independently run here).

**Read in official docs, 0.1.636:** `spec.md:446` says “no tier starts
until the revision is listed, promoted or not.” `status.md:357` records
0.1.567's diagnostics and the limited early named-status verdict. The latter
does not authorize running an edited file before its keys are refined.

**Inferred, 0.1.636:** the deciding tradeoff is faster explicit demand
versus correct discovery, closures and keys after edits. Raising queue rank
alone cannot help a request whose plan has not been taken. The receipt is
honest about no verdict but does not identify which runner operation holds
the revision. A new scheduling contract must preserve that uncertainty.

## Remaining evidence and sources

**Inferred, 0.1.636:** to diagnose the original delay, capture the revision's
changed paths, runner-part operation and elapsed time, runner recreation,
request acceptance timeline and reconciliation progress at the timeout.
Restart efficacy and the relationship to #271's 5,683-path reconciliation
remain unknown. Keep held #235 held; this finding does not establish an
automatic-quiet cause.

Sources read: [#283](https://github.com/hearsay-tools/squeal/issues/283),
[`issue-271.md`](issue-271.md), [`issue-273.md`](issue-273.md),
the gh-235 board row, the source paths and spec lines above. Benchmark
context was checked before probing: `bench/README.md`, the
`2026-11-24-0.1.627-vs-0.1.631-default-AMD-Ryzen-7-9700X-8-Core-Processor`
scorecard and its `cells/wt-3@0.1.631/session-wt0.jsonl`. They exercise
Vitest status waits, not this explicit-run acceptance dependency; no new
performance result is inferred from them.
