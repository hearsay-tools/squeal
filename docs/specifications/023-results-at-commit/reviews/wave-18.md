# Wave 18 review

FAIL `3926e8614956f2292d8a67ceddf01c76948aa9ad`: 3 proven blockers, 4 nonblocking notes.

Reviewed `ee79bb127..3926e8614`, rows 023-29, 023-30 and 023-31. The last commit's generated bundle content was excluded. Row 023-32 is outside this review.

## Verification

All product sources stayed at the candidate. The worktree was clean before checks and again after removal of the throwaway probes.

| Command or evidence | Actual result |
| --- | --- |
| `git rev-parse HEAD` | `3926e8614956f2292d8a67ceddf01c76948aa9ad`, as requested |
| Dependency setup | Squawk supplied the frozen-lockfile install. Not repeated, as instructed. |
| `timeout 600 pnpm run lint` | Exit 0. `Checked 3895 files in 2s. No fixes applied.` |
| `timeout 600 pnpm run typecheck` | Exit 0, no diagnostics |
| `pnpm run check:private` | Exit 0. `private: 22052 added lines in 83 files over ee79bb1277c97356c3f21e14db1d852593d9ba40, ok`. Warning: the private denylist was empty, so that rule was skipped. |
| `git diff --check` | Exit 0 |
| Installed Squeal `checks` | Exit 0. Default tests run after edits; typecheck/build and excluded e2e tests are outside coverage. |
| Installed Squeal `status --wait 60000 src/cli/status-at-both.ts src/cli/status-at-run-now.ts src/core/checkout/left-under.ts` | Exit 3. Revision 0, partial list, no daemon running. Affected checks are **unverified**. This is why targeted tests ran directly. |
| `timeout 600 pnpm exec vitest run --maxWorkers=2 test/cli/status-at-both.test.ts test/cli/status-at-next.test.ts test/cli/status-at-run-units.test.ts test/cli/status-at-run-marks.test.ts test/checkout/left-under.test.ts test/cli/proof-report.test.ts` | Exit 0. 6 files, 32 tests passed, 60.57 s. |
| `timeout 600 pnpm exec vitest run --maxWorkers=2 test/runners/boundaries.test.ts test/harness/skill.test.ts test/cli/status-at-run-budget.test.ts` | Exit 0. 3 files, 29 tests passed, 55.13 s. |
| Two throwaway focused Vitest probes, each with `timeout 600` and `--maxWorkers=2` | Each failed its required-behavior assertion, proving B2 and B3 below. 18.20 s and 17.80 s. Removed afterwards. |
| Direct Node process probes | B1 reproduced with a real disposable child. A symlinked-checkout positive control passed. All probe children and folders were removed. |

