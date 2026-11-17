# Wave 7 re-review: status at a commit with `--run`

FAIL 83afcad17f51062c93a47b1ef6350613445ea944

One proven blocker remains: B5. B1, B2, B3, B4, B6 and B7 are closed for their original failure scenarios. The simple B5 reproduction is fixed, but the replacement check still permits modified tracked inputs to run and be stored as the named commit.

This is a bounded re-review of `wave-7.md`, read from review commit `f5f30ff96923aea2eac50f0f185c7e70251f5d2c` because that file is not present on the candidate. The product delta from the original candidate is repair `aaa5e57d5` and bundles `83afcad17`. No product files were edited.

## Verification

All direct checks and independent probes below ran at the exact requested candidate on a clean tree. The fixture repositories and probe scripts were outside it. Dependencies were already installed; the earlier instruction not to repeat setup remains in effect.

| Check | Actual result |
| --- | --- |
| `git fetch origin`; `git checkout --detach 83afcad17f51062c93a47b1ef6350613445ea944`; `git rev-parse HEAD` | Exact requested SHA. |
| `pnpm run lint` | Exit 0: `Checked 3670 files in 1756ms. No fixes applied.` |
| `pnpm run typecheck` | Exit 0, `tsrs --fast --noEmit`. |
| `pnpm run build`; `git status --short` | Exit 0. All four plugin builds completed; the tree stayed clean. |
| `pnpm run check:version origin/main 83afcad17f51062c93a47b1ef6350613445ea944` | Exit 0: `version bump: 0.1.548 -> 0.1.549, ok`; fixed adapter `1.0.3 -> 1.0.3, ok`. Fetched main was `d8d611bc197cb9ae5fdf525d43ed3bfb08904fb3`. |
| Squeal waits below | Exit 3. Revision 3 had not been listed. The affected wait reported 221 passes from revision 2 and 79 pending, with 83 files queued in the worktree. These older results do not verify the repaired candidate or its new tests. No known failure was reported. |
| Final focused Squeal wait after adding this report | Exit 3: the original run test, killed-run test and version-sensitive test had current results with no known failures. Squeal still did not list the new environment/review regression files as runnable. This was revision 4 with only the report added, so it is supplemental evidence, not a clean-candidate gate. |
| Focused direct run below | Exit 0: **6 files, 29 tests passed**, 31.20 s. Squeal explicitly said revision 3 was not listed and instructed a direct run for current evidence. |
| Independent standalone real-adapter probes | Exit 0: all seven original scenarios passed. The B5 variant below still produced and stored a wrong commit-side pass. Both probes used this candidate's real CLI child and Vitest adapter. |
| `pnpm run check:private` | Exit 0: `6414 added lines in 59 files ... ok`; warning: the private denylist is empty, so that rule was skipped. Repeated after writing this report and before committing. |
| [Candidate CI](https://github.com/hearsay-tools/squeal/actions/runs/44175785702) | In progress at the last read; full-suite evidence remains pending. No local full suite ran. |
| [Private material CI](https://github.com/hearsay-tools/squeal/actions/runs/44175785705) | Completed successfully for this exact candidate. |

The direct run used:

```sh
timeout 600 pnpm exec vitest run \
  test/cli/status-at-run.test.ts test/cli/status-at-run-env.test.ts \
  test/cli/status-at-run-review.test.ts test/cli/status-at-run-killed.test.ts \
  test/keys/key-format.test.ts test/runners/boundaries.test.ts
```

The first Squeal wait named the four run test files, key-format, version-sensitive and runner boundaries. It returned results from revision 2 and said revision 3 was not listed. The later affected wait was:

```sh
~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 \
  src/cli/status-at-run-child.ts src/cli/status-at-run-select.ts \
  src/cli/status-at-run-outcome.ts src/cli/status-at-report-run.ts \
  src/core/commit/at-keys-walk.ts test/cli/status-at-run-review.test.ts \
  test/cli/status-at-run-env.test.ts test/cli/status-at-run-killed.test.ts
```

Current evidence came from this targeted direct run, permitted by that unavailable daemon result:

```sh
timeout 600 pnpm exec vitest run \
  test/cli/status-at-run.test.ts test/cli/status-at-run-env.test.ts \
  test/cli/status-at-run-review.test.ts test/cli/status-at-run-killed.test.ts \
  test/keys/key-format.test.ts test/runners/boundaries.test.ts
```

The independent probe ran with `env -u NODE_ENV pnpm exec tsx <temporary-script>.mts`. Its B1 assertion checked that `NODE_ENV` started unset. Its other calls used the current source CLI as `io.relaunch`; checkout installs linked this tree's Vitest, as the repository's fixtures do. The probe asserted outcomes, later lookups and cleanup. All seven original scenarios passed. The separate B5 variant ran with `NODE_ENV=test` to isolate the input check. Scripts, fixtures and held processes were removed before the review commit.

## Remaining blocker

### B5 — proven: `git status` does not prove that tracked input bytes equal the requested commit

**File and line:** `src/core/commit/at-keys-walk.ts:176`, calling `trackedChanges` at `:193`.

**Contract:** Original B5, goal 3 and D4.7 require running the named commit's files and storing only those results. The brief states: “a result stored at the commit's key must come from a run of exactly that commit's files ... nothing else may be stored”.

The new check runs `git status --porcelain=v1 -z --untracked-files=no --no-renames`. Git status honors the index's `assume-unchanged` flag. An install that sets that flag for a generated tracked file leaves different source bytes while status reports no change. The check also compares against the checkout's current Git state rather than explicitly verifying the requested commit's blobs.

**Reproduction, the same B5 fixture with one additional install step:**

1. Base commits `src/a.ts` containing `export const value = 2;` and a test importing it and asserting `value === 1`.
2. HEAD changes that source to 3, so the base's missing test result is selected.
3. The checkout install links Vitest, writes `export const value = 1;` to the tracked source, then runs `git update-index --assume-unchanged src/a.ts` in that checkout.
4. Run `status --at <base> --run`, then a second lookup without `--run`, using the same install.

**Actual output:**

```text
HIDDEN_MUTATION_STATUS ""
run.selected: 1
run.ran: 1
run.stored: 1
failure: null
at.state: pass
at.origin: { kind: "run", stored: true }
```

The base was `a944717074627c382f433d4449ae53fd83196402`. The reported result key was `da560545fafbe91679eb902f11120b9419f780f4cb05d67624e26d42786a04d0`. The second lookup read `pass` at that same key from the shared store, origin `worktree`, with the base commit as its provenance. Both calls returned 3 because the current side had no result, not because the modified input was refused. The base's actual value-2 file cannot pass the assertion.

As in the first review, the content key reflects the installed replacement. This does **not** establish poisoning of the canonical value-2 key. It establishes the prohibited behavior: the command runs and stores a modified checkout, then presents that result as the named commit. The guarantee does not exempt source changes hidden by advisory index flags.

**One-worker fix:** Replace the status-based proof with one comparison between the requested commit's tracked inputs and their actual checkout bytes, modes and link targets. Do not rely on the worktree index's advisory flags or its current HEAD as the authority. Refuse a mismatch before keying/running/storing. Extend the existing mutating-install regression with the flag above, and assert zero runs, zero stored outcomes, the mismatch reason, and no later stored pass from the altered checkout. Keep the existing ordinary tracked-change refusal test.

## Disposition of the original findings

| Finding | Recheck and actual result | Disposition |
| --- | --- | --- |
| B1: normal shell environment refused | A fresh standalone process started with `NODE_ENV` unset. Its run selected 1, ran 1 and stored 1. The later lookup read the pass. The real child starts with the command's initial environment; the parent's Vitest initialization no longer triggers the gate's environment guard. | Closed. |
| B2: one project's pass assigned to another | The same path under `passes` and `fails` reported pass and fail respectively, both stored at their own keys. The subsequent lookup agreed. `outcomesOf` filters results by project and path. When no stored result can distinguish conflicting path outcomes, it now reports uncertainty instead of guessing. | Original false-pass scenario closed. See the bounded note below about the remaining path-only interface. |
| B3: a test-spawned process survived SIGKILL and sweep | Repeated the held-worker and spawned-process probe. After killing the CLI, worker 1225902 was `Z` and held process 1225983 was gone. Neither remained live. The next command swept the checkout; only the main worktree remained. The focused killed-run test also passed. | Closed for the original process-tree scenario. The zombie-aware test now distinguishes delayed reaping from a live process. |
| B4: config-only diff selected nothing | The same config-only change selected, ran and stored the test: all counts 1. The direct regression also passed setup-only and declared-input selection checks. Selection now calls the open adapters' `affected()` and the declared-input rule. | Closed. |
| B5: install overwrote tracked source | The original simple overwrite now returned `install: postinstall changed files git holds at <base>: src/a.ts`, with no gate time, selected 0, ran 0, stored 0. The next ordinary lookup was `no result`. | Simple case fixed; exact-input guarantee remains blocked by the variant above. |
| B6: required generated source absent from checkout | The generated source present only in the user's tree now read `not comparable (needs src/missing.ts)`. A second test with an absent optional snapshot passed in the same call. Counts: selected 1, ran 1, stored 1, not comparable 1. | Closed for the original missing-generated-input scenario. |
| B7: coverage-off run falsely claimed storage | Text said `run by this command, not stored` and `0 stored at its keys`. The next lookup returned `no result`. The focused regression passed. | Closed. |

## Notes, not additional blockers

- **Proven, nonblocking — B2's interface still loses identity:** `src/cli/status-at-run-outcome.ts:57` receives path-only outcomes and recovers identity from the stores. The repair's setup-only regression intentionally records `selected: 1, ran: 2, stored: 2`, since the gate runs both projects of the path. With conflicting outcomes and no stored results, the repair conservatively reports `not determined`. This avoids the original false pass. It leaves extra execution and incomplete reporting that a gate interface carrying `TestFileRef` could remove. This re-review does not expand that into another blocker.
- **Plausible, nonblocking — inherited estimate limitation:** the Vitest-width estimate still does not describe node:test lanes or host-load scaling. The first review already recorded this note; the repair does not settle it.
- **Unverified, nonblocking — broad affected coverage and full CI:** Squeal's unlisted revision cannot verify the new candidate. The focused direct checks passed. Full candidate CI was still running. These are verification limits, not product findings.

## What fits and what the next repair must preserve

The original one-checkout lifecycle and budget-cut tests pass with the real child. Parent-death handling and the recorded group close the reproduced live-descendant leak. Selection now consults the checkout's open adapters before they close. Store reads are filtered by full project/file identity, and text/JSON distinguish stored from not stored. Build, key-format and runner boundaries pass at the exact candidate.

Repair only the remaining B5 input proof, keeping the initial environment, `HOME`, per-run `TMPDIR`, one install, remaining budget, refusal of required generated inputs, per-project report outcomes, storage facts and process cleanup intact. Rebuild bundles and obtain a bounded re-review of that invariant. No local full suite is required. The coordinator decides the next step after this second FAIL under the repository's process.
