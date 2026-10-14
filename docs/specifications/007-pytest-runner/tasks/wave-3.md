# 007 wave 3 briefs: proof

Two rows on 0.1.169 (key format 10). 007-17 ran first; 007-18 starts after 005's release evals (finished 2026-10-14). Take batch-size timings only while the one-minute load is below 8 and say the load beside each number. Workers read `docs/vision.md`, `docs/styleguide.md`, spec 007 as amended and `status.md` (every 2026-10-14 entry) first. Python environments only through `test/helpers/pytest-env.ts` or uv inside a scratch directory of your own; never the system or user Python, never the real `HOME`. Do not run `npm run build` in your worktree; the coordinator builds at integration. Load is high on this host: re-run a failing file alone before calling the failure yours.

## 007-17 end to end: the shipped plugins validate pytest projects

Outcome: the plugins as a marketplace install copies them validate a repository with two pytest projects beside a Vitest suite, through both harnesses, on pytest 8 and 9 (spec Testing, end to end and integration; goals 1, 2, 7, 8).

Read: spec Goals, D1, D2, D8 and Testing; `test/e2e/harness.ts`, `install.ts`, `node-test.test.ts` (the shape to follow); `test/fixtures/pytest/README.md`; `reviews/wave-2.md` input 6 and `reviews/wave-1.md` input 7 (pytest 8).

Shape: slice. Seam: `test/e2e/pytest.test.ts` beside `node-test.test.ts`, with an `InstallKind` for pytest in `install.ts` (a fixture under `test/fixtures/e2e/pytest/` built from `small/` plus a second pytest project and a Vitest suite, each worktree synced by `pytest-env.ts`). Each scenario for both plugins: the shipped `squeal setup` seeds both pytest projects; a baseline; an edit to a module two test files import delivers `PASS -> FAIL` for exactly those through the hooks; a second worktree with its own `uv sync` inherits with zero runs; a worktree without `.venv` reports `unknown` with D2's note and resolves after `uv sync`; the D8 deny stops a named current pytest file and lets a bare `pytest` run; `squeal stop` stops the daemon. The fixture runs on pytest 8 and 9 (a lock or a constraint per variant, your choice; say which).

Owns: `test/e2e/pytest*.test.ts`, the pytest lines of `test/e2e/install.ts`, `sources.ts` and `harness.ts`, `test/fixtures/e2e/pytest/**`, `.gitignore` lines for it. Leave alone: `src/**`, `plugins/**`, every other test. A product defect you find is a report line with its reproduction, not a fix.

Done when: the suite is green locally on Python 3.10 and 3.13 against a bundle you build into a temp outdir (never `plugins/`), and green in CI on your pushed branch (`gh run list --branch <branch>`); lint, typecheck and the full suite green.

Use /worker.

## 007-18 dogfooding on a real pytest project

Outcome: evidence in `lessons.md` that Squeal validates a real open-source pytest project while real agents work in it, resolving open questions 5 and 7 and reporting every defect.

Read: spec Goals and Open questions; `docs/specifications/003-node-test-runner/lessons.md` (the shape of the report); the `squeal-e2e` user (`docs/board.md` and 005's e2e rows): real `claude` and `codex` run only as that user, credentials passed by name, never in argv.

Shape: survey. Pick a permissively licensed project with a few hundred test files, a `src` layout and a uv- or pip-syncable `pyproject.toml`; name the commit. Clone and sync it under `squeal-e2e`'s home only. Build both plugins from your baseline (main, 0.1.174 or later, never the hub's copy) and install them as `squeal-e2e` by `git archive` of your tree, run `squeal setup`, then one Claude Code session (`sonnet`) and one Codex session (`gpt-6.1-sol`) each given an ordinary task in the project: fix a seeded failing test, then refactor a module two test files import. Measure batch sizes 1, 5 and 10 on the full baseline (open question 5) and watch for a run reading a half-synced environment (open question 7).

Owns: `docs/specifications/007-pytest-runner/lessons.md`, `research/probes/dogfood/` (scripts, prompts, trimmed logs, a README naming every rule followed). Leave alone: everything else; defects become report lines, never fixes.

Done when: `lessons.md` is committed with the baseline's wall time, inherited and run counts, each session's transitions and whether the agent trusted them, the batch-size table, and every defect numbered with its reproduction.

Use /worker.

## 007-28 main CI: a synced second worktree inherits only 6 of 13 on GitHub's runners

Outcome: main's CI is green again, with the cause of the CI-only inheritance gap named and fixed where it lives (product or test), not hidden.

