# Probes: instruction-surfaces (throwaway)

Throwaway probes for `../../instruction-surfaces.md`, board row 005-02. Not product code. Nothing here is imported, built or tested by Squeal; delete freely.

Run on 2026-10-09 against Claude Code 2.1.295 (`claude-sonnet-5-5`) and Codex CLI 0.160.1 (its configured default, `gpt-6.1-sol`, through the host's provider), Node 24.21.0, Linux 6.8. Squeal plugins 0.1.67 from a `git archive` of commit `9848df0` (`/tmp/r52/pin`), never the installed copy.

## Rules followed

- Everything ran under `/tmp/r52`: the pinned plugins, a Vitest 5.0.3 install copied into each fixture, one fixture per session under `runs/`, logs under `logs/`. No store of this repository and no other worktree was touched; every daemon these probes started was stopped by `bin/finish.sh`.
- Claude Code sessions follow 001 `lessons.md` "Setup": `CLAUDE*` and `CEZ_*` variables removed (`bin/env.sh`), `DISABLE_AUTOUPDATER=1`, `--setting-sources project --strict-mcp-config`, the plugin loaded with `--plugin-dir` from the pin, `--permission-mode acceptEdits` and 001's allow-list (agents may run Vitest themselves). Real `HOME`, so transcripts land under `~/.claude/projects/-tmp-r52-runs-<label>/`.
- Codex sessions ran with `CODEX_HOME=/tmp/r52/codex` and `HOME=/tmp/r52/home` (`bin/codex-home.sh`): the host's provider block only, its key from an environment variable, so no credential was copied. The pinned plugin was installed with `codex plugin marketplace add` and `codex plugin add squeal@hearsay` (the pin's `.agents/plugins/marketplace.json` renamed to `hearsay`, the hub's name, so the trust command finds it) and its nine hooks trusted with `squeal init --harness codex --trust --yes`. `~/.codex` was not written. `squeal` is not on the Codex agent's PATH, as for a real user (002 D1).
- Every session got the same prompt per condition (`prompts/task.txt` for conditions; `prompts/canary-*.txt` for question 1).

## Files

- `fixture/`: the subject project, shaped like 001's: `money`, `invoice`, `format`, four test files with 10 tests, one of them a 2.5 s stand-in for an integration test. `BASE.md` is the instruction file's neutral first paragraph in every condition.
- `conditions/<cond>.md`: the block appended to the instruction file (`CLAUDE.md` for Claude Code, `AGENTS.md` for Codex). `a` has none. `b1`, `b2`, `b3`: three wordings of the human's proposal. `c`: the gate this repository's `CLAUDE.md` has. `d`: that gate reworded so Squeal can satisfy it. `canary-*`: one unique word each for question 1.
- `bin/mkfix.sh <label> <cond> <claude|codex> [noplugin]`: a fresh committed fixture; with the plugin, the daemon is started and a full-suite checkpoint completed first (`squeal run --all --wait`), so it is warm.
- `bin/run-claude.sh`, `bin/run-codex.sh`: one subject session, every JSON line timestamped by `bin/ts.mjs`.
- `bin/finish.sh`: the ground truth after a session (`npx vitest run` in the fixture, never seen by the agent), the diff, and the daemon stopped.
- `bin/batch.sh <plan>`: runs a plan file (`plan-*.txt`) line by line.
- `bin/measure.mjs <label>... [--final] [--json]`: the per-session row of question 2: test commands with scope and wall time, Squeal pulls and waits, skill reads, SQUEAL texts the model received (Claude Code hook outputs; Codex developer messages in the rollout), wall time, cost or tokens, the ground truth, and the final message for judging the claim.
- `logs/`: trimmed evidence per session (see its README).
