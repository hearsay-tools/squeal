# Wave 13l: re-review of 001-196 at 0.1.87

## Verification output

Candidate: `c46b1ee9d13fc62f16eaa61dba219e7a8982cb2c`, the supplied `origin/main` at the start of this review. Package version 0.1.87. The bounded product delta is `7bf2efef..c46b1ee9`, specifically 001-196 and its rebuilt plugins. Other specs' documentation in that range is outside this re-review. Linux, Node 24.21.0 and Node 22.23.3. Gates ran with a clean tracked tree, before writing this report.

```text
$ git rev-parse HEAD
c46b1ee9d13fc62f16eaa61dba219e7a8982cb2c

$ npm ci
added 56 packages, and audited 57 packages in 6s
found 0 vulnerabilities
(exit 0)

$ npm run lint  # Node 24.21.0
Checked 726 files in 591ms. No fixes applied.
(exit 0)
$ npm run typecheck
> squeal@0.1.87 typecheck
> tsc --noEmit
(exit 0)
$ npm run build
> squeal@0.1.87 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.87 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0)
$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist
(no output, exit 0)

$ npx vitest run --maxWorkers=4  # independent Node 24 gate
FAIL test/harness/stop-require-slow-snapshot.test.ts:115
Error: Test timed out in 5000ms.
Uncaught exception: write EPIPE
at test/harness/step-down.test.ts:39
Test Files  1 failed | 324 passed | 1 skipped (326)
     Tests  1 failed | 2342 passed | 10 skipped (2353)
    Errors  1 error
Duration 947.87s
(exit 1)

$ npx vitest run test/harness/stop-require-slow-snapshot.test.ts --maxWorkers=1
Test Files  1 passed (1)
     Tests  4 passed (4)
Duration 2.03s
(exit 0; isolated rerun of the full-suite failure)

$ npx vitest run test/harness/step-down.test.ts --maxWorkers=1
Test Files  1 passed (1)
     Tests  15 passed (15)
Duration 884ms
(exit 0; isolated rerun of the unhandled-error file)

$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH npm run lint
Checked 720 files in 554ms. No fixes applied.
(exit 0)
$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH npm run typecheck
> squeal@0.1.87 typecheck
> tsc --noEmit
(exit 0)
$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH npm run build
> squeal@0.1.87 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.87 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0; no tracked bundle drift)

$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH npx vitest run <scope files> --maxWorkers=4
Test Files  11 passed (11)
     Tests  60 passed (60)
Duration 56.63s
(exit 0)

$ node ./node_modules/vitest/vitest.mjs run --config <external>/probes.config.mts -t 'the actual capture'
Node 24.21.0
Test Files  1 passed (1)
     Tests  2 passed | 2 skipped (4)
Duration 38.55s
(exit 0)

$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH node ./node_modules/vitest/vitest.mjs run --config <external>/probes.config.mts -t 'the actual capture'
Node 22.23.3
Test Files  1 passed (1)
     Tests  2 passed | 2 skipped (4)
Duration 34.59s
(exit 0)

$ node --disable-warning=ExperimentalWarning <installed-0.1.86>/dist/cli/squeal.mjs run --all --wait
Checkpoint d5990903-3c9d-4168-8ddc-d16c984651b1 started at revision 2: 0 test files
Checkpoint d5990903-3c9d-4168-8ddc-d16c984651b1 completed
Revision: 2
Known failures: 2
Affected checks: 2667 passed, 0 running, 0 queued, 10 skipped
Full-suite checkpoint: completed at revision 2
(exit 0; failures are reported despite exit 0)
```

The Node 22 scope files were `test/scheduler/{environment-growth-same-revision,resolved-wait,environment-growth-wait,environment-growth-siblings,rekeyed,rekeyed-wait}.test.ts`, `test/cli/{status-wait-window,status-wait-edit,status-wait}.test.ts`, `test/daemon/sync.test.ts`, and `test/harness/skill.test.ts`. The Node 24 full suite includes these. This is the repository's required independent reviewer gate; Squeal's background results do not substitute for it.