Evidence: CI run 38582092315 (main, 0.1.169) and every `cez/2ab5b448` run since 38571579506 fail `test/integration/pytest.test.ts:149`, `expected 6 to be 13`, on Node 22 and 24; locally on this host the same commit inherits 13 of 13. Run 38563859087 timed out on the third baseline in the same test. GitHub's runners differ by no git identity, cold uv and npm caches, another uv and Python build, other paths and timing (`docs/process.md`). Unrelated and known: `test/watcher/reconcile-pass.test.ts:72` under load.

Shape: repair, CI-driven. Push your branch and read `gh run view <id> --log-failed`. First edit: make the failing assertion say which checks ran instead of inheriting and why (each check's key parts from the second worktree's status or the store: closure hash, environment hash, the session meta key), so one CI run names the differing input. Then fix that input: a path or byte in the environment hash or session observations that is not rewritten to `<worktree>`, an admission timing that keys before the sync settles, or a test that waits on the wrong condition. Raise nothing in `key-format.ts`; say if keys change.

Owns: `src/runners/pytest/**`, `src/core/daemon/pytest-runners.ts`, `test/integration/pytest*.test.ts`, `test/helpers/pytest-env.ts`, tests under `test/runners/pytest/`. Leave alone: `test/e2e/**` and `test/fixtures/e2e/**` (007-17 is running there), everything else.

