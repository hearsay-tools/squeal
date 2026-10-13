# Wave 13au: second review of 001-307 after 001-312

Candidate: `25faa1b052ccb24fbed1f903310c0ea3aa064131`.
Repair range: `bdd40f51..25faa1b0`. Board row: 001-316.
Bounded by `reviews/wave-13ar.md`: re-check B1, inspect the repair delta and the agreed additions. Contracts: 001 D4, D5, D7; 005 D3 and the agreed empty-entry contract.

## Verdict

**PASS**. 0 blockers, 1 proven nonblocking should-fix note, 0 nits. B1 is fixed. The independent full suite has one unchanged timing-test failure, passing in isolation; it is recorded below, not hidden by the review verdict. No product code or board changed by this review.

## Verification output

All checks below ran at exact candidate `25faa1b052ccb24fbed1f903310c0ea3aa064131` with a clean tracked tree. `git status --porcelain` was empty before the gates, after the build, after the full suite and after the isolated retry. The findings file was written afterwards. The build reproduced both committed plugin distributions. This is the independent reviewer run, not Squeal's checkpoint. No eval sessions were run.

```text
$ git rev-parse HEAD
25faa1b052ccb24fbed1f903310c0ea3aa064131
$ git status --porcelain
(no output)

$ npm ci
added 56 packages, and audited 57 packages in 1s
18 packages are looking for funding
  run `npm fund` for details
found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
npm warn install-scripts
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
(exit 0)

$ npm run lint
> squeal@0.1.141 lint
> biome check .
Checked 978 files in 2s. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.141 typecheck
> tsc --noEmit
(exit 0)

$ npm run build
> squeal@0.1.141 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.141 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0; git status --porcelain produced no output)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run --maxWorkers=4
RUN v5.0.3
FAIL test/runners/node-test/enumerate.test.ts > enumeration cost > enumerates 200 generated test files in under half a cold graph build
AssertionError: 365.3601119999994 ms against 634.4873729999999 ms: expected 0.575835119101731 to be less than 0.5
at test/runners/node-test/enumerate.test.ts:376:74
Test Files  1 failed | 455 passed | 1 skipped (457)
Tests       1 failed | 3837 passed | 10 skipped (3848)
Start at    15:23:31
Duration    681.89s (tests 96%, import 2%, transform 1%)
(exit 1)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run test/runners/node-test/enumerate.test.ts --maxWorkers=4
RUN v5.0.3
Test Files  1 passed (1)
Tests       15 passed (15)
Start at    15:35:08
Duration    3.72s (tests 91%, transform 7%, import 2%)
(exit 0)
```

Each npm/npx command also printed `npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See npm help npmrc for supported config options.`

The full-suite failure is verified. Host contention as its cause is **plausible**, not proven: sampled load ranged from about 23 to 92 while several full review gates and background validation ran. The failed test, enumerator and graph implementation are unchanged in the repair range. The failing test calls enumeration and the cold graph build directly; it does not invoke the changed observation/scheduler path. All 15 tests pass in the isolated retry. This is verification evidence outside the repair's blast radius, not a finding against the wave. The full suite did not pass; the retry does not replace it. One full proof was run.

The full run printed two fixture `repair: gitdir incorrect` diagnostics, experimental type-testing notices and a global-setup line killing one process an earlier run left. None produced another failed test or an unhandled-error result.

The full gate re-ran the prior B1 probe through `test/scheduler/warm-up-in-flight.test.ts` (4 tests). It also passed `test/scheduler/warm-up.test.ts` (3 tests), the existing real-daemon `test/daemon/run-all-warm-up.test.ts`, and `test/cli/warmup.test.ts`, including the tightened assertion. Their scenarios and assertions are described below.

## Blockers

None. First-round B1 is closed.

## Should-fix notes

### S1. Proven, nonblocking: the warm-up's advertised run count still describes reuse

Location: changed `src/core/scheduler/scheduler.ts:268`, caller `src/cli/warmup.ts:106`, setup question `src/cli/setup/questions.ts:146`, and `test/cli/warmup.test.ts:62`.

The repair makes every `observeIgnored` request forced, including a second `squeal warmup` in an already-current worktree. The CLI still subtracts the current files and announces “the first run covers 0 of N test files, those without a current result”. Setup similarly asks to run only files without current results. Both then call the observation checkpoint, which re-runs all runnable files. The existing CLI test still expects that zero announcement and comments that the second warm-up runs none; its assertions check text and exit status, not runner reuse. This discrepancy is introduced at the repaired scheduler/caller boundary. It understates the work and cost of the requested warm-up; it does not fabricate a current result or lose the repaired ignored-read evidence.

