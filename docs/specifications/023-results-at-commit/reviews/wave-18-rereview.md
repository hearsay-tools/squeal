# Wave 18 re-review

FAIL `1ee9d4cad3ab381bf69ff6b99a9373fc63a7126f`: 2 proven blockers. Original B2 and B3 are closed. B1 remains open. The budget repair introduces the second blocker below.

Reviewed `ee79bb127..1ee9d4cad`, bounded by the first review at `3b1b55da2:docs/specifications/023-results-at-commit/reviews/wave-18.md` and the repair delta since `3926e8614`. Generated bundle content was excluded. Row 023-32 remains outside this review; its named-file repair is judged here as requested.

## Verification

Product sources stayed at the candidate. The tree was clean before checks and after removing the throwaway probes. Dependencies were supplied; installation was not repeated.

| Command or evidence | Actual result |
| --- | --- |
| `git rev-parse HEAD` | `1ee9d4cad3ab381bf69ff6b99a9373fc63a7126f`, matching the fetched candidate |
| `timeout 600 pnpm run lint` | Exit 0. `Checked 3901 files in 2s. No fixes applied.` |
| `timeout 600 pnpm run typecheck` | Exit 0, no diagnostics |
| `pnpm run check:private`, after removing probes | Exit 0. `private: 37232 added lines in 89 files over ee79bb1277c97356c3f21e14db1d852593d9ba40, ok`. The empty private denylist rule was skipped with a warning. |
| `git diff --check` | Exit 0 |
| Installed Squeal `status --wait 60000 src/cli/status-at-run-now.ts src/cli/status-at-run-only.ts src/core/checkout/under-path.ts` | Exit 3. Revision 0, partial list, no daemon running. Affected results are **unverified**, which is why targeted tests ran directly. |
| `timeout 600 pnpm exec vitest run --maxWorkers=2 test/cli/wave18-rereview-probe.test.ts test/cli/status-at-run-now.test.ts test/cli/status-at-run-marks.test.ts test/cli/status-at-both.test.ts test/checkout/under-path.test.ts test/checkout/left-under.test.ts test/cli/status-at-run-units.test.ts` | Exit 1, 80.39 s. Six existing files passed. Of three independent probes, startup and isolation passed; the retry honesty assertion failed as described in blocker 2. Total: 30 passed, 1 failed. Temporary probe removed. |
| `timeout 600 pnpm exec vitest run --maxWorkers=2 test/runners/boundaries.test.ts test/cli/status-at-next.test.ts test/cli/status-at-run-mutated.test.ts test/cli/status-at-review13.test.ts` | Exit 0. Four files, 22 tests passed, 70.27 s. |
| `timeout 600 pnpm exec tsx /tmp/sq-rereview-path.mts` | Exit 0. Real disposable-process measurements: original embedded-prefix witness survived; both new outside-path witnesses below died on SIGTERM. All children and folders cleaned; script removed. |

