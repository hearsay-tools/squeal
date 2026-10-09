# Wave 13k review: 001-195

## Verification output

Candidate: `ff5808ebd6e54203487d3b4a668de54a6b821df1`, version 0.1.86, the initial `origin/main` and assigned `HEAD`. The executable landing is `a9f96c91`. Scope: 001-174, 001-178, 001-179, 001-181, 001-191, 001-192 and 001-194; 003-43/45 only at their wait-attribution seam. The nominal delta is `70a99c82..ff5808eb`; 001-191's explicitly assigned change `190f679f` is already in the base and is included in this review. The two explicit prior questions are 003 `reviews/wave-4.md` B1 and `reviews/wave-4.5.md` B1.

The gates ran against the clean candidate before writing this report. Node 24.21.0 and Node 22.23.3, Linux. Later movement of the shared `origin/main` ref does not change this candidate. Only this report is committed.

```text
$ git rev-parse HEAD
ff5808ebd6e54203487d3b4a668de54a6b821df1

$ npm ci
added 56 packages, and audited 57 packages in 1s
found 0 vulnerabilities
(exit 0)

$ npm run lint  # Node 24
Checked 723 files in 181ms. No fixes applied.
(exit 0)
$ npm run typecheck
> squeal@0.1.86 typecheck
> tsc --noEmit
(exit 0)
$ npm run build
> squeal@0.1.86 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.86 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0)
$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist
(no output, exit 0)

$ npx vitest run --maxWorkers=4  # independent Node 24 gate
Test Files  323 passed | 1 skipped (324)
     Tests  2340 passed | 10 skipped (2350)
Duration 548.03s
(exit 0)

$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH npm run lint
Checked 723 files in 232ms. No fixes applied.
(exit 0)
$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH npm run typecheck
> squeal@0.1.86 typecheck
> tsc --noEmit
(exit 0)

$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH npm run build
> squeal@0.1.86 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.86 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0; no tracked bundle drift)

$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH npx vitest run <scope files> --maxWorkers=4
Test Files  19 passed (19)
     Tests  98 passed | 1 skipped (99)
Duration 40.89s
(exit 0)

$ node ./node_modules/vitest/vitest.mjs run --config <external>/probes.config.mts
Node 24.21.0
Test Files  2 passed (2)
     Tests  4 passed (4)
Duration 18.04s
(exit 0)

$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH node ./node_modules/vitest/vitest.mjs run --config <external>/probes.config.mts
Node 22.23.3
Test Files  2 passed (2)
     Tests  4 passed (4)
Duration 22.24s
(exit 0)
```

The Node 22 scope files were `test/scheduler/{environment-growth-wait,environment-growth-siblings,environment-growth,rekeyed-wait,rekeyed,timed-out-tier,discards,linked-start}.test.ts`, `test/cli/{status-wait-window,status-wait-edit,status-wait}.test.ts`, `test/delivery/idle-cost.test.ts`, `test/integration/optimizer-off.test.ts`, `test/watcher/{reconcile-pass,linked-dirs,linked-files,links}.test.ts`, and `test/harness/{skill,waiter}.test.ts`. The supplied `primer.test.ts` filter matches no additional file; primer assertions are in the harness suite. The reconciliation measurement skipped its budget assertion because the host exceeded load 8. Ten idle runs under 500 ms are **unverified**, not a blocker or a failure of this wave.

`npm ci` warned about the install-script allowlist for @parcel/watcher and esbuild. Node 22 emitted SQLite and proxy-agent experimental warnings. The Node 24 gate printed two fixture gitdir repairs and one earlier test-process sweep, without failures. The repository's reviewer gate requires independent Vitest, so no Squeal checkpoint substitutes for it. One full suite only; the Node 22 run checks the assigned boundaries.

External probes used the candidate's real adapters, scheduler, store, sink and public `waitForStatus`; sync followed capture revision -> `refined()` -> `rekeyedSince`. They do not exercise socket transport. Reports assert the observed bad behavior plus a control, so green probe output is evidence for the findings below, not evidence that the product is correct. No other repository or daemon was used. Final probe fixtures, switches, stores and code were outside the repository and were removed before the report commit. Initial setup attempts used an incorrect check name and released a run before it had started; they timed out and support no finding. Fixture placement and cleanup were corrected before the final runs.

## Verdict

**FAIL ff5808eb**. One proven blocker, one proven should-fix, one documentation nit. Both literal prior B1 reproductions are closed on the integrated candidate on Node 22 and 24. The same completed-sibling boundary remains broken when completion and later growth occur within one revision: the scheduler names the outstanding file correctly, but the CLI treats its previous-key result as having discharged the new key.

## Blockers

### B1. A result at the same revision, under the previous key, makes a regrown sibling disappear from the wait

