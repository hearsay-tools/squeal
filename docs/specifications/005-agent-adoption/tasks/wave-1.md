# 005 wave 1 briefs

## 005-10 the checkpoint's verdict

Use /worker. Shape: slice.

**Outcome:** `squeal run --all --wait [<ms>]` exits 0 only on a completed, current, failure-free checkpoint, 1 on known failures, 3 when Squeal has no verdict, and its first line says which.

**Read:** spec D1 with its 2026-10-12 reconciliation paragraph; 001 D5 and D7 for checkpoints; `status.md`, 2026-10-12.

**Seam:** `src/cli/run.ts`. First edit: replace `ended()`'s bare `end` with a verdict computed from the store at the checkpoint's end, in a new `src/cli/verdict.ts` that 005-11 will import for named files. `--wait` stays valid bare; read `<ms>` as `src/cli/wait-arg.ts` does for `run --slow`.

**Owns:** `src/cli/run.ts`, `src/cli/verdict.ts`, their tests under `test/cli/`, the `## squeal run --all` section of both plugins' `skills/squeal/references/commands.md` (identical).

**Leave alone:** `run-slow.ts`, `status-wait*.ts`, `src/core/status/`, `src/core/delivery/`, `src/harness/`, `evals/`, `CLAUDE.md`, the skills' other sections, `docs/board.md`, bundles (`plugins/*/dist`) and `package.json`'s version.

**Done when:** each exit code is a test, among them a revision recorded during the checkpoint (3), deadline with files pending (3), no daemon (3), a covered file unknown at the end (3), a joined checkpoint (001-217) and an owed one (001-219); a real-daemon failing checkpoint exits 1; tests and file-level checks counted apart in the lines `run --all` prints; lint, typecheck, suite green.

## 005-11 a wait on named files

Use /worker. Shape: slice. Runs beside 005-12.

**Outcome:** `squeal status --wait <ms> <path>...` waits only for the test files the paths select, and exits as D1 for them.

**Read:** spec D2 (with its 2026-10-12 note on 001-258); D1 for the exit codes and units; `src/cli/verdict.ts` (005-10), which takes named files.

**Seam:** `status()` in `src/cli/main.ts`, which refuses positional arguments today. First edit: pass them to `statusWaitCommand` and select files in a new `src/cli/status-wait-paths.ts`: a test-file path selects itself; any other path selects the test files whose stored closure holds it, only while that closure is valid for the file's current key (001 D6; `src/core/keys/closure.ts`). The wait's file set comes from there, not from 001-258's edit record.

**Owns:** `status()` and the `status --wait` usage lines in `main.ts`; `status-wait.ts`, `status-wait-lines.ts`, the new module, their tests; one paragraph on the path form in the "Waiting for pending checks" section of both plugins' `commands.md` (identical).

**Leave alone:** `main.ts` outside those lines (005-12 adds `setup` there), `run.ts`, `verdict.ts` (ask before changing its API), `src/core/`, `src/harness/`, bundles, version, `docs/board.md`.

**Done when:** selection tests (test path, source path through a valid closure, a stale closure not used, a path selecting nothing exits 3 with D2's text); a wait on a pending named file returns when its result lands; exit 0/1/3 for the selected files; pathless `status --wait` unchanged; lint, typecheck, suite green.

## 005-12 the setup engine

Use /worker. Shape: slice, one commit per part. Runs beside 005-11.

**Outcome:** `squeal setup --plan [--json]` and `--check` report everything D3 asks, and `squeal init` gains the per-choice flags that apply it; no question asking, no warm-up (005-14).

**Read:** spec D3 ("`squeal setup`" steps 1, 2, 4 and "Slow tests and their inputs"), D4, D5; `research/wave-0-checks.md` 2 and 7 and its recommendation; `src/cli/init.ts`, `remove.ts`, `node-test-seed.ts`.

**Seam:** a new `src/cli/setup/` directory: `plan.ts` (read-only facts, JSON shape first), `block.ts` (D4), `gates.ts` (D5), `candidates.ts` (slow and artifact candidates). First edit: the plan's JSON type and a fixture test of it on a repository shaped like this one.

**Leads from 005-04:** a node:test project alone is not a slow group (ask, default "not slow"); artifact candidates are asked per directory with their evidence, never ranked by count; a missing build is reported as "not built in this worktree"; `files` entries are weak evidence. D5's `<ms>`: 110000 for Claude Code (its Bash tool stops at 120 s), and the sentence says exit 3 on a deadline means run it again.

**Owns:** `src/cli/setup/`, `init.ts`, `remove.ts` (the block), the `setup` dispatch and usage lines in `main.ts`, their tests.

**Leave alone:** `status()` in `main.ts` (005-11), `run.ts`, `verdict.ts`, `status-wait*`, `src/core/`, `src/harness/`, skills, bundles, version, `docs/board.md`.

**Done when:** plan JSON tests; block write, replace, refuse a begin without end, the symlinked `AGENTS.md -> CLAUDE.md` case, `remove` taking it out; gate detection and rewording tests; candidates match `research/wave-0-checks.md` 7's table on fixtures; `init` with no new flag behaves as today; lint, typecheck, suite green.

## 005-13 review of wave 1

Use /reviewer. Shape: review.

**Range:** `ce1425a1^..d1d3522a` on main: 005-10 (0.1.132), 005-11 and 005-12 (0.1.133). Ignore other coordinators' commits in the range (001, 006).

**Read:** spec 005 D1 to D5 with their 2026-10-12 and 2026-10-13 notes, `status.md` (the accepted choices for each row), the briefs above.

**Look hardest at:**
- Honesty of the exit codes: can `run --all --wait` or `status --wait <ms> <path>...` exit 0 while a covered file is pending, stale, unknown, failing, or at an older revision? Can a known failure exit 3 instead of 1?
- Named-file selection: a stale closure used, a path outside the worktree, a test file written mid-wait.
- Setup: does `init` with no new flag behave exactly as before; can a block write or `remove` damage an instruction file (symlinks, a begin without an end, CRLF); does the plan claim anything it did not check (Codex trust)?
- The KEY_FORMAT_VERSION 9 bump: is `src/cli/setup/` correctly outside the guard?

**Output:** `docs/specifications/005-agent-adoption/reviews/wave-1.md` (blockers proven by a probe, should-fix, notes), committed on your branch. Change no source.
