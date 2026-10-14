# 007 wave 3 briefs: proof

Two rows on 0.1.169 (key format 10). 007-17 runs now; 007-18 waits until 005's release evals on `squeal-e2e` finish (they take turns on that user and on the host's load). Workers read `docs/vision.md`, `docs/styleguide.md`, spec 007 as amended and `status.md` (every 2026-10-14 entry) first. Python environments only through `test/helpers/pytest-env.ts` or uv inside a scratch directory of your own; never the system or user Python, never the real `HOME`. Do not run `npm run build` in your worktree; the coordinator builds at integration. Load is high on this host: re-run a failing file alone before calling the failure yours.

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

Shape: survey. Pick a permissively licensed project with a few hundred test files, a `src` layout and a uv- or pip-syncable `pyproject.toml`; name the commit. Clone and sync it under `squeal-e2e`'s home only. Install the 0.1.169 plugins as `squeal-e2e`, run `squeal setup`, then one Claude Code session (`sonnet`) and one Codex session (`gpt-6.1-sol`) each given an ordinary task in the project: fix a seeded failing test, then refactor a module two test files import. Measure batch sizes 1, 5 and 10 on the full baseline (open question 5) and watch for a run reading a half-synced environment (open question 7).

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