`npm ci` warned that @parcel/watcher and esbuild install scripts are not yet covered by the allowlist. Node 22 emitted experimental SQLite and proxy-agent warnings. Different lint file counts include temporary fixtures created by concurrent checks. The Cezar restart stopped the first Node 24 full-suite attempt before any final summary or verdict; the completed run above replaced that interrupted attempt, not a completed proof. The independent full suite is not green: its one test failure is a 5,000 ms timeout in the unchanged Stop snapshot test, and its unhandled `EPIPE` is from the unchanged step-down test's stand-in socket. Both files pass in isolated reruns with their normal timeouts and without the error. The full run also printed two fixture git-directory repairs and a one-process sweep from an earlier test run. No cause in the reviewed repair is established; the full-suite failure and background known failures remain validation limitations, not hidden green claims.

External probes used the real Vitest adapter, scheduler, SQLite store, sink and public `waitForStatus`. The final probes call sync in the daemon's actual order: capture revision, immediately await `refined()`, then `rekeyedSince(after, captured, resolvedSince)`. They do not test socket transport; the repository's front-desk sync test covers the additive field's transport. The probes assert the observed defect and its control, so their green output proves the finding, not product correctness. Preliminary probes delayed calling `refined()` and established the retention behavior only; the final sequence is the evidence below. Two accidentally overlapping preliminary runs were stopped and support no finding. All custom probe code, fixtures, stores and observations were outside the repository and removed before committing. Only this report is committed.

The background baseline initially reported failures in departure, lifecycle, handover, package reruns and fixture generation. It later reported backlog, environment/observed growth, preload healing, refinement latency, tier sharing and linked-directory checks too; these test files are unchanged in the repair delta. Most recovered under the same inputs. Backlog cancellation recovered too. At the explicit `run --all --wait` checkpoint, all results were current and no files needed rerunning; handover (alive instead of spawned) and fixture generation (exit 1 instead of 0) remained known failures at revision 2. The host's observed load reached 122.04; timing pressure is plausible, but causation is unverified. The independent gate is recorded separately above. These background results are not a claim that everything passes.

## Verdict

**PASS c46b1ee9: 0 blockers, 1 proven should-fix note, 0 nits.** Wave 13k B1 is closed. Its literal S1 reproduction is closed, both skills now read the outcome, and N1's amendment entries are present. Both original 003 B1 regressions remain green on Node 22 and 24. The overall independent gate failed as recorded above; PASS is the bounded repair verdict. A second discharge can still erase the first edit's news before its sync answer; this retains S1's nonblocking severity and is a note from the repair delta, not a reopening of the proven B1.

## Blockers

None.

## Should-fix

### S1. A later cached result overwrites the discharge an earlier captured wait needs

**Proven on Node 24.21.0 and 22.23.3.** `src/core/scheduler/discharges.ts:25` replaces the file's previous discharge rather than retaining membership for pending answers. `since` at `:38` then filters the replacement out when its revision is beyond the sync's captured upper bound. The live attribution is already cleared, so `src/core/scheduler/scheduler.ts:322` names no earlier move of that file either.

This is the boundary D7 describes as “a later move never replaces the earliest” for a captured wait, and 001-196 S1 asks to keep “the membership captured for an active wait through its answer.” The original one-result S1 regression passes. This sequence adds one later key move resolved by an ordinary cache hit while the answer is awaiting an unrelated runner refinement:

1. Warm math's cache with a failing implementation `a - b` and a trailing `// cached` comment; then restore `a + b` and finish its passing result. These preparatory edits are revisions 1 and 2.
2. At revision 3 edit math to `a - b // target` and hold its real run. The wait's starting view still has math passing.
3. Edit strings at revision 4 and hold that revision's `invalidate` before delegating to the real adapter. Runner refinement and tier results run beside one another, as the production scheduler does.
4. Start the public wait. Its sync captures revision 4 and immediately calls `scheduler.refined()`, which waits for the held strings refinement.
5. Release math. Its FAIL discharges its revision-3 key move. `rekeyedSince(0, 4, startedAt)` at this point correctly names math as resolved at revision 3.
6. In the defect case only, restore math's cached failing bytes at revision 5. Content reconciliation looks the FAIL up and discharges that new move without needing a tier or the held runner refinement. The last-discharge map now contains revision 5 instead of 3.
7. Release the strings refinement. The exact daemon sync sequence answers at the captured revision 4. Its strings files are named; math is absent. The wait ends quiet after those files finish, with math's FAIL counted as other news.

