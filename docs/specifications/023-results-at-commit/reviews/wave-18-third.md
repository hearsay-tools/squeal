# Wave 18 third review

FAIL `d765213f6d38c15d98aa8307ab14cb127f507a96`: 1 proven blocker. The second-pass mutation blocker is closed. The two prior argument witnesses are closed under the amended cwd-only rule, but cleanup still kills an outside process through a working-folder name.

Reviewed the repair delta `1ee9d4cad..d765213f6` within `ee79bb127..d765213f6`, bounded by `47d730ebf:docs/specifications/023-results-at-commit/reviews/wave-18-rereview.md`. Generated bundle content was excluded. D6 was read at main `0697a35ea`, as instructed: the human chose “A: working folder only”; command-line paths no longer establish containment. The candidate's older spec copy was not treated as a conflicting requirement.

## Verification

Product TypeScript sources match the candidate. At checkout, a pre-existing uncommitted `squeal.config.json` edit set `coverage.enabled` to false. The parent instructed me to preserve it and never commit it. The local commands below ran with that configuration difference; pristine-tree verification is **unverified**. The independent mutation probe uses its own git fixture and `squeal.config.json: {}`, so its coverage/store behavior does not depend on this worktree's edit. All throwaway files and children were removed. Only the pre-existing configuration edit remains outside this findings file.

| Command or evidence | Actual result |
| --- | --- |
| `git fetch origin cand/0.1.581`; `git checkout --detach origin/cand/0.1.581`; `git rev-parse HEAD` | `d765213f6d38c15d98aa8307ab14cb127f507a96`, matching the requested candidate |
| Dependency setup | Supplied installation retained; not repeated |
| `timeout 600 pnpm run lint` | Exit 0. `Checked 3900 files in 2s. No fixes applied.` |
| `timeout 600 pnpm run typecheck` | Exit 0, no diagnostics |
| `pnpm run check:private` | Exit 0. `private: 37183 added lines in 88 files over ee79bb1277c97356c3f21e14db1d852593d9ba40, ok`. The empty private denylist rule was skipped with a warning. |
| `git diff --check` | Exit 0 |
| Installed Squeal `checks` | Default tests run after edits; typecheck, build and excluded e2e files are outside coverage |
| Installed Squeal `status --wait 60000 src/cli/status-at-run.ts src/cli/status-at-run-loop.ts src/core/checkout/left-under.ts` | Exit 3. Revision 0, partial list, no daemon running. Affected results are **unverified**; targeted tests ran directly. |
| `timeout 600 pnpm exec vitest run --maxWorkers=2 test/cli/wave18-third-probe.test.ts test/cli/status-at-both-changed.test.ts test/cli/status-at-both.test.ts test/checkout/left-under.test.ts test/cli/status-at-run-units.test.ts test/cli/status-at-review13.test.ts test/runners/boundaries.test.ts` | Exit 0. Seven files, 34 tests passed, 95.61 s. Includes the independent mutation probe, removed afterwards. |
| `timeout 600 pnpm exec tsx /tmp/sq-wave18-third-process.mts` | Exit 1 on its survival assertion. Seven of eight process cases behaved as required; the live sibling ending in ` (deleted)` was killed. All disposable processes and folders were cleaned; script removed. |

