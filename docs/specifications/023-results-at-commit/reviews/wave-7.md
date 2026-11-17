# Wave 7 review: status at a commit with `--run`

FAIL dc775ae2748c436ff94f8543e37b07364a513c7a

Seven proven blockers. No product file was changed. The review covers row 023-07 and the 0.1.549 versions and bundles, against the fetched `origin/main` (`c74b471d9cf213f34f7ff9822185991740839f18`, version 0.1.548). The range has four commits: `0ba9132f1`, `deca12032`, `0d6cc27f4`, `dc775ae27`.

## Verification

These checks ran on the exact candidate, with a clean product tree. Probe scripts and fixture repositories were outside the checkout. Their processes and fixtures were removed. Dependency installation was supplied by Squawk (`pnpm install --frozen-lockfile`, reported 1 s); it was not repeated, as the brief required.

| Command or evidence | Actual result |
| --- | --- |
| `git rev-parse HEAD`; `git fetch origin`; `git log --oneline origin/main..dc775ae2748c436ff94f8543e37b07364a513c7a` | Exact requested SHA; the four commits above. |
| `pnpm run lint` | Exit 0: `Checked 3664 files in 1605ms. No fixes applied.` |
| `pnpm run typecheck` | Exit 0, `tsrs --fast --noEmit`. |
| `pnpm run build`; `git status --short` | Exit 0; all four plugin builds completed; no drift or untracked output. |
| `pnpm run check:version origin/main dc775ae2748c436ff94f8543e37b07364a513c7a` | Exit 0: `version bump: 0.1.548 -> 0.1.549, ok`; fixed adapter `1.0.3 -> 1.0.3, ok`. A prior invocation without a base skipped its check; it is not evidence. |
| `pnpm run check:private` | Exit 0: `4616 added lines in 51 files ... ok`; warning: private denylist is empty, so that rule was skipped. Repeated after writing this review, before its commit. |
| Squeal affected-path wait below | Exit 3 at revision 0: 6 current passes, 77 pending, 216 unknown among the 299 selected files. Both new run test files were current passes. This is incomplete affected coverage, not a pass for all selected files. |
| Squeal focused wait below | Exit 3 at revision 0: 5 current passes: both new run files, key-format, runner boundaries, shared harness boundaries. `status-at.test.ts` and `version-sensitive.test.ts` were unknown, waiting for the parent's run of the same key. |
| Final affected-path wait (same command) | Exit 3: 80 current passes, 13 pending, 206 unknown; no known failures. `status-at.test.ts` was now current. This read was at revision 1 with only this review added, so it is supplemental evidence, unverified as a clean candidate gate. |
| Independent real-adapter probes via `pnpm exec tsx <temporary-script>.mts` | Completed. B1–B7 give the discriminating inputs and actual outputs. `NODE_ENV=test` was explicit except in B1, which started with it unset. No local full suite ran. |
| [Candidate CI](https://github.com/hearsay-tools/squeal/actions/runs/44161782721) | In progress at the last read. Node 24 lint and typecheck passed; version-sensitive checks and Node 22/26 test shards were still running. Full-suite evidence is pending, not a review finding. |
| [Private material CI](https://github.com/hearsay-tools/squeal/actions/runs/44161782492) | Completed successfully at this exact candidate. |

The affected wait used the session's absolute Squeal launcher (shown with `~` here):

```sh
~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 \
  src/cli/status-at-run.ts src/cli/status-at.ts src/cli/status-at-report.ts \
  src/core/commit/at-keys-checkout.ts src/core/commit/at-keys.ts \
  test/cli/status-at-run.test.ts test/cli/status-at-run-killed.test.ts

~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 \
  test/cli/status-at-run.test.ts test/cli/status-at-run-killed.test.ts \
  test/cli/status-at.test.ts test/keys/key-format.test.ts \
  test/version-sensitive.test.ts test/runners/boundaries.test.ts \
  test/harness/shared/names-no-runner.test.ts
```

## Blockers

### B1 — proven: a normal shell environment prevents the selected run

**Changed boundary:** `src/cli/status-at.ts:159` (passes the earlier environment snapshot to the new run); `src/cli/status-at-run.ts:126`.

**Contract:** D4.4 requires the run and the key to describe the same environment. Goal 3 requires selected missing files to run.

**Reproduction:** Start a fresh source CLI process with `NODE_ENV` unset. Use a real Vitest fixture with coverage on, one passing test importing `src/a.ts`, a base commit, and a HEAD that changes that source. Call `statusAtCommand` with `run: { allMissing: false, timeoutSeconds: 30 }`. The install links this checkout's Vitest, as the existing integration tests do. Do not start this probe inside Vitest: that supplies `NODE_ENV=test` and hides the failure.

**Observed:** Exit 3, `run.selected: 1`, `run.ran: 0`, `run.timedOut: false`, and:

```text
not determined (run: runGateFiles: env sets NODE_ENV otherwise than this process,
outside the key's env.allowlist; a run under it must not store (store: false))
```

`statusAtCommand` saves `env` before reading the current side. Vitest startup sets `process.env.NODE_ENV ??= "test"`. The gate later compares the saved snapshot with that changed process environment and refuses. The tests run under Vitest and do not cover the normal shell entry.

**One-worker fix:** Keep one effective environment through current-side keying, commit keying and execution, including the runner's normal initialization. Scope and restore runner mutations. Do not disable the outside-key storage guard or switch storage off to hide this mismatch. Add a fresh-process CLI test with `NODE_ENV` unset and verify store reuse.

### B2 — proven: a failing project is reported as a pass from another project

**Changed boundary:** `src/cli/status-at-run.ts:119` and `:132`.

**Contract:** D1/D3 require each file's correct state at its own key. Project identity is part of `TestFileRef` and the key.

**Reproduction:** A committed Vitest config has two inline projects, `passes` and `fails`. Both include `test/a.test.ts`. They set `MODE` to `good` and `bad`, respectively. The file imports `src/a.ts` and asserts both `value === 1` and `process.env.MODE === "good"`. HEAD changes `src/a.ts`; run the base with `--run`.

**Observed:** JSON reports `pass`, origin `run`, for **both** projects. A subsequent lookup without `--run` reports `fails: fail` with failed test `value`, and `passes: pass`, at the same respective keys. The underlying store held the correct failure in this probe. The command's report was the false pass.

The gate produces one outcome per project but does not expose its project in `GateFileRun`; `byPath` then takes the last outcome for that path and assigns it to both refs. Path-only input can also run projects the hook refused or did not select.

**One-worker fix:** Preserve `TestFileRef` through files-only selection, gate outcomes and the status join. Index by `testFileId`, not path. Add opposite-outcome projects sharing one path and a case where only one project is eligible. Check both report and stored results.

### B3 — proven: SIGKILL and the next sweep leave a test's process alive

**Changed boundary:** `src/cli/status-at-run.ts:122`; the new direct in-process gate call has no owner for its descendant groups. `test/cli/status-at-run-killed.test.ts:64` observes only the Vitest worker.

**Contract:** D6 and goal 5: a killed run leaves no process running; the next start removes the checkout.

**Reproduction:** Use the existing killed-child entry with a real Vitest fixture. Its holding test starts:

```js
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  stdio: "ignore",
});
```

It writes both its own pid and `child.pid`, then holds. SIGKILL the command after that file exists. Inspect `/proc/<pid>/stat`, then run the next `status --at` to sweep the checkout.

**Observed:** Worker 4057550 ended. Child 4057619 remained in state `S` after 1.5 s, after the sweep, and after more than 15 s. The checkout was gone and `git worktree list` contained only the main fixture. The reviewer explicitly killed the surviving process. This was a live process, not a zombie or an assertion timing limit.

**One-worker fix:** Give the in-process run a parent-death mechanism that ends its complete process tree, including separately grouped runner children, and let the marker/sweep find that ownership. Recording only the install's group cannot stop these processes. Extend the kill test with a test-spawned process and check actual process state. The existing JSON relaunch's watchdog is not installed by this call.

### B4 — proven: a config-only diff selects no missing file

**Changed boundary:** `src/cli/status-at-run.ts:93`.

**Contract:** D4.5 explicitly uses 020 D3.1 selection. That selection calls the runner's `affected()` and includes project environment files and declared inputs.

**Reproduction:** Base has a passing Vitest test importing `src/a.ts`. HEAD changes only `vitest.config.mjs`, adding `globals: true`. No stored result exists. Ask `--at <base> --run` without `--all-missing`.

**Observed:** Exit 3, file `no result`, `run.selected: 0`, `run.gateMs: null`. The base's test is a consumer of the changed runner configuration and must be selected. The implementation intersects changed paths with `file.ref.path` and `loads`, which omit project environment inputs. This does not implement the adapter's affected-file rules.

**One-worker fix:** Select inside the existing checkout through the adapters' affected-file contract, and apply 020 D3.1's declared inputs. Intersect that result with the keyed missing refs. Keep project identity and close the adapters before removal. Add config-only, setup-only and declared-input selection checks.

### B5 — proven: install can replace committed source, then the command stores and reports that replacement

**Changed boundary:** `src/core/commit/at-keys-checkout.ts:112` and `src/cli/status-at-run.ts:90`–`:122`, which now run and store the installed checkout without verifying its inputs against the named commit.

**Contract:** Goal 3 and D4.7 require results at the commit's keys from that commit's files. The brief explicitly bars storing anything else.

**Reproduction:** Base commits `src/a.ts` with `value = 2` and a test asserting `value === 1`. HEAD changes the source to 3. The checkout install links Vitest and writes `value = 1` over the tracked source, simulating a lifecycle script that regenerates a tracked file. Run the base.

**Observed:** The command reports `pass` at base commit `240609cf0bfba5f32560ad003820cda3be2476b9`, key `72ba2856a5e77b2b8e6023138b6ba7e07ae3627753f4f7d97d47e3f02201d34b`. A second lookup with the same install reads that pass from the store, with no run. The base's committed assertion must fail against value 2. Both keyers saw value 1, so using one checkout did not establish that its bytes still belonged to the commit.

This probe proves storage and attribution of the modified checkout. It does **not** prove that the original value-2 content key was poisoned; the content key reflected the replacement. That distinction does not satisfy the requested exact-commit guarantee.

**One-worker fix:** Before allowing storage, verify that the test's tracked closure and runner/key inputs still match the commit after install and setup. Reject a modified input with a reason; never certify a changed tracked file as the commit. Add a mutating-install regression that checks the report and the absence of stored run results.

### B6 — proven: an absent required ignored source is treated as a test failure instead of not comparable

**Changed boundary:** `src/cli/status-at-run.ts:90`.

**Contract:** D4.9: “A file whose closure reads a path git does not hold reads `not comparable (needs <path>)` and is not run.” The non-goal also excludes building missing untracked inputs.

**Reproduction:** Base commits a test importing `../src/missing`; `src/missing.ts` is a generated input present only in the user's tree. Seed the normal shared observed set with that path, as an earlier daemon run would. The base checkout lacks it. HEAD changes the test, selecting it. Use `NODE_ENV=test` to avoid B1.

**Observed:** The hook's key data explicitly lists `src/missing.ts` in `loads`, alongside resolution candidates and the optional snapshot. The existence check rejects none of them because they are absent in the checkout. The command runs the file and reports `fail`, failed `"(file-level error)"`, `run.notComparable: 0`.

The worker's reason for allowing absent optional snapshots is sound. Its general rule is too broad: an absent optional snapshot and an absent source the test imports are different inputs. Checkout absence does not prove that a known required input is optional.

**One-worker fix:** Distinguish required imports/observed inputs from prospective resolution and snapshot candidates. Refuse the required input without running. Keep the passing case with no snapshot. Add both cases to the same test so the fix cannot simply reject all absent closure candidates.

### B7 — proven: coverage-off runs claim storage that never happened

**Changed boundary:** `src/cli/status-at-report.ts:265`; the run report has no storage outcome.

**Contract:** Vision principle 2 and D3's honest state/origin reporting. Coverage-off runs must store nothing.

**Reproduction:** Set committed `coverage.enabled` to false. Use one passing base test and a source edit at HEAD. Run with `NODE_ENV=test`, then look up the base again without `--run`.

**Observed:** First text output says:

```text
--run: 1 of 1 test files with no result at d10bee710 ran in its checkout and are stored at its keys
```

The next lookup returns `no result`. Inspection confirms `storedFiles` deliberately returns null with coverage off. Thus storage behavior is correct for this case, but the new report asserts a fact it never received. The gate can also decline storage for other valid reasons.

**One-worker fix:** Separate completion from storage in the report. Only say “stored” when the keeper confirms the actual key and write. If that outcome is unavailable, report only that the command ran the file. Add coverage-off text/JSON and subsequent-lookup checks. Do not turn on storage to make the sentence true.

## Should-fix and nits

No additional blocking claim is made from incomplete checks.

- **Unverified, nonblocking — original killed-test flake:** `test/cli/status-at-run-killed.test.ts:81` uses `kill(pid, 0)` as “alive”. That includes a zombie until its reaper runs. The worker kept no failure text for its one failure in thirteen runs, so that observation alone cannot establish a product race or a specific timing fault. This review's current Squeal result passed. B3 independently proves a product cleanup defect with a live descendant. Keep failure text and `/proc` state on the next failure; use the existing `code-gate-kill-parent.test.ts` distinction between a live process and a zombie.
- **Plausible, nonblocking — estimates:** `src/cli/status-at-run.ts:184` estimates every selection as Vitest at `availableParallelism() - 1`. The gate also supports node:test entries, their shared tier size, and host-load scaling. A mixed-runner fixture should confirm the D17.1 estimate and rerun budget before treating this estimate as generally accurate.
- **Proven, nonblocking — status drift:** `status.md:3` still says wave 1 is running; the board lists 023-07 as running while this candidate is in review. Coordinators own these files. This review does not edit them.

## What fits

- The hook is called after keying and adapter close, before removal, in the same checkout. The supplied passing test counts one install for the key-and-run call and reads the stored result on a later lookup.
- Ordinary single-project source/test diffs, the all-missing estimate before the run, a failed assertion's names, install-failure reporting, a budget cut with no result stored, and the rerun line have current passing run tests. Those tests do not cover the blockers above.
- The budget clock starts before commit-side checkout, install and keying. The gate receives the remaining whole seconds; under one second left it starts nothing and marks selected files `not run (budget)`. The default is 600 s. This verifies the accounting; it does not prove a hard deadline around every checkout or lock operation.
- The run passes only its own `TMPDIR` override. It does not replace `HOME`. The gate's outside-key environment guard is retained. B1 concerns initialization around that guard, not permission to remove it.
- Coverage off does not store the tested result. B7 is the false storage claim.
- JSON includes the versioned `run` section, used and gate time, selection counts, estimate, timeout and rerun. Without `--run` it is null. Unknown comparisons return 3; known changed outcomes retain the existing 0 rule. Parser tests cover invalid run-option combinations and the setup/usage code 2. Generic exceptions from the new run are converted to `not determined`; not every setup-error subtype was exercised.
- The version raise and all four shipped bundles build without drift. Key-format and runner-boundary checks are current passes. Full candidate CI remains pending.

## Inputs for the repair wave

Keep the one-checkout lifecycle: resolve and install once; establish exact committed inputs and one effective environment; key and select by full project/file identity; run eligible missing refs before removal; accept storage only at keys that describe those exact files and conditions; report actual per-ref outcomes and actual storage; stop all owned processes; then remove and prune. Reuse known results without running them. Optional resolution candidates must not hide a required missing input.

Carry one remaining budget through checkout, install, keying and the gate. Preserve `not run (budget)` and the command's own rerun arguments. Keep D5 condition runs outside the shared store. Repair B1–B7 with focused real-adapter tests, then rebuild/version the candidate as the coordinator requires and request a bounded re-review. Do not request a local full suite. Pending CI and unknown affected results are verification limits, not extra blockers.