This is a note under the bounded re-review rule, not a new blocker. One 005 worker can update the warm-up announcement and question to describe a fresh observation run of all runnable files, align the plan's description of its counts, and replace the second-warm-up test's reuse claim with evidence of a fresh checkpoint. Preserve reuse for an ordinary `run --all` without `observeIgnored`. Done when an already-current worktree is advertised honestly and its warm-up executes the advertised observation work.

## Nits

None.

## First-round findings and what fits

- **B1 closed, proven by the re-run.** The observation request now calls `queueFullSuite(ledger, true, true)`: fresh disables the joining branch and forced queues every runnable file, including slow files. The new checkpoint's strict attribution prevents an older unflagged tier from satisfying it. `WarmUp` uses only its own returned id; the metadata writer still checks that id before adding a tier's reads. Ordinary requests keep the earlier joining and result-reuse branches.
- **Prior probe re-run.** The real composite runner is held after the scheduler chose its options, using a wrapper that passes those options unchanged. A non-forced observing request during the node:test baseline records `ignored/build.txt` after the held unflagged run and a fresh flagged run; the assertion checks `[false, true]`. A forced observing request during an ordinary forced checkpoint and a non-forced request during a held slow Vitest tier likewise complete with the artifact in node:test, forks and threads entries. Every case checks the metadata names the returned request id and has empty entries for the quiet files. The fourth case observes a slow Vitest file made stale immediately before the request. These are the first-round failure scenarios, not just a fresh idle warm-up.
- **S1 closed.** The dated 001-307 D4 amendment is now in `status.md:226`, naming unkeyed capped metadata, `readIgnoredReads`, B1 and the empty-entry agreement. The repair extends D4 with the fresh forced checkpoint and missing-versus-empty meaning. No reviewer edit to either spec or status was needed.
- **N1 does not recur.** Initial HEAD is exactly the assigned candidate.
- **Empty versus missing entries.** `readsOfEvery` supplements only the warm-up `reads` payload, never ordinary `observed`. Both runners add entries only for completed files; Vitest does so only with an active observer and the flag, node:test only when `NodeTestReads.start` found a recorder. `WarmUp.read` now retains an entry even when filtering leaves no ignored paths. Missing-recorder and observer-off paths still omit `reads`, so they produce no entry.
- **Keys and closures remain separate.** The added helper does not change ordinary observation or node:test module-graph extraction. Ignored paths still enter only the worktree meta row. The passing snapshot tests compare every test-file key and closure and every check state before and after observation, with the node:test project preload excluded from the test closure. The ignored-edit regression confirms no added run and no changed snapshot. After the baseline and ordinary forced-checkpoint probes, an ordinary non-forced checkpoint completes with no additional runner calls; the prior snapshot stays equal.
- **CLI assertion is tightened as agreed.** `test/cli/warmup.test.ts:202` requires exactly `squeal setup: test/build.test.ts read no ignored path` and rejects `no ignored read recorded`. Setup declares `build/**` as an input, so the observed slow file has an empty suggestion entry because that read is already in its closure. The former either/or assertion is gone.
- **Packaging.** Both plugins and root package are 0.1.141. The guarded sources are re-pinned under unreleased key format 9. Build verification found no committed distribution drift.

## Inputs for the next wave

- No further B1 repair row is needed. Dispatch S1 to 005 as one caller wording/count/test follow-up.
- Public order stays: send `{ type: "run-all", observeIgnored: true }`, wait for its returned checkpoint to complete, then read `readIgnoredReads(store, worktreeId)` and match its `checkpoint` to the returned id. Observation requests replace an open checkpoint rather than join it and run every runnable file forced, slow files included.
- Records use `<project>\0<path>`, at most 50 sorted unique paths per file, and exact per-file `more`. Empty `{ paths: [], more: 0 }` means observed with no ignored read beyond the closure; missing means not observed. A partial, absent or mismatched record cannot prove no ignored dependencies. `observe.runtimeInputs: false` still leaves Vitest unobserved.
- 005's already-agreed wording follow-up can now remove “or it read none” and the joined-baseline explanation for a missing entry (`005-agent-adoption/status.md:113`). This is the existing handoff, not another finding against this repair.
- Keep ignored paths outside keys, closures, results, revisions and invalidation. Ordinary checkpoints still reuse current results and leave the last observation record alone. Preserve classification outside the scheduler lock and metadata writing in the tier transaction.
