# 005-84 (gh-85): the version-mismatch notice prints once per version pair per session

Worker 0ad34ff8, wave 11 W2, baseline c652d5a4a, 2026-10-26.

## Cause

`plugins/claude-code/bin/squeal-launcher` wrote its notices to stderr at every call, with no memory of what it had already said (`research/issue-85.md`). A Codex session after an update got two lines that both said "running": the harness-skew line and the kept-copy line. Two reporters on 2026-10-24 spent one more status call each to learn which version a command described.

## The row's first question: which session id a Codex launcher call reads

`CODEX_SESSION_ID`. Answered to the coordinator as request 2f571ecf, accepted 2026-10-26.

- Codex sets it only in its shell tool's environment: `inject_session_env` puts `CODEX_SESSION_ID` and `CODEX_VERSION` there (openai/codex `codex-rs/core/src/exec_env.rs:40-50`; the names are in `codex-rs/protocol/src/shell_environment.rs:6-8`). *Read in source code*, upstream main, 2026-10-26.
- The installed Codex 0.160.1 binary holds both `CODEX_SESSION_ID` and `CODEX_THREAD_ID` (`grep -a`, not run). *Read in the binary.*
- A hook process gets no `CODEX_*` id. Codex gives hooks `PLUGIN_ROOT`, `PLUGIN_DATA` and their `CLAUDE_*` aliases (`codex-rs/hooks/src/engine/discovery.rs:311-319`), and the id only on stdin. Squeal's Codex hooks run `dist/*.mjs` directly, never the launcher. *Read in source code*; matches `002-codex-adapter/research/codex-hooks.md` (verified by experiment).
- The shell's `CODEX_SESSION_ID` equals the hooks' `session_id`. A subagent's shell has the parent's `CODEX_SESSION_ID` and its own `CODEX_THREAD_ID`; resume keeps the id, fork makes a new one (`002-codex-adapter/research/codex-sessions-and-wake.md` 3, verified by experiment, 2026-10-07).

So the launcher reads the first non-empty of `CLAUDE_CODE_SESSION_ID`, `CODEX_SESSION_ID`, `OPENCODE_SESSION_ID` and `PI_SESSION_ID`, the order `squeal retry` uses. It reads `CODEX_SESSION_ID`, not `CODEX_THREAD_ID`, so a session and its subagents see the notice once.

## What changed

- One line, printed when the harnesses differ, or when the newest kept copy is older than the version that runs:
  `squeal: this command runs squeal 0.1.288; plugins: Claude Code 0.1.288 and Codex 0.1.287; Codex sessions started on 0.1.287 keep 0.1.287 until they restart. Run squeal update to bring the plugins to one version.`
  The kept clause appears only when a kept copy is older. The `squeal update` sentence appears only when the plugins differ.
- Once per scope. The scope is the session id, or `""` (the machine) outside a session. The mark `launcher-notices.json` holds `[scope, last line printed]` pairs, the newest 64. The launcher prints when the scope's last line differs, then writes the mark through a temporary file and a rename.
- Where the mark lives: in the plugin data directory the launcher runs from (`<PLUGIN_DATA>/bin/squeal`, the path in gh-85's reports). Otherwise, as `~/.local/bin/squeal`, in `${XDG_STATE_HOME:-~/.local/state}/squeal/`, where `install.sh` keeps its record. The Claude Code plugin has no data directory, and the launcher creates nothing under `~/.codex` or `~/.claude`. Prune lists only `versions/` (`src/harness/shared/version-copies.ts:200`), so the mark does not disturb it.
- A mark that cannot be written, or a state directory that is not absolute, prints each time, as before. A mark that cannot be read is replaced.
- Format 7, so `squeal update` replaces installed launchers.

## Decisions the spec did not settle (all accepted by the coordinator, 2026-10-26)

1. Mark location, above.
2. The wording of the one line, above.
3. Format 6 to 7. The update tests (`test/cli/update.test.ts`, `update-pi.test.ts`, `update-opencode.test.ts`, `test/real-cli/update.real.ts`) move with it, in the launcher commit, as d533265f7 did.
4. The three copies under `plugins/{codex,pi,opencode}/bin/` are a plain `cp` of the source. There was no `npm run build`.
5. `test/harness/codex/version-copies.test.ts:112` (W1's file) gets its one expected string in a standalone commit.

## Edges left as they are

- Only the last line per scope is kept. So A, then B, then A again in one session prints A twice.
- A 65th scope pushes out the oldest. A pushed-out session that calls again sees the notice once more.
- Two calls at the same moment can both print, and one mark update can be lost. The notice is advisory only.
- Only a killed process leaves `.launcher-notices.<pid>.tmp`.
- In Claude Code's Bash tool, `squeal` is the plugin's own `bin/squeal`, which prints no notice. `CLAUDE_CODE_SESSION_ID` matters only when an agent there calls the launcher by its path.

## Evidence

- `test/cli/launcher.test.ts`, "the version notice": an unchanged pair prints once outside a session and once in each session. The test sets each of the four variables in turn, and a subagent's thread id does not print again. A changed pair prints again, in a session and outside one. The CLI's stdout and exit code are the same whether the line prints or not. An unwritable mark prints each time, and an unreadable mark is replaced. The terminal launcher's mark is in the state directory, and nothing appears under `~/.codex/plugins/data` or `~/.claude/plugins/data`.
- Under "the launcher in the plugin data directory": gh-85's second report as one line. It prints once per Codex session, and the mark is in the data directory.
- File sizes: the launcher is 143 lines. `test/cli/launcher.test.ts` is 439 lines; it was 330 before, which is already over the 300-line guide.

## Commits

- 21a44f746 fix(005-84): the launcher, its three copies, `launcher.test.ts` and the update tests.
- cc839b6a7 test(005-84): the one string in `version-copies.test.ts`, by agreement with the coordinator.

## For the coordinator

- The 005 D3 sentence ("prints one line naming both versions and `squeal update`") is yours to amend at integration.
- `plugins/*/bin/squeal-launcher` match the source. CI's bundle diff should agree, because the build's copy step writes the same bytes and mode 0755.