No local full suite or build ran on the loaded host. Exact-candidate [CI 44834379924](https://github.com/hearsay-tools/squeal/actions/runs/44834379924) was still in progress when checked; full-suite and build/bundle results are **unverified**. Exact-candidate [Private material 44834379981](https://github.com/hearsay-tools/squeal/actions/runs/44834379981) passed. The first review's missing benchmark comparison remains **unverified**, not blocking.

Inputs retained from the first review: CLAUDE.md, process, vision, styleguide, board, wave-18 brief, spec/status amendments and lessons Round 4 R1-R8. The prior findings were read before the repair delta. No product code was changed.

## Blockers

### 1. Proven, original B1 remains: cleanup still kills processes outside the checkout

**Locations:** `src/core/checkout/under-path.ts:24` and `:49`; signal boundary `src/core/checkout/left-under.ts:100`.

Row 023-31 says: “Never touch a process outside the path.” Whole-component containment fixes the original embedded-prefix, punctuation-sibling and simple traversal examples. Two new paths through the repaired matcher still break that rule. Each was reproduced with a real disposable child, with its cwd outside the checkout. Cleanup reported it as ended and the child exited on SIGTERM.

**Witness A: symlink traversal with an absent leaf.** Let `C` be the checkout, and let existing `C/out` point to `/external/dir`. Give a harmless idle child the absolute argument `C/out/../missing`, where the final leaf does not exist. Kernel path resolution reaches `/external/missing`, outside C. Full `realpathSync` fails on the missing leaf. The fallback calls `resolve(path)` first, collapses `out/..` lexically, and returns `C/missing`. `underFolder` therefore accepts it and cleanup kills the child.

**Witness B: a legitimate executable path with spaces.** Copy `/bin/cat` to an executable whose absolute pathname is `/base/outside ${C}/run/cat`, with C substituted as an absolute path. This complete pathname is outside C. Start it with no arguments, an outside cwd, and open stdin. Its cmdline contains one real argv entry, the executable pathname. `pathArgs` splits that entry on spaces and invents a separate `${C}/run/cat` path. Cleanup accepts that invented argument and kills the process.

**Repair:** one checkout worker should preserve path components until symlinks and `..` have been resolved in filesystem order. Unresolved or unreadable paths must not become false containment evidence. Preserve actual NUL-delimited argv entries. A single entry is not evidence that a browser rewrote its command line; use reliable process-specific evidence for that case, or skip the ambiguous argument. Add both real-process survival regressions. Keep valid contained paths, checkout aliases, uid and caller/ancestor exclusions covered.

### 2. Proven repair regression: the second commit pass can report a changed checkout as the original commit

**Locations:** `src/cli/status-at-run.ts:171`, `:200`, `:210`; `src/cli/status-at-run-loop.ts:102`.

The budget repair permits a second commit-side pass when the first completed zero files. Each pass creates a new `runBatches`, whose first batch skips `beforeLater`. The whole-checkout check therefore does not run between the two passes. A tracked change made by the first pass remains invisible to `changed`, and the next child receives `store: true`.

This reopens the commit-result honesty claim settled by the first review. The new zero-completion route is introduced by removing the first-pass completion condition. The analogous gap after a partially completed pass already existed; this finding does not claim the repair created that older route.

**Independent real-runner reproduction:** base `src/a.ts` exports `value = 1`; HEAD exports `value = 2`. The same test exists at both commits. When it reads 1 and an external marker is absent, it writes tracked `src/a.ts` to export 2, writes the marker, then waits forever. Otherwise it asserts that value is 2. Run the normal two-sided command against base, with no daemon and one 70 s budget.

The first commit pass times out with no completed file. The current side passes. The second commit pass uses the already modified checkout. Observed report:

```text
run.batches:       2 (30.4 s, then 2.6 s)
run.usedMs:        36830
changed:           null
run.changed:       null
file.at.state:     pass
file.at.origin:    run, commit = base, stored = false
file.now.state:    pass
file.change:       unchanged
run.notComparable: 0
```

The assertion that the commit side must not read `pass` failed. The result was not stored in this witness; no store corruption is claimed. It still reads as a pass at base, although the succeeding pass used different tracked source. It must carry the existing “a test of an earlier batch changed src/a.ts” treatment instead.

**Repair:** one status-run worker should keep the whole-checkout check across pass boundaries. Check before every child after the first child in that checkout, including a retry after zero completions. Keep the existing changed-checkout behavior: no storing, and completed outcomes marked not comparable with the changed path. Add this two-sided regression without disabling either side or removing the unused-budget handback.

## Closed findings and what fits

- **Original B2, closed with an independent real child.** A configuration expression throwing `review configuration rejected\nsecret second line` returns `not run`, reason `setup`, text `tests: review configuration rejected`, no problem and no leftover estimate. It contributes no budget state. The new existing startup-throw regression also passed. The child catch retains setup notes or the error's first line; `readNow` marks budget only for an actual stop.
- **Original B3, closed with an independent real-project probe.** Two ordinary files share their paths with a manual project whose global setup throws. Manual refs are supplied first and batches hold one path. Both ordinary markers are written. Only manual refs get setup states, including the later unstarted manual file. The existing shared-project regression also passed. Lot-plus-path slots and exact refs reach the child's adapter filter through the gate's existing `adapters` option. Method binding is preserved. No gate protocol or key change is needed.
- **Original note 3, test-only option removed.** `AtOptions.workingTree` is gone. Commit-only tests call the commit-run boundary. The real command still supplies the working-tree turn. The new 40 s two-sided budget test passed: the quick current side passes, the slow commit side stays budget-cut, and the commit takes a second turn within the shared deadline. Blocker 2 limits its honesty after tracked mutation. A live daemon end-to-end run remains unverified; injected daemon-port tests passed.
- **Original note 4, extraction accepted.** `commitRun` owns commit keying/run setup and one deadline; `assembleReport` owns final report assembly. These are cohesive responsibilities. The reported complexity 25 is addressed without a test-only product switch or scattered conditional helpers. Refusal still runs before current keying, then commit keying/runs, cleanup, current refresh and report. The targeted next/refusal and older mutation checks passed.
- **Named-file rule accepted.** An exact named test file with a missing result now overrides diff selection on both sides. This makes the explicit `<file> --run` direction useful for unchanged test files too. Folder and source paths still narrow selection; they do not force every contained file to run. The same exact-path rule reaches the no-run next-step probe. The real named-file regression passed and its following lookup reads the stored results. R8 marks remain on other unselected files.
- **R4 and R5 remain settled by the first review.** No repair changes the fit calculation, 600 s cap, proof summary or three active skill copies. Fit/marks units passed again. This re-review does not claim a fresh proof/skill run.
- **Original process notes partly closed.** TERM now rechecks start time, uid and path. Existing pid-reuse, caller/ancestor, uid, escalation and canonical-checkout tests passed. `leftUnderNote` supplies the unsupported-platform/error note. Cleanup still uses the existing stderr note callback; JSON status parsed cleanly in the real probes.

## Nonblocking notes

1. **Plausible, process revalidation:** `src/core/checkout/left-under.ts:104` rechecks start time before KILL, but not uid or path. Either could change during the grace period. A small check-to-signal pid race also remains. No real pid-reuse or owner-change incident was reproduced. Reuse the full eligibility check at escalation; use stable process handles where practical.
2. **Proven wording mismatch, low impact:** the named-file regression deliberately runs a file the change does not select, while working-tree text still calls these “test files the change selects” (`src/cli/status-at-report-run.ts`). The behavior is appropriate; call them selected test files or include explicitly named files in that phrase. This is not a result-integrity blocker.

## Inputs for the fix wave

Dispatch blocker 1 to a checkout-path worker and blocker 2 to a status-run worker. Their source ownership is disjoint. Keep the B2/B3 project-aware adapters, first-line setup reporting, named-file rule and extracted command boundaries. Re-review the two concrete repairs and their deltas. Exact-candidate CI/build and the live-daemon path still need evidence before claiming those checks passed.
