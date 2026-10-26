# Integration checks: Cezar coverage repair

Candidate: `5234d29d2`, `cand/0.1.347`. Product and test content stays at that commit. Later commits add documentation only.

| Command | Result |
|---|---|
| `npm ci` | exit 0, 196 packages installed |
| `npm run build` | exit 0; TypeScript and all four plugin builds |
| `npm run lint` | exit 0; 2254 files checked, no fixes |
| `npm run typecheck` | exit 0 |
| `npm run check:version -- origin/main` | `version bump: 0.1.345 -> 0.1.347, ok` |
| `npx vitest run test/keys/key-format.test.ts test/version-sensitive.test.ts` | exit 0; 2 files and 18 tests passed in 86.91 s |

The key comparison finds no different stored outputs and exercises every changed line. The coordinator accepts unchanged adapter and coverage-provider versions. The payload format is unchanged. Missing coverage records can arrive on a later run; the fixes do not make an existing valid test result invalid.

The worker's six scoped provider, reporter and runtime test files had current passing results. Its final known failures were four bundle-drift tests, because workers do not build plugin bundles. Integration rebuilt the bundles. The worker still had 100 of 1165 files pending, so it claimed no result for those files.

The parent also observed the existing OpenCode held-Stop deadline failure (board row 008-38) before and after integration. It has not been fixed in this candidate. The Cezar navigation timeout remains a review input, as recorded in `../013-09/notes.md`.

