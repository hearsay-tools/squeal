# Wave 1.9: candidate 0.1.208

PASS `bc3065c2a8ea0d5a0c48aa6f8e20cc244e11dc2e`. 0 blockers, 1 should-fix, 0 nits.

## Verification

HEAD matched the assigned candidate exactly. All verification ran at that commit on a clean tracked tree, before this findings file was written. Reviewed `a32a6f09..bc3065c2`, with `1a82867e` treated as board documentation, against board rows 011-09 and 011-10, their wave-1 briefs, 011 C1/C6/C9, 005 D1/D2 and 004 D9, including the three amendment logs at `bc3065c2`. The local `origin/main` was `3b1b8d32`; its additions since `a32a6f09` are board documentation only.

Commands and output:

```text
npm ci
added 196 packages, and audited 197 packages in 6s
found 0 vulnerabilities
exit 0

npm run lint
> squeal@0.1.208 lint
> biome check .
Checked 1384 files in 511ms. No fixes applied.
exit 0

npm run typecheck
> squeal@0.1.208 typecheck
> tsc --noEmit
exit 0

npm run check:version -- origin/main
> squeal@0.1.208 check:version
> node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/check-version-bump.ts origin/main
version bump: 0.1.207 -> 0.1.208, ok
exit 0

flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
 Test Files  688 passed | 1 skipped (689)
      Tests  5859 passed | 10 skipped (5869)
   Start at  12:07:09
   Duration  772.00s (tests 98%, import 2%)
exit 0
```

The install also printed the node-domexception deprecation, funding notice and six existing install-script approval warnings. No build was run, as the brief explicitly requires. Regenerated bundle drift is therefore **unverified**, not a blocker. All four committed CLI bundles contain the root guard and the snapshot-first/verdict-last rendering paths.

Two throwaway source probes ran outside the checkout with `node --import tsx`, importing this candidate's real formatters, parser and stop command:

```text
PASS 64 real-formatter/parser comparisons (pathless/named, plain/hook JSON, unlisted and files without checks)
Returned on timeout after 1.0 s: 5 checks (3 tests, 2 test files loaded) and 5 test files without checks pending at revision 3. Worktree: known failures 3 (1 test, 1 test file that did not load, 1 global setup); checks 3 running (2 tests, 1 test file loaded), 2 queued (1 test, 1 test file loaded); 5 test files without checks: 2 running, 3 queued
PASS explicit missing path, existing subdirectory and existing file contact no enclosing socket; symlink-root and no-argument subdirectory retain canonical root resolution
```

The parser comparison checked each wait's worktree revision, pending/stale/unknown counts, slow state, daemon state, known failures and verdict against `formatStatus` for the same snapshot. It included unlisted test files and pending/unknown files without checks. The root probe used a listening Unix socket for the enclosing root and asserted it received no request for each rejected explicit path. Both probes exited 0 and changed no tracked file.

The installed 0.1.199 Squeal daemon separately reported the two recorder-fidelity baseline failures in `run-reads-fidelity.test.ts` and `observe-fidelity.test.ts`. They are not the independent gate above, and their runner sources and tests are outside this diff. The independent run passed all executed tests. No Squeal checkpoint was substituted for it.

## Blockers

None.

## Should-fix

### S1 (proven, nonblocking): the new wait parser pins omit hook JSON

`test/evals/evidence-squeal.test.ts:178` and `:191`. The existing status/header matrix iterates `wrappings`, including Claude Code's `hookSpecificOutput.additionalContext`. The new real-formatter wait matrix and the selected-file credit test call `squealEvidence` only on plain text. Thus the review brief's plain-and-hook round-trip has no persistent hook-form regression guard for the reordered wait text.

The independent probe above verifies that both forms work now, including unlisted files, so this is a coverage omission, not a demonstrated product defect or a break of either row's done-when.

