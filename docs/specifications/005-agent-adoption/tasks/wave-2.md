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

## 005-16 review of wave 2 (005-14 and 005-20)

Use /reviewer. Range: the 005-14a, 005-14b and 005-20 commits and the 0.1.135 build on main. Ignore 001 and 006 commits. Read D3, D4, D5 and D8 with their amendments, `status.md` (the 001 coordinator's D8 fit notes, open question 11), and the briefs above.

**Look hardest at:**
- D8's honesty: can the deny fire when any file the command runs is pending, stale, unknown, unlisted, outside Squeal's runners, at an older revision, or when the daemon is not validating? Can it fire twice for one consumer, or for a command it did not fully resolve (a filter, a script, a `node --test` form)? Does its reason claim anything it did not check? Does the flag stay off by default at no latency cost?
- `install.sh` under `curl | sh`: a cut download, a 404, stdin, idempotence, `--uninstall` removing only what it installed, and never writing under `~/.claude` or `~/.codex` itself.
- The launcher: the entry it picks matches the order Claude Code loads (005-04 question 5); two harness versions; none installed.
- `squeal setup`: with no terminal and no `--yes` it writes nothing; `--yes` applies only the plan's defaults; gates before the block; it never commits.
- `squeal warmup`: 0/1/3 told apart; it never claims a pass it did not see.

**Rules:** probe with stub harness CLIs in scratch homes only. Never run the real `claude` or `codex`, and run no model session (006 holds the eval slot). Output `reviews/wave-2.md`, committed on your branch; change no source.

# Wave 2.5: repairs from `reviews/wave-2.md` (FAIL at `2b0c5532`)

Three workers on disjoint files, then one narrow re-review. Code only: run no model session and no real `claude` or `codex` (006 holds the eval slot). Scratch homes, stub harness CLIs, `file://` hubs. Leave bundles, `package.json`'s version and `docs/board.md` to the coordinator.

## 005-26 repair: D8 answers only for a command its listing covers completely (B1)

Use /worker. Shape: repair.

**Outcome:** a Vitest command whose files include any Squeal does not run (a `typescript` pool spec, today) is never denied and uses no once-only slot; a fully covered command still denies once.

**Read:** `reviews/wave-2.md` B1 (its probe is your first test) and the fix-inputs table; spec D8; `status.md` 2026-10-13, the 001 coordinator's D8 fit notes (binding).

**Seam:** `testSpecifications` in `src/runners/vitest/adapter.ts:466` drops `typescript` pool specs. Suggested first edit: have the listing record that it left files out (a count is enough), stored with the listing; `src/harness/shared/test-command-files.ts:29` then falls through when it is non-zero. The hook never starts Vitest, evaluates config or scans config text. If the record must live in a store row or a daemon or key-format-guarded file, send me a request naming it before you edit; I clear it with the 001 coordinator.

**Owns:** `src/harness/shared/test-command*.ts`, `deny.ts`, the adapter's listing, the record's row if cleared, tests.

**Leave alone:** `install.sh`, `src/cli/`, `deliver.ts`, `stop*.ts`, bundles.

**Done when:** B1's mixed ordinary/typecheck fixture falls through in both harnesses with the once slot unused; a covered suite denies once; the off flag still returns before store work (the hook p95 test passes); lint, typecheck, suite green.

## 005-27 repair: a cut installer runs nothing, and uninstall removes only what it installed (B2, B3)

Use /worker. Shape: repair.

**Outcome:** no byte prefix of `install.sh` changes anything, and `--uninstall` removes only plugins and the launcher this script created.

**Read:** `reviews/wave-2.md` B2 and B3 (their probes are your first tests); spec D3 on `install.sh`.

**Seam:** `install.sh:162`. Suggested first edit: the last line passes a completion token, for example `main squeal-install-complete "$@"`, and `main` exits without a side effect when the token is missing. Then an ownership record outside `~/.claude` and `~/.codex` (under the launcher's directory or `${XDG_STATE_HOME:-~/.local/state}/squeal/`), written after each resource this run creates and kept across repeated installs and a harness that fails; uninstall acts only on recorded entries and says why it keeps the rest.

**Owns:** `install.sh`, `test/cli/install-sh.test.ts`, `test/cli/install-fixture.ts`, the READMEs' uninstall lines. Keep POSIX `sh`, `set -eu`, no stdin reads, printed commands, harness writes through their own CLIs.

**Done when:** every proper byte prefix of the final line is inert (exactly `main`, `main `, `main "$@"` included), for install and uninstall; a pre-existing Claude plugin, Codex plugin, mixed machine and launcher each survive uninstall; repeated install and a failed harness keep ownership; the installer tests fit their timeout under full-suite load (`install-sh.test.ts:45` timed out at 5 s in the review's full run: size a test-only bound to the measured work, or do less work per test); lint, typecheck, suite green.

## 005-28 repair: setup shows and lists a new instruction file (S1)

Use /worker. Shape: repair. One worker with 005-29.

**Outcome:** a block written to a new `AGENTS.md` or `CLAUDE.md` appears in setup's diff and in its commit list, once.

**Read:** `reviews/wave-2.md` S1; spec D3 step 5.

**Seam:** `src/cli/setup/flow.ts:126-127`. Show a new file's addition read-only (`git diff --no-index /dev/null <file>`), never by staging; name each new managed file once, a symlinked alias once.

**Done when:** a fresh repository, separate `CLAUDE.md` and `AGENTS.md`, and a symlinked pair each show and list every new file once.

## 005-29 the warm-up reports 001-307's ignored reads

Use /worker. Shape: finish. Same worker as 005-28.

**Outcome:** `squeal warmup` and setup's warm-up ask their checkpoint to observe ignored reads and print each slow file's ignored paths as unkeyed suggestions for `inputs`, never declaring them.

**Read:** spec D3 (the warm-up); `status.md` 2026-10-13 on 001-307; `src/core/scheduler/ignored-reads.ts` (`readIgnoredReads`, re-exported from `src/core/status/`); `src/core/daemon/protocol.ts:33`.

**Seam:** `runAllArgs` and `ignoredPathSuggestions` in `src/cli/warmup.ts:118-128`. `squeal run` has no flag for `observeIgnored`; the warm-up sends its own `run-all` request, or `run.ts` takes an internal option. Do not add a user-facing `run` flag.

**Owns:** `src/cli/warmup.ts`, `src/cli/setup/flow.ts`, the `run.ts` lines this needs, tests. **Leave alone:** `src/core/`, `install.sh`, `src/harness/`.

**Done when:** a fixture whose slow file reads a gitignored path names it after `squeal warmup`, labelled unkeyed and capped as stored; a plain `squeal run --all --wait` stores nothing; no config written; lint, typecheck, suite green.

## 005-30 re-review of wave 2.5

Use /reviewer. Range: the 005-26 to 005-29 commits and their build on main. Limited to B1, B2, B3, S1, their nearest variants, and 005-29's ignored-reads output. Rerun the review's three probes against the candidate, then one independent `npx vitest run`. The same rules as 005-16; output `reviews/wave-2.5.md`.