**Proven on Node 24.21.0 and 22.23.3.** `src/cli/status-wait-edit.ts:115` excludes a told file whenever its starting `observedAt` is at least the re-key revision. It checks no key identity. This is the assigned 001-191 comparator meeting 001-194's clearing at `src/core/scheduler/ledger.ts:263` and the growth settle at `src/core/scheduler/tiers.ts:398`.

D7 requires a told revision to count while a file “had no result under its new key when the wait started,” with first-observation reruns included. An observation at the same revision under a different key is no result under the new key. This also fails 001-195's explicit question whether a wait can end quiet while a file an edit re-keyed has no result.

The external probe adapts the completed-sibling reproduction to two files, with ordinary node:test scheduling and `tierSize = backlogTierSize = 1`. No custom lane or priority override:

1. Baseline a and b pass with `--require ./scripts/setup.cjs`, whose computed preload loads tracked p0. Both p0 and p1 already exist; an external switch controls which it loads.
2. Edit a, revision 1, and let it pass. At baseline a is quick and b sleeps 700 ms.
3. In one batch edit a and b, revision 2. Make a sleep 1,400 ms. Its previous quick duration orders a first; it still loads p0 and stores a current PASS observed at revision 2. That result clears its attribution.
4. Before b's run, change only the external switch to p1. b observes the new preload, so its incomplete-key result is withheld and growth rekeys both files. a now correctly has `keyedAt = 2`; its old known state still has `observedAt = 2`, with validity pending under the grown key.
5. b's complete-key rerun goes first by its 700 ms last duration, ahead of a's 1,400 ms. Let b finish and hold a before its rerun executes.
6. Start the public wait, without a registered session consumer. It captures revision 2 and receives a at revision 2 from the real scheduler. Its initial `lastHeard` is 2. The comparator considers a seen through solely because its old result was also observed at 2.
7. The wait returns quiet with zero edit files and zero edit pending while a's actual key row remains running and its old checks remain pending. Release a only after recording that response; draining then produces a current result.

The switch is a controlled stimulus for an observed preload path, not a claim that an external file should enter the closure. The failure concerns waiting for the resulting keyed work, not the accepted external-input boundary.

| Observation, on both Nodes | Ordinary wait | Control: consumer last told revision 1 |
| --- | --- | --- |
| Captured revision | 2 | 2 |
| Scheduler's named file | a at revision 2 | a at revision 2 |
| a's old observed revision / validity | 2 / pending | 2 / pending |
| Actual a / b key-row pending | running / none | running / none |
| Wait after 500 ms held | quiet, 0 edit files, 0 pending | still waiting |
| After releasing a | response already returned | quiet, 1 edit file, 0 pending |

The control changes only the wait's heard revision, keeping the bytes, order, growth and held run identical. With a registered consumer last told revision 2, the faulty told-file branch is the same as the ordinary no-consumer wait. The header still counts the pending work honestly. No incomplete-environment result is published or inherited.

Fix sized for one coordinated scheduler/CLI worker: decide whether the **current key** has been observed, or carry an equivalent generation token for each unresolved key move. Do not use revision comparison alone. Preserve the distinction between pending work an edit or growth owes and forced same-key backlog/new-failure reruns, which D7 excludes. Keep both literal prior B1 regressions, and add this same-revision completed-sibling sequence and its heard-window control on both Nodes.

## Should-fix

### S1. Clearing attribution before sync reads membership loses the edit's own news; the new skill infers a pass from quiet

**Proven on Node 24.21.0 and 22.23.3.** `Ledger.applyResults` clears attribution at `src/core/scheduler/ledger.ts:263`, `Scheduler.rekeyedSince` reads only surviving unresolved attributions at `src/core/scheduler/scheduler.ts:311`, and sync reads those after awaiting refinement at `src/core/daemon/daemon.ts:469`. The CLI cannot attribute a result that completed between the wait's start and that answer. Its unit test for this case (`test/cli/status-wait-window.test.ts:135`) supplies fixed membership, so it cannot see the real scheduler clearing it.

The external Vitest probe begins with a current math PASS, edits it at revision 1 to fail, and holds the tier after it starts. The wait captures revision 1. A later unrelated strings edit holds its runner refinement; release math and record its FAIL before releasing the refinement. The exact sync sequence returns `rekeyed: []`, and the wait returns `quiet`, zero own transitions, `otherTransitions: 1`. The control names the file before releasing the same failing run and returns `news`, one own transition, one edit file.

There is no pending edit file at the faulty response, and the full snapshot still shows the FAIL, so this is not B1's premature completion or a hidden stored failure. It misclassifies the edit's news. `plugins/claude-code/skills/squeal/SKILL.md:27` and the same red/green wording in the Codex skill make that consequential: “A wait after the revert that returns on quiet means the test still passes: it does not catch the bug.” The proven response is quiet with a new failure, so that new guidance is false.