| Final observation, identical on both Nodes | One-discharge control | Later cached discharge |
| --- | --- | --- |
| Captured / latest revision | 4 / 4 | 4 / 5 |
| Math in sync answer | resolved at 3 | absent |
| Outcome / own transitions | news / 1 | quiet / 0 |
| Edit files / other transitions | 3 / 0 | 2 / 1 |
| Snapshot known failures | 1 | 1 |

The full snapshot still shows the failure, and no owed result is hidden as complete. This misattributes news, as wave 13k S1 did; it is not a proven premature quiet with an unobserved current key. The control changes only whether the second cached edit occurs. The unrelated files pass in both cases.

Fix sized for one attribution worker: retain discharged membership needed by each outstanding captured answer, including a second discharge beyond its upper bound. Keep this history separate from `keyedAt`, bounded and removable when no active answer needs it. Do not revive completed historical attribution or make a resolved-only file hold for the forced failure rerun. Add the exact capture/refinement/cache-hit sequence and its control on both Nodes.

## Nits

None. Wave 13k N1 is closed: `status.md:150` records the D5 timeout split, `:151` records D7's unresolved attribution, and `:152` records the 001-196 additive sync contract. The latter explicitly leaves folding the accepted amendment into D7 to the coordinator; that follow-up is recorded, not a missing amendment entry.

## What fits

| Assigned question | Evidence and result |
| --- | --- |
| Wave 13k B1, same-revision completed sibling | `environment-growth-same-revision.test.ts` keeps both the ordinary wait and heard-window control open while a's new-key rerun is held, despite an old observation at that same revision. Both finish after the rerun. `editWindow` no longer compares observation revisions; the daemon's unresolved current-key attribution decides membership. |
| Wave 13k S1, literal result-before-answer reproduction | `resolved-wait.test.ts` runs the real failing math result before reading membership; the wait returns news, one own transition, one edit file and zero other transitions. Resolved-only files retain news without holding for a same-key rerun. The later-discharge limit is S1 above. |
| Both 003 B1s | `environment-growth-wait.test.ts` retains the earlier outstanding file through unrelated later revision/growth, with the no-environment-report control; `environment-growth-siblings.test.ts` holds for completed siblings regrown under the current revision. No discharged record feeds live `keyedAt`. |
| Sync seams | `resolvedSince` passes from the CLI through parsing, handler, front-desk worker message, desk callback and daemon into the scheduler in the same argument order. `sync.test.ts` exercises parsing, handler and worker-thread transport; `rekeyed.test.ts` verifies time bounds and a later still-owed move. The fields are additive and optional on the wire. |
| Skill inference | Both plugins' red/green section says quiet means no owed result remains and reads the snapshot's `Known failures`; it no longer infers a pass from quiet. `skill.test.ts` pins that distinction and common wording. |
| Packaging | Both Node builds reproduce both tracked plugin distributions. Version 0.1.87 is consistent. No new dependency, SQLite schema change or persisted attribution history. |

The worker notes report that the two new regressions fail at `7bf2efef` on both Nodes. This re-review independently ran their green side and inspected the removed comparator/clearing paths; it did not replay the base's red side.

## Inputs for the next wave

1. Credit B1, the literal S1 reproduction, the skills and N1 as repaired. Retain both new regressions and both 003 B1 regressions.
2. Dispatch the proven later-discharge S1 as an attribution repair, preserving per-wait membership without restoring completed `keyedAt`; retain D7's slow/baseline/backlog/forced-rerun/later-edit exclusions. Rebuild both plugin distributions and advance their package version when that repair lands.
3. Fold the recorded 001-196 amendment into D7: the answer can contain unresolved current-key moves and resolved membership for news, with the latter held for no work.