Done when: the cause is named with the CI log line that shows it; a local regression reproduces it (for example a second worktree whose sync differs the way CI's does); your branch's CI is green on both Node versions apart from known load-sensitive tests; lint, typecheck and the full suite green locally.

Use /worker.

## 007-29 a pytest run never executes stale bytecode

Outcome: a result Squeal stores for a revision always comes from that revision's source, even when an edit keeps a module's size and lands in the same second as the previous run (found by 007-17, 2026-10-14).

Evidence: `src/runners/pytest/run/run.ts` sets `PYTHONPYCACHEPREFIX` under Squeal's state directory. CPython accepts a timestamp `.pyc` when the source's whole-second mtime and size match, so `RATE_PERCENT = 25 -> 20` rewritten within a second of the previous run executes the old constant. Squeal stores that stale FAIL as current at the new revision and never corrects it. Repro: 007-17's e2e fixture, `python/billing/src/billing/rates.py`.

Shape: repair. Seam: the environment `run.ts` builds (`PYTHONPYCACHEPREFIX`, about line 92). Pick the cheapest sound option and measure it on `small` and `gen-big.py`'s output against today: no bytecode cache for project sources (`PYTHONDONTWRITEBYTECODE`), checked-hash `.pyc` files in the prefix, or removing the prefix's `.pyc` for every source changed since the last run. The project's own `__pycache__` stays untouched. Raise the pytest adapter version if keys change, and say so.

Owns: `src/runners/pytest/run/**`, `test/runners/pytest/run/**`. Leave alone: the rest of `src/runners/pytest/**` and `test/integration/pytest*` (007-28), `test/e2e/**` (007-17).

Done when: a regression (same size, same second, a changed constant) fails on main and passes after on Python 3.10 and 3.13; the start-up cost of each option measured is in your report; lint, typecheck and the full suite green.

Use /worker.

## 007-30 a withheld tier is run again, and says why when it is not

Outcome: a tier the completion barrier withholds (task 001-168, `withheldForTouch` in `src/core/scheduler/stability.ts`) because a path was touched in flight is selected again when no revision follows the touch, so its files never stay `unknown` with nothing pending. Found by 007-28 on GitHub's runners and still seen in 007-17's e2e on Node 24 (CI 38603848731, branch `cez/3b5befb1-probe-007-17`, now deleted). Unblocks 007-17's landing.

Read: the Later row "a tier withheld by the completion barrier" in `docs/board.md`; `stability.ts` (`withheldForTouch`, the touch detection above it); its call site in `scheduler.ts` (about line 509); `src/core/scheduler/runner-work.ts`; 007-28's final report in `status.md`.

Shape: slice, core, test first. Seam: the call site that records a withheld report. Its files' previous state stands, and the files are queued for one more run under their current keys. A second withhold of the same file and key in a row leaves it `unknown` and adds a daemon note naming the touched path. Today the reason exists only in known-check summaries, so a file with no known checks shows nothing. Bound the retry so that a path touched on every run cannot loop.

Owns: `src/core/scheduler/stability.ts`, the withheld branch in `scheduler.ts`, `runner-work.ts` if needed, and tests under `test/scheduler/`. 001's coordinator works in `src/core/scheduler/`: keep the change additive and in its own commits, and change no existing test. Leave alone: `src/runners/**` and `test/e2e/**`.

Done when:
- A scheduler test with a touch during a run and no following revision first shows the files `unknown` with nothing pending on main, then shows them current after one re-run.
- A path touched on every run gives one note and stops.
- Vitest and node:test runs are unchanged.
- Lint, typecheck and the full suite are green.
- 007-17's e2e (`cez/dcd4db61`, `0fbcaedf`), merged onto your branch for one CI run only, is green on both Node versions; paste that run.

Use /worker.

## 007-31 review of 007-30 (for 001's sign-off)

Shape: review. `/reviewer` over 007-30's rebased range, pinned to its exact SHA, against spec 001 D6 and D10 and the 001-168 barrier (`specifications/001-core-loop/` review wave 13e B2). 001's coordinator asked for this review (2026-10-14) and signs off from its findings. Check three things:
1. The re-queue fires at most once per withhold. A second withhold produces only a daemon note, and its `unknown` state shows in `status` and in Stop like any other unknown.
2. The `test(001-168)` commits keep their intent: nothing from a withheld run is stored. Check `claims-expiry.test.ts` case 3 (`a.ran - 1 + b.ran == 1`) against the claims-expiry spec text; it is the riskiest change.
3. There is no key-format effect beyond the re-pin of key 10.

Write `docs/specifications/007-pytest-runner/reviews/wave-3-007-30.md`.

Use /reviewer.

## 007-32 repair of 007-31: the retry budget is per file

Outcome: a file withheld twice at one key stops at its second withhold even when it shares a tier with a fresh file, and the tests prove that a withheld run never publishes, even for a moment. First-round repair, so the coordinator decides it; 001's coordinator signs off.

Read: `reviews/wave-3-007-30.md` (B1 and S1 with their reproductions and fixes); the 007-30 section above; `src/core/scheduler/stability.ts` (`Withholds`) and its call in `scheduler.ts`.

Shape: repair, core, test first. B1: classify each withheld file per file and key as first or exhausted, and pass that into recording. Queue only first-withheld files and keep their previous state. Mark exhausted files `unknown` and do not re-queue them. Each subset gets its own note. Withhold every result of the report; never store the other files' results as a shortcut. S1: spy on the test store's `results.putMany` and reject any record whose provenance names a withheld run; also assert that a previously validated file's prior state survives its first withhold while the retry is pending.

Owns: `src/core/scheduler/stability.ts`, the withheld branch in `scheduler.ts`, `test/scheduler/withheld-retry.test.ts`, `test/integration/stamps-repo.ts` and the claims fixture if the regression needs it. Change no other existing test; keep the existing single-file, slow-tier, provenance and claims tests green.

Done when: the review's three-file, two-file-tier regression gives exactly two runs per unchanged key; the `putMany` spy rejects nothing; lint, typecheck and the full suite are green apart from the bundle drift.

Use /worker.

## 007-34 repair of 007-33: exhausted files are never re-queued (the human, 2026-10-14)

Outcome: a file that has used its one retry stops at its second withhold, under a forced checkpoint as well. The scheduler re-queues only first-withheld files, in one write.

Read: `reviews/wave-3-007-32.md` (B1 residual, its reproduction and the observed tiers); the 007-30, 007-32 sections above; `src/core/scheduler/tiers.ts` `recordTier` (the `installMoved` re-queue branch, about line 384); the withheld branch in `scheduler.ts` (about lines 515 to 545); `ledger.markUnknown`.

Shape: repair, core, test first. Seam: `recordTier` takes, additively, the set of files to re-queue (the shape 001's coordinator approved), and the yes/no callers stay unchanged. The withheld branch passes only the first-withheld files; exhausted files are marked `unknown` inside the same `recordTier` transaction, forced or not, and the second ledger commit goes away. Keep `forced` on the re-queued files.

Owns: `src/core/scheduler/tiers.ts` (that parameter only; 001 gave the go), the withheld branch in `scheduler.ts`, `stability.ts`, `test/scheduler/withheld-retry.test.ts`. Change no other existing test.

Done when: the review's forced-checkpoint probe is a regression that gives `[3, 2, 2]` on `823ab34d` and `[2, 2, 2]` after, with unchanged keys and revision and nothing reaching `putMany`; the existing withheld, claims, slow-tier and stamps tests pass; lint, typecheck and the full suite are green apart from the bundle drift. Verified by the coordinator and signed off by 001's coordinator, with no further review (the human).

Use /worker.