Fix scope: preserve membership captured for an active wait through a result arriving before its sync answer, without reviving discharged attributions for future growth. Add a real-scheduler regression for the unit test's delayed-answer scenario. Independently make the red/green example check the shown result or known failures; quiet proves no owed work remains, not a passing outcome. Do not restore every completed historical `keyedAt`, which would reopen 003 wave-4.5 B1.

## Nits

### N1. New D5/D7 rules have no amendment entry

**Proven documentation drift.** `docs/specifications/001-core-loop/spec.md:103` adds timeout splitting and `:139` changes the wait's attribution contract. `status.md` has no entry for 001-179 or 001-194 and is unchanged across the nominal review delta. The process calls it the amendment log; the wave's shared rules require a status line per row. The coordinator should record the accepted timeout-splitting and unresolved-attribution semantics there. No board edit or product change is needed for this nit.

## What fits

| Assigned boundary | Evidence and result |
| --- | --- |
| 003 wave-4 B1: captured revision 1, unrelated revision 2, growth | Both `environment-growth-wait.test.ts` cases pass on both Nodes. The original earlier outstanding file survives the unrelated later revision through its rerun; the no-environment-report control remains pending too. |
| 003 wave-4.5 B1: completed siblings from earlier revisions | `environment-growth-siblings.test.ts` passes on both Nodes. Clearing completed a/c attribution makes growth give them the current revision and the wait holds for their reruns. B1 above changes only the boundary the literal reproduction did not cover: completion at that same revision. |
| Later real edits and terminal results | `rekeyed-wait`, `rekeyed` and `discards` pass on both Nodes. Earliest/latest unresolved moves preserve an earlier captured window and the later window; a current result or terminal unknown clears them, while an older-key result does not clear a newer key. |
| Timeout splitting, 001-179 | Both real-Vitest cases pass on both Nodes: completed siblings are retained, uncompleted tiers halve, the hanging singleton becomes unknown with the timeout reason, and pending work drains. The cap follows every selected file, preserves forced/recent queue flags and clears on results; slow lanes retain their previous timeout behavior. The cap is in memory only, as D5 states; restart may first try a wider tier. |
| Idle marker, 001-178 | `idle-cost.test.ts` passes on both Nodes: 15,000 known states are listed at most once over 240 unchanged polls, and a write on the same connection or another connection wakes the next poll. Source inspection: marker-before-delivery and the separate own/other counters retain a concurrent other's commit for the next poll. No stale-after-commit marker reproduced. |
| Optimizer note and regression, 001-181 | `optimizer-off.test.ts` passes on both Nodes, including on -> off -> on header behavior. Historical notes remain dated in status. The slow-instance regression clears the old cache, asserts a NEW-only bundle and the fresh failing control before running the current slow adapter. The cache precondition is now discriminating; no optimizer behavior outside this note/test repair is re-reviewed. |
| Reconciliation links, 001-192 | Linked directories, linked files, links and linked startup checks pass on both Nodes. The shared first lstat identifies symbolic links; only they enter the second link probe, and the startup all-path probe runs concurrently. The budget is measured but its idle threshold is unverified here. |
| Skill text, 001-174 | The common guidance agrees across both skills (Codex adds its CLI-path instruction); the worked example, busy-host 120 s wait, avoidance of duplicate neighboring runs and repository-gate exception are present. Harness tests pass. The quiet-implies-pass sentence is S1. The primer is unchanged. |
| Packaging and public seams | The build has no tracked bundle drift. `lastKeyedAt` and `tierCap` are scheduler internals; the optimizer callback is optional; `ChangeMarker` reads the opened store's connection. No schema migration or new runtime dependency. |

## Inputs for the next wave

1. Send B1 to the human as the brief requires. Both literal 003 cases can be credited as closed; do not claim their combined wait guarantee holds for same-revision growth.
2. A repair needs key-aware or generation-aware unseen-result accounting and active-wait membership through sync, while retaining D7's exclusions for slow work, baseline, forced same-key runs and the new-failure rerun. Coordinate the scheduler and CLI changes; replacing earliest with latest would reopen the captured-earlier-window failure.
3. Keep environment reread -> observed preparation -> transactional recording and incomplete-environment withholding unchanged. The blocker requires no new observation/package-key work and no relaxed stability check.
4. Keep the same-revision sibling and heard-window control, both original B1 regressions, and a delayed-sync failing result as the discriminating tests on Node 22 and 24.
5. Correct the skill's outcome inference and record the accepted D5/D7 amendments. The ten-run idle reconciliation measurement remains a separate verification item for a calm host.
