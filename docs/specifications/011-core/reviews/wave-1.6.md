# Wave 1.6 review: 005-69, 011-05, 011-02 and 011-06

PASS `6cf206037eba171a8ca8328cff7b86cacb139f36`: 0 blockers, 1 should-fix (documentation, S1), 0 additional product notes.

## Verification

Reviewed `cand/0.1.205`, range `353b0ba4..6cf20603`, against the board Done-when clauses and `005-agent-adoption/tasks/wave-8.md` (005-69) and `011-core/tasks/wave-1.md` (011-02, 011-05, 011-06 and repair 1). `git rev-parse HEAD` returned the pinned SHA above. The tracked tree was clean throughout the independent checks. No product code was edited.

```text
$ npm ci
added 196 packages, and audited 197 packages in 7s
found 0 vulnerabilities
exit 0

$ npm run lint
> squeal@0.1.205 lint
> biome check .
Checked 1372 files in 419ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.205 typecheck
> tsc --noEmit
exit 0

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/c4838c82-de8e-4a5c-ab90-3f32ecf99f91
 Test Files  680 passed | 1 skipped (681)
      Tests  5797 passed | 9 skipped (5806)
   Start at  10:17:55
   Duration  762.25s (tests 98%, import 2%)
exit 0

$ git diff --check 353b0ba4..6cf20603
(no output)
exit 0

$ git status --short
(no output)
```

`npm ci` also printed the existing `node-domexception` deprecation and six install-script coverage warnings; installation succeeded. The independent suite above is the required reviewer check, not a Squeal checkpoint. `npm run build` was explicitly excluded by the dispatch and was not run: this review makes no independent build-drift claim. The coordinator's supplied 5,796-pass gate is separate evidence.

The independent run also printed two fixture Git-worktree repair lines, an earlier-run process cleanup line and Vitest's experimental typechecking notice. It ended with exit 0 and no failures. Background Squeal separately reported two recorder-fidelity assertion failures in `test/runners/node-test/run-reads-fidelity.test.ts:116` and `test/runners/vitest/observe-fidelity.test.ts:119`. Those tests exercise the difference between observed and unobserved child processes; neither failure reproduced in this independent full run. Their background-only cause was not separately reproduced and is not attributed to this diff.

Direct smoke checks of the committed bundles returned exit 0 for Claude Code's `run --help` and Codex's `setup --help`, printed the expected flags, and returned `0.1.205` for Pi and OpenCode `--version`. All eight version locations are `0.1.205`, including the lockfile's root package entry. All four committed CLI bundles have SHA-256 `d1f3a05ac381ca9e3b91513c30fdcbbbe9cf1ad6b350e09ed37b2ec3e0feeaef`. `KEY_FORMAT_VERSION` is 11; the last release tag `squeal--v0.1.199` carries 10. The key-format guard passed in the independent suite.

## Blockers

None proven.

## Should-fix

### S1: record the accepted scheduler and adapter contract changes (proven documentation drift)

`docs/specifications/011-core/spec.md:123` still says that adding or deleting a path cancels a backlog tier, before its runner part finds what it reaches. The approved 001-364/011-06 rule and `src/core/scheduler/backlog.ts:25` now cancel only for queued edit work in that lane or a changed tier input, checking again after runner refinement. The blanket add/delete rule no longer describes this candidate.

`docs/specifications/013-vitest-runner/spec.md:41-42` still describes source-stamp and heard-touch drops as immediately making files `unknown`. Completed files dropped by the adapter now pass through `RunReport.withheld` and bounded `Ledger.discard` retries. `011-core/spec.md:305` lists the adapter report contract without the new `withheld` field, and `011-core/status.md` has no amendment for this row yet. The unchanged completion barrier remains a distinct path with its existing retry budget.

Size of fix: one coordinator documentation pass at landing. Amend 011 C4/C14 and 013 V5 to name `withheld`, its exclusion from `completedFiles`, the no-storage guarantee, `MAX_DISCARDS`, and the lane-aware cancellation rule; record the dated amendment and coordinate the 013 wording. The dispatch and approved board rows already authorize the implemented behavior, so this is nonblocking and calls for no product repair.

## Notes and nits

No additional product finding or style nit. Verification limitations are stated above, not treated as findings against the candidate.

## What fits

- **005-69, proven by source and regression:** every dispatched command goes through one help guard before its parser or command body (`src/cli/main.ts:160`). Both `--help` and `-h` return synchronously with exit 0; the per-command regressions cover all 13 commands, their flags, unchanged repository snapshots, and unknown arguments still returning 2. Setup includes its complete choice usage; init's setup choices remain in the root help without a new guarded import. The committed CLI smoke checks exercise the shipped entry point.
- **011-05, proven by source and regression:** `statusIdentity` consumes the header reader's identity, compares the live Git ref before the next pass, and nulls the dirty observation when HEAD moved or no daemon validates (`src/core/status/identity.ts:28`). The revision and Worktree text use the same top-level identity. The commit-without-edit regression covers immediate and post-pass reads, a partial commit, no-daemon reads, and unchanged validity for identical bytes. JSON `commit` deliberately remains the daemon's recorded header value; top-level `head`, `dirty` and `headMovedSince` describe the status observation, as the dispatch specifies.
- **011-02, proven by source and regression:** the three reason builders put the explanation before path data, use five-path samples with a total and remainder, and retain every path in the stored reason (`src/core/text.ts:28`). The 660-path regression crosses `SUMMARY_MAX_CHARS`, preserving the explanation and total. The unknown delivery block supplies the custom CLI's `why` command; status caps the reason while JSON and `why` retain it. The own-edit suppression parser was updated alongside the reason format and reads the complete list after the sample. The Vitest report writer persists the post-filter report, including the full reason, to `report.json`.
- **011-06/001-364, proven by source and regression:** `dropFiles` lists only completed dropped files as withheld and removes their results, file errors, durations and observation data (`src/runners/vitest/moved.ts:103`). The composite retains that field (`src/core/daemon/composite-runner.ts:189`); `recordTier` handles it before recording results or treating cancellation's unfinished files (`src/core/scheduler/tiers.ts:443`). Discards retain forced runs, count toward the limit, and preserve the runner reason on exhaustion. The scheduler regressions cover one-touch recovery, repeated touches stopping at `MAX_DISCARDS`, lookup-only startup, unrelated additions/deletions leaving a backlog tier alone, a newly queued test cancelling it after refinement, and already completed files keeping their results without running again.
- **Repair 1 and integration, proven by source and regression:** the revised integration tests distinguish unsafe runs from later valid runs. The revert/restore fixture makes the unsafe run fail, checks that failure was not published, then expects the unarmed retry's pass; the stylesheet fixture checks the withheld report separately from the stored retry's failure. The self-writer test hears a touch on each run and exhausts the discard budget without a stored result. The conflict resolution in `stability.ts` keeps `pathsReason` and strips adapter `withheld` metadata when the completion barrier replaces the whole report, preserving the barrier's existing per-key retry accounting.

## Inputs for the next wave

No product fix wave is required by this review. Fold S1 into the landing documentation. Preserve these boundaries: a withheld report stores no result; only its completed dropped files consume the new discard budget; a completion-barrier retry uses its existing separate accounting; a cancelled tier keeps completed stable files and re-queues unfinished files uncounted; and cancellation is reconsidered after runner refinement under the scheduler lock. Named-wait diagnostics and promotion remain outside this candidate.
