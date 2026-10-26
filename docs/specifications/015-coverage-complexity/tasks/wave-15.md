# 015 wave 15: one coverage-off note per daemon, an exclude change during the first seed, and the dogfood's round 2

Briefed by coordinator 52e58f23 on 2026-10-26, after 0.1.349. Three rows on disjoint seams run in parallel. W1 and W2 build one candidate; W3 changes docs only.

## W1: 015-72

Use /worker. Shape: repair. Starts from main 0.1.349. Outcome: two adapters on one coverage object that fail at the same time give one coverage-off note; each failed run still closes and reports its own cause.
- Read board row 015-72, `reviews/0.1.349.md` S1 (the probe), `tasks/015-70/notes.md`, and spec 015 D8 as amended 2026-10-26 (015-70).
- **Lead.** In `src/runners/vitest/coverage.ts` `recordProviderFailure`, return the note only for the first failure that the coverage object records; a later one returns `null`. The adapter's `noteOnce` call at `adapter.ts` `#unloaded` stays.
- **Owns.** `src/runners/vitest/coverage.ts`, `src/runners/vitest/adapter.ts`, and the tests in `test/runners/vitest/` for the provider failure. Leave `src/core/**` alone (W2's).
- **Done when.** A test with the review's fast and slow probe, red first: two crashed runs, two run failures with their own causes, one note. The coordinator amends D8 at landing. Notes in `tasks/015-72/notes.md`. Lint and typecheck pass, and `squeal status --wait 60000 <changed-path>...` gives the verdict; paste both. No full suite. Do not build bundles or raise the version.

## W2: 015-69

Use /worker. Shape: repair. Starts from main 0.1.349. Outcome: an exclude change during coverage's first seed leaves no pending coverage state in a newly excluded file, or the row records with proof that the case cannot occur.
- Read board row 015-69, `reviews/0.1.345.md` N2, `tasks/015-67/notes.md`, and spec 015 D9.
- **Lead.** Reproduce first in `test/code/crap/excluded-move.test.ts` or a new file beside it, with `rig.ts`: a sliced first seed with no summary, one seeded file, an exclude added for it, and a function moved into it before the seed ends. If it fails: in `src/core/code/crap/step.ts` (line 111), the first seed calls the exclusion owner (`withStates` with `applyChecks` in `checks.ts`) without a prior summary.
- **Owns.** `src/core/code/crap/**`, `src/core/code/pass/**`, and `test/code/crap/**`. Leave `src/runners/**` alone (W1's).
- **Done when.** The test asserts complexity alone, with nothing told. B1, B2 and the first-judgement tests still pass. Notes in `tasks/015-69/notes.md`. Lint, typecheck, and `squeal status --wait 60000 <changed-path>...`; paste both. No full suite. Do not build bundles or raise the version.

## W3: 015-14 part B

Use /worker. Shape: finish, survey. The brief is Part B in `tasks/wave-3.md`, with these changes:
- **Window.** From 2026-10-25T18:10Z (`tasks/015-14/window.md`, the last switch on) to the spawn. Since 0.1.341 (2026-10-26 12:00Z) coverage is on by default for every project, and the delivered word for `uncovered` is `untested`. Split every count by Squeal version.
- **The clone.** `git archive squeal--v0.1.349`, not 0.1.301.
- **Host load.** Make no load on purpose. Run each A/B pair beside the host's real load and state the one-minute load per pair. Hold a pair while the load is over 24 on 24 CPUs and say so.
- **Isolation.** Set `HOME` to a scratch directory under `/tmp/dogfood-015-14/` for every command that starts Squeal or an agent tool. Run no script under `evals/bin/`.
- **Owns.** `docs/specifications/015-coverage-complexity/lessons.md` and `tasks/015-14/`. No product code.
- **Done when** is Part B's, and also: the window's coverage notes ("coverage is off until the daemon restarts", 015-70) counted per session.

## 015-73: review of candidate 0.1.352 (wave 15)

Use /reviewer. Candidate `cand/0.1.352`, pinned to the SHA in the spawn, on main 0.1.349: three 015-72 commits, two 015-69 commits, and the version and bundles. Write `reviews/0.1.352.md` in this spec and commit it on your branch.

Read rows 015-72 and 015-69, W1 and W2 above, `tasks/015-72/notes.md`, `tasks/015-69/notes.md`, `reviews/0.1.349.md` S1, `reviews/0.1.345.md` N2, and spec 015 D8 (amended 2026-10-26) and D9.

Check, with proof where you can:
1. **One note.** Two adapters on one coverage object that fail at once give one note; each failed run still closes and reports its own cause. A single failure behaves as in 0.1.349.
2. **First seed.** An exclude change, or a check switched off, during coverage's first seed leaves complexity alone in the newly excluded file, with no change record and nothing told. `leaveOutSeeded` runs only when no summary exists.
3. **No regressions.** B1, B2 (`reviews/0.1.337.md`, `reviews/0.1.341.md`) and the first-judgement tests hold; a seed with a summary behaves as before.
4. **Keys.** No key, store-format or policy change.

Checks (`docs/process.md`): lint, typecheck, Squeal's affected results or targeted `npx vitest run` of files you name. No full suite. Do not run `npm run build` in your tree. Name the candidate's CI result or say it is pending. Label findings proven, plausible or unverified. Verdict PASS or FAIL; only a proven break blocks.