No local full suite or build ran. Exact-candidate [CI 44837006248](https://github.com/hearsay-tools/squeal/actions/runs/44837006248) was still in progress when checked; full-suite and build/bundle results remain **unverified**. Exact-candidate [Private material 44837006167](https://github.com/hearsay-tools/squeal/actions/runs/44837006167) passed. The prior missing benchmark comparison and live-daemon integration evidence remain unverified, not blockers.

## Blocker

### 1. Proven, original B1 remains: a live sibling ending in ` (deleted)` is mistaken for the checkout

**Location:** `src/core/checkout/left-under.ts:130`, used by the scan at line 84 and both signal checks at lines 99 and 104.

The amended D6 counts a process only when its kernel-reported working folder lies under the checkout. Row 023-31 still says: “Never touch a process outside the path.”

`cwdUnder` removes the final string ` (deleted)` without establishing that the kernel added it. That string is also a legal part of a live directory name. With checkout `C`, a process whose real, live cwd is the sibling `C (deleted)` is therefore compared as if its cwd were C itself.

**Real disposable-process reproduction:** create C and the separate sibling directory `C (deleted)`. Start an idle Node child with cwd `C (deleted)`. Keep both directories present. Call `endLeftUnder(C, { graceMs: 100 })`. Cleanup reports the outside child in `ended`, and it is dead afterwards. The caller and all probe processes belong to the same user. There is no command-line path inference in this witness.

The same probe started three legitimate contained children: cwd `C/tree`, an already removed `C/gone`, and `C/tree` through a checkout symlink. All three ended as required. Cleanup reported four ended processes: these three plus the outside sibling child. A `C2` sibling survived. This distinguishes the literal-name failure from a broken positive control or an ordinary prefix check.

The suffix handling existed before this repair; the cwd-only matcher retains it. This is a surviving instance of the original outside-process blocker, not a claim that removing argument matching introduced it.

**Repair:** one checkout worker should distinguish a live pathname from the kernel's deleted-directory annotation before removing the suffix. Use evidence from the process's cwd object, such as metadata read through `/proc/<pid>/cwd`; a string suffix alone is insufficient. If deletion cannot be established safely, skip ambiguous containment evidence. Preserve the full eligibility check before TERM and KILL. Add the real live-sibling survival test beside the existing deleted-cwd tests. Both the live suffix case and truly deleted cwd cases must pass together.

## Closed findings and what fits

- **Second-pass mutation blocker closed with an independent real-runner probe.** The same base/HEAD fixture from the re-review runs both sides with one 70 s budget. The first commit pass changes tracked `src/a.ts` from 1 to 2, then times out before completing a file. The current side passes. The second commit pass now gives `not comparable`, `ran: pass`, reason `a test of an earlier batch changed src/a.ts`. The report has two commit batches, `changed: src/a.ts`, `changedBy: run`, `stored: 0` and `notComparable: 1`. A following lookup gives base `no result`. JSON parses cleanly. The added worker regression also passed.
- **The cross-pass check has one owner.** `atRun` counts children over all passes. `runBatches` calls `beforeEach` before every batch it can start; the commit hook skips only the checkout's first child. A detected tracked change retains the existing no-store and not-comparable behavior. The ordinary two-sided budget test and prior whole-checkout regressions passed. No new regression was found in this run repair.
- **Both former argument witnesses survive.** The real child with outside cwd and argument `C/out/../missing` survives. The copied `/bin/cat` with one executable argv containing an embedded checkout path after a space survives. A process with outside cwd and `--user-data-dir=C/run/profile` also survives, as the amended D6 requires. Argument parsing remains only for display names; `under-path.ts` is removed.
- **Contained and deleted working folders end.** Independent real children in a contained cwd, a deleted contained cwd and a symlinked checkout cwd all end and are named. Existing tests also pass for deletion of the entire checkout, the dead-owner sweep, caller/ancestor and uid exclusions, pid-start changes, TERM/KILL escalation, and a process leaving the folder during the grace period.
- **The earlier escalation note is addressed.** Both TERM and KILL now use the same start-time, uid and cwd check. The small check-to-signal pid race remains a plausible limit; no real pid-reuse incident was reproduced. This is not a new blocker.
- **Earlier accepted behavior remains out of the repair delta.** B2/B3 setup reporting and project isolation, the named-file rule, removal of `AtOptions.workingTree`, command extractions, R4 fit/cap, R8 marks and R5 wording are not changed by these repairs. Their prior judgments stand. The low-impact named-file wording note remains unchanged.

## Inputs for the fix wave

Dispatch the remaining blocker to the checkout worker, limited to cwd deletion evidence and its regressions. Keep the human's cwd-only rule; do not restore argument-based eligibility. Keep the passing cross-pass mutation repair. Re-review the live-suffix and real-deletion cases together. CI/build and live-daemon evidence still need their own passing results before anyone claims those checks passed.
