# 002 wave 0 briefs

Both rows run in parallel with 003 wave 0. Workers read `docs/vision.md`, `docs/styleguide.md`, `docs/specifications/002-codex-adapter/spec.md` and `status.md` first.

## 002-10 shared hook code

Outcome: the harness-neutral hook logic lives in `src/harness/shared/` and the Claude Code adapter imports it, with no behaviour change.

Read: spec 002 D5; spec 001 D9; `src/harness/claude-code/` as it is.

Shape: slice.

Seam: `src/harness/claude-code/hooks/post-tool-batch.ts`. First edit: extract its deliver step (register-if-needed, `onToolBoundary`, header and report formatting) into `src/harness/shared/deliver.ts` and import it back, then continue with session-start, pre-tool-use, stop, user-prompt-submit, sweep and ensure. The rule for what moves: anything that reads the store, the delivery interface, the daemon-ensuring helper or the turn state moves; anything that reads Claude Code's stdin field names, writes its output shapes, or reads `CLAUDE_*` stays. Keep `entries/` and `build.ts` where they are.

Owns: `src/harness/shared/**`, `src/harness/claude-code/**`, `test/harness/**`. Leave alone: `src/core/**`, `src/cli/**`, `plugins/**` (bundles are rebuilt at integration), `test/e2e/**`, everything 003 owns.

Done when: `npx vitest run test/harness` is green with no fixture or expectation change; the full suite, lint and typecheck are green; `git diff -M --stat` shows moves, not rewrites; nothing new is exported from `src/core`. Report every module that moved and any export added to `src/harness/shared/index.ts`.

Use /worker.

## 002-11 wave-0 checks

Outcome: spec 002 open questions 1 to 3 answered by experiment on Codex CLI 0.160.1, so wave 1 can be briefed.

Read: spec 002 D1, D4 and Open questions 1 to 3; `research/codex-hooks.md` findings 1 and 6; `research/codex-sessions-and-wake.md` finding 4; the rules in `research/README.md`.

Shape: research.

Questions: (1) does Codex load a plugin from this repository's `.claude-plugin/marketplace.json` when a second entry at `./plugins/codex` is added, or does it need `.agents/plugins/marketplace.json`, and what does `codex plugin add` do with a marketplace that has two entries; (2) is a hook's working directory the thread's `cwd` under `codex exec`, under app-server with a `thread/start` `cwd`, and in the TUI, and does `CLAUDE_PROJECT_DIR` or any `cwd` variable reach the hook's environment; (3) how `trusted_hash` is computed (read `hooks/src/` at the 0.160.1 tag), whether a value computed outside Codex matches `hooks/list`'s `currentHash`, and whether plugin trust survives a plugin version change.

Probes under `research/probes/wave-0-checks/`, throwaway, scratch repositories under `/tmp` only, never this repository's store, no daemon left running, no read or copy of `~/.codex/auth.json`, `~/.codex/config.toml` never edited (use a scratch `CODEX_HOME` as the codex-hooks probes did).

Owns: `docs/specifications/002-codex-adapter/research/**`. Nothing else.

Done when: `research/wave-0-checks.md` has a questions-answered table, findings tagged with the version, a recommendation naming the marketplace file, the fast-path shape and the trust automation that is possible, and sources.

Use /researcher.