Full-suite evidence is pending in candidate CI [40336082558](https://github.com/hearsay-tools/squeal/actions/runs/40336082558). Release requires passing full-suite CI on the exact release commit.

Parent affected status at revision 28 (`squeal status --wait 60000` on the four changed sources and validity cases): 190 current (189 pass, existing OpenCode 008-38 fail), 223 selected files pending. It returned at its 61 s deadline. This is partial affected evidence, not a full pass. The reviewer independently observed current passing results for key-format, version-sensitive and seven focused provider/reporter files.

## Candidate CI repair

The first candidate CI 40336082558 failed Node 22 shard 2 on `test/cli/install-sh.test.ts:221`: `install.sh` named 0.1.345 while `package.json` named 0.1.347. Commit `ab0ca19b5` corrects only that literal after a docs-only main rebase. Product, test and bundle bytes remain identical to the reviewed `5234d29d2`. New exact-candidate CI: [40338863343](https://github.com/hearsay-tools/squeal/actions/runs/40338863343). Narrow integration re-review: worker 77f11322. No release is permitted while its full-suite result is missing or failed.

Review N1 is retained as planned row 013-11 with a bounded research brief. Both original workers were collected at their latest settled revisions, their desired commits integrated, and their resources destroyed.

## Integration onto main 0.1.346

Main advanced with reviewed lint data-layer row 017-03 at `b089ea554` while candidate CI ran. The coordinator rebased onto `92d3b5420`, removed the obsolete build and installer-version commits, and rebuilt 0.1.347 as `9bb4edd09`. The coverage source/tests and key validity cases are byte-identical to `ab0ca19b5`. The new lint source/tests are unchanged from main.

`npm ci` and `npm run build` exit 0. Lint exits 0 (2275 files), typecheck exits 0, and `npm run check:version -- origin/main` accepts 0.1.346 to 0.1.347. The required key/version gate also includes the install-sh test this time; it is still running. A narrow combined-bundle review is with bdd7eaa4. Candidate CI on the earlier main base is superseded. No full-suite pass or release is claimed.

The combined required gate on `9bb4edd09` completed with exit 0: `npx vitest run test/keys/key-format.test.ts test/version-sensitive.test.ts test/cli/install-sh.test.ts`, 3 files and 34 tests passed in 77.40 s. Log and exit file: `/home/agent/projects/squeal/.ai/cezar/t/0bcb0e92/gate-347-main346-v2.{log,exit}`. The earlier background invocation ended without a verdict and is not passing evidence. Exact candidate CI is [40341559730](https://github.com/hearsay-tools/squeal/actions/runs/40341559730), still running.

## Validity fixture repair after CI

Full CI `40341559730` failed only `test/keys/validity/compare.test.ts:45`; Node 24 and Node 22 shards 2 and 3 passed. Both sides of the nested/cyclic/deep cause case timed out waiting for the held-test marker. The harness always awaits that marker for a normal run. The new fixture had no held test. This is deterministic, also seen locally; no load retry is used.

Commit `4b5ec844d` adds the existing `HELD_ONLY` fixture and its run reference, as the adjacent failure case does. No timer, runtime, bundle, dependency, version or installer changed. Lint and typecheck pass after the repair. The expanded required gate includes validity compare and is running; narrow fixture review and exact-candidate CI [40344557989](https://github.com/hearsay-tools/squeal/actions/runs/40344557989) remain pending. The earlier key gate alone did not prove every corpus case completed; its passing result did not remove this CI blocker.

The expanded gate on `4b5ec844d` passed with exit 0: `npx vitest run test/keys/key-format.test.ts test/version-sensitive.test.ts test/cli/install-sh.test.ts test/keys/validity/compare.test.ts`, 4 files and 47 tests in 84.55 s. Log and exit file: `/home/agent/projects/squeal/.ai/cezar/t/0bcb0e92/gate-347-held.{log,exit}`. This includes the comparison which proved the fixture defect in CI. Exact candidate CI remains running.

## Final validity corpus gate

Commit `c4606afb0` updates both exact mutation expectations for the new cause case. Mutating error names changes that case's stored fingerprints, so it belongs in the differing-case and version-raise lists. No runtime or bundle changed. Squeal reports adapters and comparison current/pass.

On exact candidate `664494b46`, the explicit gate ran key-format, version-sensitive, install-sh and all eight validity self-test files. It passed with exit 0: 11 files, 77 tests passed and 2 expected failures, in 117.20 s. Log: `/home/agent/projects/squeal/.ai/cezar/t/0bcb0e92/gate-347-corpus.log`. The resumed reviewer passed this exact candidate with no blockers (`reviews/0.1.347-corpus.md`). Latest settled revision 1 was collected, integrated and destroyed.

Final candidate full-suite CI: [40346302424](https://github.com/hearsay-tools/squeal/actions/runs/40346302424), exact `664494b46ab00b9235f9744b9a9f7028b5ef3ea5`, pending. Older candidate runs do not provide evidence for these final inputs. Main CI and actual Cezar recovery are still required.

Affected status at revision 51 (`b6f8524c3`, documentation only after final candidate): `squeal status --wait 60000` on changed provider/reporter/coverage sources and adapters self-test exits 0. All 411 selected files and all 1174 worktree test files are current; known failures 0. The existing OpenCode held-Stop check recovered on Squeal's automatic retry with the same tracked inputs. Code metrics call the two worker-only provider helpers untested in the daemon process; explicit worker regressions and the 390-record Cezar probe exercise them in worker processes, which that metric does not measure.

## Landing

Final candidate full CI [40346302424](https://github.com/hearsay-tools/squeal/actions/runs/40346302424) passed on exact `664494b46ab00b9235f9744b9a9f7028b5ef3ea5`: all three Node 22 shards and Node 24 lint/typecheck/version/build/bundle checks passed. Main's last product CI [40340324506](https://github.com/hearsay-tools/squeal/actions/runs/40340324506) passed.

The candidate was rebased onto `b12ab606a`, whose changes since the reviewed 0.1.346 base touch only `docs/board.md` and 017's status. `git diff --exit-code 664494b46 HEAD -- src test plugins package.json package-lock.json install.sh` exits 0. Review and local gate evidence therefore applies to the same product bytes. Full CI on the final main release commit is still required before tagging.

## Release and actual recovery

Exact main release CI [40349531967](https://github.com/hearsay-tools/squeal/actions/runs/40349531967) passed on `ed116cba4cf403c2952f0d13046b01de2a864e4c`, all three full-suite shards and Node 24 checks. The clean checkout was tagged `squeal--v0.1.347`. Hub commit `3af4fbc` updates both marketplace entries and passes validation. [GitHub release](https://github.com/hearsay-tools/squeal/releases/tag/squeal--v0.1.347) is latest and contains the tagged installer. Issue #102 remains open for 015-70, with a partial-fix comment.

Claude project and user installations updated to 0.1.347. The Cezar main daemon handed over from 0.1.346 in 12.4 s. Its store records daemon version 0.1.347 and start time `1793029634965`. Before the recovery run its code store contained zero coverage records. A five-file sample from the saved provider-error unknowns is being queued; busy database requests are repeated only when explicitly refused. Current recovery verdicts and coverage records are pending.

## Recovery verified

The released 0.1.347 daemon in `/home/agent/projects/cezar` completed four sampled files which previously had provider-load errors. Read-only joins of `results`, `checks` and compressed `coverage` records identify the main worktree, passing outcomes, result keys and source mappings:

| Test file | Revision | Mapped sources | Functions hit |
| --- | --- | --- | --- |
| server `agent-config/models.test.ts` | 173 | 14 | 64 |
| web `api/github-pages.test.ts` | 175 | 6 | 35 |
| web `api/global-events-lifecycle.test.tsx` | 173 | 79 | 116 |
| contract `project-webhooks.test.ts` | 173 | 16 | 8 |

The code store started with zero coverage records and now holds eight. The four records above contain relative source paths and executed functions. They prove actual DOM and separate-project collection through the released daemon, rather than provider loading alone.

The fifth sampled file, web `api/client.test.ts`, recovered by inheriting a passing result from another worktree. Its initial retry had been claimed by an older daemon in another worktree and ended unknown. Later explicit requests met database contention; only refused requests were repeated. No failed assertion was retried. A redundant pending retry was checked for cancellation after the result became current; no pending request remained at its current inputs.

Final named command: released CLI `status --wait 60000` on those five paths, exit 0 after 5.0 s, revision 176. All five have current passing results; worktree known failures 0, unknown 0, and 84 of 1073 test files remain queued. No full checkpoint or broad retry was requested. Concurrent Cezar changes then moved the sampled keys and all five adopted passing results from other worktrees. Their current keys have no coverage record; the completed recovery records above remain at the earlier keys. This is a historical runtime proof, not a claim of current coverage for every sampled file.

[Published read-only evidence snapshot](/p/squeal/tasks/0bcb0e92-fc4e-4f9c-92b4-67e710638b5b/files?artifact=718f95a6-b36e-4e97-83da-bbd7110c0d6d). Raw command output remains in `cezar-recovery-347-final.log` under the task scratch directory. Planned row 013-11 retains the loaded navigation risk; issue #102 retains only 015-70's additional fallback.