One-worker fix: iterate the existing `wrappings` for the two new wait formatters, comparing each wrapped wait with the equivalently wrapped status. Wrap the selected-file credit assertion too. Keep the actual `waitText`/`namedText` calls; do not replace them with hand-written output strings. No product or spec change is needed.

## Nits

None.

## What fits

- **Honest final counts:** `worktreeText` reuses status's failure and check-unit formatters and snapshot phase counts. Test failures, files that did not load and failed global setups remain separate. Pending files without checks have their own running/queued split and are not added to check counts. `testFilesListed === false` appends an explicit incompleteness warning even when the displayed counts are zero. The probe checked the mixed-unit suffix and both parser forms.
- **Every wait rendering seam:** ordinary and slow waits share `statusWaitCommand` and end their text with `waitLine`. Named waits end with `namedLine`, following the snapshot, selected files and their failures. JSON stdout still receives the existing payload shape; ordinary JSON stderr ends with the verdict, and named JSON stderr prints selection before the verdict. Settled, news, timeout, unmatched and no-daemon branches retain their meanings and exit codes. Unavailable reads retain their distinct unavailable-status response. No selection, scheduling, liveness or payload logic changed.
- **004-66 retained:** the heartbeat lapse clause remains on the verdict line through both renderers. `slow-wait-liveness.test.ts` now checks the last line for recovery and stopped-daemon cases; `run-slow-wait.test.ts` checks the final timeout line. `run --slow --wait` keeps its pending slow-file names and no-verdict exit 3.
- **Checkpoint exception retained:** `run --all --wait` still uses its independent checkpoint formatter, with the verdict first as 005 D1 requires. Its implementation is unchanged; `run-all-verdict.test.ts` retains the first-line assertions.
- **Skill conflict resolved:** the three `references/commands.md` files are byte-identical. The three `SKILL.md` bodies match after removing the harness-specific launcher paragraph. Step 3 and command references say the wait verdict is last; step 4 still says slow files are required "once you edit", and the slow command reference retains "once you change a file". The checkpoint command reference still explicitly says first line. The primer source and its cap were not changed.
- **011-09 root isolation:** explicit arguments resolve against the CLI cwd, must exist, and must equal the canonical worktree root before `daemonSocket` or `askDaemon` runs. A removed linked worktree and a directory left at its former path cannot fall through to the enclosing checkout. An existing non-root path exits 1 and stops nothing, as accepted in 011's amendment log. A valid root without a daemon exits 0. The no-argument route still calls `worktreeRoot(undefined, io)`. The new socket-observing regressions cover missing/relative paths, linked roots without daemons, removed roots with leftover directories and a successful explicit-root stop; existing no-argument and shutdown-bound tests remain applicable.
- **Specs agree:** 011 C6 describes snapshot first, verdict last and worktree suffix counts; C9 records explicit-root rejection and no-argument resolution; 005 D2 gives the named output order while D1 preserves checkpoint-first; 004 D9 moves the lapse explanation to the last verdict line. Each amendment is logged. No status/board repair was made; the newer board-only `3b1b8d32` already puts these rows in review.

## Inputs for the next wave

No repair wave is required for these two rows. S1 can be one test-only row in the next wave, owning only `test/evals/evidence-squeal.test.ts` and reusing its existing formatter/wrapper helpers.

For 011-08, retain the explicit-root guard before all socket work and before writing any root-scoped stopped mark. Preserve `STOP_BOUNDS` (60 s socket, 30 s lock, 10 s leftovers). The guard must reject missing and non-root explicit paths without reading or writing another root's stop mark or contacting its daemon. Keep the no-argument resolution intact.

For later wait work, call `waitText` for a completed pathless/slow snapshot and `namedText` for a completed named snapshot. JSON keeps the existing payload and sends the selection before `namedLine` on stderr. Keep `run --all --wait` separate with its verdict first. Neither output-order change authorizes priority, promotion, per-file diagnostic semantics or a liveness-budget change; those remain their owning rows' work.