No full suite ran locally. Candidate [CI 44828392269](https://github.com/hearsay-tools/squeal/actions/runs/44828392269) was still in progress at 2026-11-20 22:29 UTC; full-suite and build/bundle checks are **unverified**. Its lint and typecheck steps had passed. [Private material 44828392268](https://github.com/hearsay-tools/squeal/actions/runs/44828392268) passed at this exact SHA. No local build ran under the loaded-host instruction; CI's build was still pending. No benchmark comparison for these rows was found in the task material or results index; performance is **unverified**, not a blocker.

Inputs: CLAUDE.md; process, vision, styleguide and board; wave-18 brief; spec D3, D4.10, D5.5a and D6; status amendments; lessons Round 4 R1-R8. Review and lessons files were inputs, not review targets.

## Blockers

### B1. Proven: checkout cleanup kills processes whose paths are outside the checkout

**Location:** `src/core/checkout/left-under.ts:138`, called by `scan` at line 89 and `removeTree` in `src/core/checkout/checkout.ts:199`.

Row 023-31 requires: “Never touch a process outside the path.” `mentions` searches for the checkout string anywhere in an argument. It checks only the character after that string. It does not establish the beginning or the normalized boundary of an absolute path.

**Reproduction:** create a unique checkout folder `C`. Start a disposable Node child with its cwd outside C and a harmless argument `/another-root${C}/file.js`. Call `endLeftUnder(C, { graceMs: 100 })`. Neither the child's cwd nor its absolute argument path is under C. The child nevertheless exits on SIGTERM, and cleanup returns `ended: [{ pid, name: "node" }]`. The probe used only its own child.

The same predicate accepts `C/../outside` and a sibling name such as `C:other`. The existing test covers only the sibling `C2`, which its narrow suffix check rejects.

**Repair:** one checkout worker owns a path matcher that extracts complete path arguments, including supported `--option=<path>` values, normalizes/resolves them, and checks containment against the canonical checkout folder. Do not treat an embedded substring as a path. Cover embedded prefixes, punctuation in sibling names, traversal, symlink aliases and valid contained arguments. Preserve the cwd and caller/uid exclusions.

### B2. Proven: working-tree child startup failures still read as budget exhaustion

**Location:** `src/cli/status-at-run-now.ts:232`; error creation at `src/cli/status-at-run-child.ts:111`; rendering in `src/cli/status-at-report-run.ts:150`.

D4.10/R3 requires a failed batch setup to read as a setup failure with its text, “never as the budget.”

`readNow` computes whether `answer.stopped === true`, but assigns `reason: "budget"` to every file for **both** kinds of error. A failed runner creation/configuration is caught by `runChild` as `{ error }`, without `stopped`.

**Real-child reproduction:** use the existing git fixture and source CLI relaunch. Give the fixture one ordinary test and this `vitest.config.mjs`:

```js
throw new Error("Browser startup config failed");
```

Call `runNow` with no daemon, that file, the real `RELAUNCH`, and 60 s remaining. The child returns in about 10 s. Observed:

```json
{"states":[{"state":"not run","reason":"budget"}],"problem":"Browser startup config failed"}
```

The assertion that no file carries a budget reason fails. `nowUse` therefore counts the setup failure in `notRun`. The text formatter subtracts that count before deciding whether to print `problem`, so it can hide the actual error and print only a budget line. With usable rate/duration evidence it can also offer a timeout rerun.

**Repair:** one status worker distinguishes a hard stop from a startup/setup error in the child answer and working-tree readback. Keep the setup text and group. Do not include those files in budget counts or fit calculations. Preserve setup notes even if the child exits through its catch. Add the real startup-throw regression alongside the existing successful-keying/global-setup test.

### B3. Proven: a path shared by ordinary and manual projects defeats setup isolation

**Location:** `src/cli/status-at-run-loop.ts:64`, especially lines 95-97; the path-only child request in `src/cli/status-at-run-child.ts:178`.

D4.10/R3 requires groups that run only on request to run “in their own batch, so their setup cannot stop the other files.”

The loop assigns each path the lot of its **first** project, then puts every project for that path into the batch. The child receives only paths and the gate runs every project listing them. Group identity is lost at this boundary.

**Real-runner reproduction:** configure two Vitest projects:

- `unit` includes `test/*.test.ts`.
- `browser` includes only `test/shared.test.ts` and has a global setup that throws `Chrome failed to launch`.
- Squeal has `checks: [{ name: "browser", runner: "vitest", project: "browser", at: "manual" }]`.
- Ask `runNow` to run unit/shared, unit/plain and browser/shared, with unit/shared listed first and `batchFiles: 10`. The plain test writes a marker when it runs.

The browser setup ran in the ordinary batch. The plain test's marker did not exist. The required-behavior assertion failed. The returned states included:

```text
unit/plain:   not run, setup, tests: global setup browser.mjs failed: Chrome failed to launch
unit/shared:  not run, setup, tests: global setup browser.mjs failed: Chrome failed to launch
browser/shared: not run, setup, browser: global setup browser.mjs failed: Chrome failed to launch
```

This uses supported project-specific groups and overlapping test includes. The current isolation unit test uses distinct paths and fake runner answers, so it does not exercise this seam. The same loop serves both sides.

**Repair:** one worker must preserve project/group identity through batching **and execution**, so a manual project's setup cannot enter an ordinary batch. A path-only request cannot guarantee this for overlapping projects. Agree any required gate/request interface change with the coordinator before implementation, as the brief requires for gate changes. Keep each project's own completion record. Add this real-project regression; changing only sort order does not fix it.

## Nonblocking notes

1. **Plausible, R6 pid reuse:** `src/core/checkout/left-under.ts:60` sends SIGTERM to scanned pids without rechecking their recorded start time. SIGKILL does recheck it at line 63. A fake-proc boundary probe changed a scanned pid's start identity before its TERM call; the signal was still sent. A real pid-reuse occurrence was not reproduced. Revalidate identity, uid and containment before signalling; use stable process handles where available. This is a race concern, not a proven real-process blocker.
2. **Proven, unsupported-platform visibility:** `left-under.ts:58` and `:97` return no note when proc scanning is unavailable. The wave brief permits skipping macOS with a note. Emit a concise stderr note so the report states that this cleanup step was skipped. The Linux success path is covered.
3. **Proven test bypass; nonblocking design judgment:** `AtOptions.workingTree` at `src/cli/status-at.ts:48` is not exposed by the CLI, so it does not itself break the shipped default. It does add a product branch solely to disable R1 in tests. In particular, the 45 s budget regression sets it false. Prefer testing commit-only behavior through the commit-run boundary and keep command tests on the real two-sided path. Add a short two-sided budget-exhaustion test with different side durations. The live-daemon integration and two-sided exhaustion remain **unverified**; the new daemon test injects ports.
4. **Plausible maintainability risk:** the reported complexity 25 of `statusAtCommand` (`src/cli/status-at.ts:167`) is not by itself a correctness blocker. The function now constructs run options, sequences both sides, refreshes state, builds the report and decides the exit. Extract cohesive run configuration and report assembly after the fixes. Keep one visible owner of the shared deadline and the refusal-before-keying order. Do not split each conditional into a separate helper just to lower the count.

## What fits

- **R1, ordinary no-daemon case:** the passing real-runner test runs the changed test on both sides, stores the working-tree result with origin `own`, and reuses it on the next call. An unselected plain file stays `no result`. Child output forwarding is suppressed for JSON. No false pass for an unrun file was found in the checked paths.
- **R1 budget structure:** both sides receive one absolute `endMs`; first shares depend on file counts, then leftovers use the remaining time. Batches use that side's deadline and stop margin. The existing one-sided hard-stop/completion-record test passed. This does not claim a measured two-sided hard-stop proof.
- **R2:** `locate` calls the existing `headRefusal` before `nowSide` or checkout/keying, with or without `--run`. The new clean-HEAD refusal test passed. The existing dirty/untracked and changed/moved-submodule tests passed; the same `--ignore-submodules=none` predicate remains in use. Dirty HEAD comparisons remain allowed.
- **R3, ordinary global-setup failure:** the real two-sided global-setup test passed. It names the setup and group, takes only the first error line, and offers no longer timeout. Distinct-path lots and stopping later batches after a setup failure also passed. B2 and B3 bound these claims.
- **R4:** separate side rates feed one fit, with a 1.5 margin and a 600 s suggestion cap. The 31-of-1338 regression estimates hours and offers no timeout. Unknown rates fall back to stored durations or explicitly say unknown. Durations are read before closing their store.
- **R8:** JSON marks missing unselected commit-side files, text says `--all-missing` runs them, and run counts say they cover the selected files. The marks tests passed.
- **R5:** a proven changed source-case test puts the distinction in its verdict line, including the exact `status --at <base> <file> --run` direction. No pre-existing JSON summary field was found to update; JSON fields remain stable. Step 8 matches in the three active skill copies. The fixed Codex loader and frozen seed have no step 8; routine builds intentionally leave them alone. The start primer does not read step 8, so this edit does not enter its character cap.
- **R6 positives:** removal and dead-owner sweep reach cleanup and its note. Existing tests passed for cwd, valid option-path arguments, `C2` prefix rejection, caller/ancestor and uid exclusion, SIGKILL escalation and process names. A symlinked-checkout probe found the real cwd. Status/proof notes go to stderr; no new stdout writer was found.

## Inputs for the fix wave

Dispatch B1 to a checkout worker. Dispatch B2 to a status-run worker. B3 needs the coordinator to settle a project-aware execution boundary before a worker changes the gate/request contract. Give B2 and B3 disjoint files or run them in sequence: both touch working-tree run outcomes.

Keep the order: HEAD refusal, current-side read, commit checkout/keying/selection, bounded side turns, checkout cleanup, current-side refresh, report. Preserve one deadline across the two run paths. Preserve ordinary worktree keys/results and per-project completion records. Setup failures must stay out of budget counts and estimates.

Re-review the three blocker repairs and their deltas. Retain the passing coverage above. Add real shared-project isolation and startup-error regressions, then a two-sided deadline case without the test bypass. CI/build and any applicable benchmark comparison still need exact-candidate evidence; their current unavailability is not a finding.
