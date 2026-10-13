# 005 wave 2 briefs

005-14 runs as two workers on disjoint seams. Both add a dispatch line to `src/cli/main.ts` (guarded: key format 9 is unreleased, so the coordinator re-pins it at integration, no bump). No real `claude` or `codex` runs in either: tests put stub executables first on a scratch `PATH` with a scratch `HOME`, `CLAUDE_CONFIG_DIR` and `CODEX_HOME`, and drop the real plugin's `bin/` from `PATH` (005-04's slip). The real CLIs are 005-17's. No bundles, no version, no `docs/board.md`.

## 005-14a the terminal setup and `squeal warmup`

Use /worker. Shape: slice.

**Outcome:** a user runs `squeal setup` in a repository and answers its questions, or `squeal warmup` alone, and every test file ends current.

**Read:** spec D3 ("`squeal setup`", "Slow tests and their inputs", the warm-up paragraph) with its 2026-10-12 and 13 amendments, D4, D5; `research/wave-0-checks.md`; `reviews/wave-1.md` "Inputs for the fix and next waves".

**Seam:** `setupCommand` in `src/cli/setup/command.ts`, where bare `setup` is a usage error today. First edit: one question per open choice from `buildPlan`, asked through `node:readline` only when stdin and stdout are TTYs; `--yes` takes the plan's defaults; neither prints the plan and questions and writes nothing. Apply through `apply.ts` (gates before the block). Then `squeal warmup` (new `src/cli/warmup.ts`): `squeal start`, then `run --all --wait`, the file count first, progress as it goes, 0/1/3 told apart, then suggestions it does not apply: fast files over 30 s, and 001-307's ignored paths when the daemon reports them (absent today: say nothing). Setup's warm-up step calls the same code. Fill `plan.codexTrust` through a read-only export from `src/cli/codex/trust.ts`; the trust step reuses `init --harness codex --trust`.

**Owns:** `src/cli/setup/`, `src/cli/warmup.ts`, `src/cli/codex/trust.ts` (the export), the `warmup` and `setup` lines in `main.ts`, their tests.

**Done when:** tests for questions on a fake TTY, `--yes`, no TTY without `--yes` writing nothing, an outdated repository offered its upgrade, and `squeal warmup` on a fixture leaving every test file current with exit 0, 1 and 3 each a test; lint, typecheck, suite green.

## 005-14b install, the launcher, `squeal update`

Use /worker. Shape: slice.

**Outcome:** `curl -fsSL <tag URL>/install.sh | sh` installs the plugin in each harness found and puts a `squeal` launcher on the PATH; `squeal update` brings the harnesses to one version.

**Read:** spec D3 (`install.sh`, the launcher, `squeal update`, open question 11: the hub stays private); `research/wave-0-checks.md` 4 and 5 and its recommendation; `research/cli-distribution.md`.

**Seam:** new `install.sh` at the root: POSIX `sh`, `set -eu`, every step in `main`, `main "$@"` last, never reads stdin, prints each command; `SQUEAL_MARKETPLACE` overrides the hub (tests use a `file://` hub); a failed `marketplace add` says the hub is private and access is needed. Then the launcher in both plugins' `bin/`: the first applicable `installed_plugins.json` entry, the Codex cache, the newer version when they differ with one line naming both and `squeal update`, the install command and exit 1 when none is found. Then `src/cli/update.ts`.

**Owns:** `install.sh`, `plugins/*/bin/` (keep Claude Code's `bin/squeal`), `src/cli/update.ts`, the `update` lines in `main.ts`, the READMEs (root and both plugins: install first, plugin-first second), tests. Ask before touching `src/harness/build.ts` if the Codex plugin must ship `bin/`.

**Done when:** `install.sh` run twice in a scratch home with stub harnesses is idempotent, a cut download runs nothing, `--uninstall` undoes it; launcher tests for user and project entries in both orders, two harness versions, none installed; `squeal update` tests; lint, typecheck, suite green.

## 005-20 the opt-in one-time deny of a test command Squeal has answered

Use /worker. Shape: slice. Runs beside 005-14a and 005-14b.

**Outcome:** with `testCommand.denyWhenCurrent: true`, an agent's first test command whose every file has a current result is denied once with D8's reason; anything else, and every later command, runs.

**Read:** spec D8; `status.md` 2026-10-13, the 001 coordinator's fit notes (open question 9), which are binding; 001 D9 and 002 D2 on `PreToolUse`.

**Seam:** a sibling export beside `denyOnRegression` in `src/harness/shared/deny.ts`, called from both plugins' `PreToolUse` entries after the regression deny, one reason per call. First edit: the command recognizer as a pure module (`src/harness/shared/test-command.ts`) with a table test of D8 step 1's forms and fall-throughs. Then resolution against Squeal's listing, the currentness decision in one store read at the live revision (as `stop-slow.ts` does), the per-consumer "denied once" meta row (registered in `WORKTREE_META_ROWS`), the reason text.

**Owns:** `deny.ts`, the new module, the `Bash` command in both entries' input parsers, `src/harness/codex/handlers.ts` and the Claude Code `PreToolUse` entry only where they call the deny, the `testCommand` key in `src/core/daemon/policy.ts` and its loader, `WORKTREE_META_ROWS`, the "never denied" sentences in 001 D9 and 002 D2 (amended behind the flag), tests.

**Leave alone:** `deliver.ts`, `uncovered-edit.ts` (001-292), `stop*.ts` (001-297), `src/cli/`, `hooks.json`'s `sh` fast path, bundles, version, `docs/board.md`.

**Done when:** each recognized form and fall-through a test; resolution matches Vitest's own listing on a fixture; deny only when every file is current, never when one is pending, stale, unknown, unlisted or the daemon is not validating; a second command in the same consumer runs; off by default and the flag is read before the store opens (the hook p95 test still passes); both harnesses; lint, typecheck, suite green.
