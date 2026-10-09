# Probes: 004-17 dogfooding with slow files declared (throwaway)

Throwaway scripts and trimmed logs for the section "Dogfooding on this repository and on cezarion" in `../../../lessons.md`. Not product code. Nothing here is imported, built or tested by Squeal; delete freely.

Run on 2026-10-09, 06:10 to 07:40 UTC, with Node 24.21.0, Codex CLI 0.160.1 (`gpt-6.1-sol`) and the Squeal Codex plugin from the real `~/.codex`. The marketplace auto-updated that plugin during the run: 0.1.56, 0.1.57 from about 06:37, 0.1.58 from 06:52:02, 0.1.59 from 07:31:19. Every poll line names the daemon's pid and version. Times in the logs are UTC unless a line says otherwise. The slow-tier line's `HH:MM` is local time (UTC+2).

## Rules followed

- Every worktree was mine, detached, under `/tmp`, and is removed:
  - `/tmp/squeal-dogfood-004-6191defd` and `-b`: this repository, `git worktree add --detach ... origin/main` (`6b42c98`).
  - `/tmp/squeal-dogfood-cezarion-004-6191defd`, `-b` and `-c`: `git -C /home/agent/projects/cezar worktree add --detach ... HEAD` (`c07b0bfc`), removed with `git -C /home/agent/projects/cezar worktree remove --force`.
- Configs and builds stayed uncommitted in those worktrees. Nothing was edited, committed or stashed in `/home/agent/projects/cezar` or in this repository's main checkout. Cezar's `git status` read the same three untracked entries (`.claude/`, `.opencode/`, `squeal.config.json`) before and after.
- The shared stores were opened read only (`node:sqlite`, `readOnly: true`) and keep every row and run log these worktrees wrote (ids in `lessons.md`). Nothing there was deleted.
- `~/.codex/auth.json` and `~/.codex/config.toml` were never opened. No `--dangerously-bypass-hook-trust` was used. `~/.codex` was not written by these scripts; the plugin updates were the marketplace's. The Codex rollouts under `~/.codex/sessions/` were read.
- Daemons: I started the first daemon of each worktree (`ready.mjs`), cezarion's 0.1.58 daemon at 07:00:55 (`setsid`), and B's and C's. Hooks of my own sessions started the others. All were stopped with `squeal stop` or exited on their own before the worktrees were removed. Nothing I did not start was killed.
- Logs were grepped for key, token, bearer, secret and password patterns before commit, with no hit. The raw `codex exec --json` output is not kept.

## Files

- `ready.mjs <squeal.mjs> <root> [seconds]`: from 003-19. Spawns `squeal start`, then times the first `test_file_keys` row and `daemon-bootstrapped:<id>`, and samples the daemon's RSS.
- `poll-status.mjs <squeal.mjs | plugin cache dir> <root> <every s> <max s>`: one line per change (and each minute). Each line holds load per CPU, the daemon's pid and version, counts, `slowPending`, `slowTier` with the daemon's published activity, and the text status's slow-tier line. Given the cache dir, each poll uses the newest installed CLI.
- `store.mjs <store> <worktree-id> <slow-path regex> [t0] [--slow-only]`: meta rows, revisions, runs (slow ones marked), transitions and the slow files' known states of one worktree.
- `slow-runs.mjs <store> <worktree-id> <slow-path regex> <poll log>`: every slow file's run with the load per CPU and daemon version the poll saw nearest its start.
- `bin/session.sh <id> <worktree> <prompt> [session id]`: one `codex exec --json` session (used for sq1).
- `bin/tui.sh start|send|screen|quit`: an interactive Codex TUI session in a detached `tmux` (`--no-alt-screen --no-daemon -s danger-full-access -a never`). The session stays registered and idle between turns, which `codex exec` does not (defect 1).
- `timeline.mjs`, `gaps.mjs`, `cli.mjs`: from 003-19. A rollout's timeline, the delay of each Squeal message after the tool item or prompt before it, and every Squeal command the agent ran.
- `prompts/`: sq1 to sq4 for this repository (sq2 to sq4 are turns of one TUI session), cz1 to cz3 for cezarion (one TUI session).
- `logs/`:
  - setup: `setup-*.txt`, `init-cezarion.txt`, and the configs (`squeal.config.squeal.diff`, `squeal.config.cezarion.json`, `squeal.config.cezarion.lookup-only.json`).
  - daemons: `sq.ready.txt`, `cz.ready.txt` (the first cezarion start died), `czb`/`czc`/`sqb` ready and status files, `cz.start1-notes.txt`, `cz.daemon-foreground.txt`, `cz.daemon-detached.txt`.
  - polls: `sq.poll.txt`, `cz.poll.txt`.
  - store: `sq.store-after-sq1.txt`, `sq.store-after-sq2.txt`, `cz.store-after-run-slow.txt`, `sq.slow-runs.txt`, `cz.slow-runs.txt`, `cz.keys.txt`, `cz.slow-run-argv.txt`.
  - sessions: `*.timeline.txt`, `*.gaps.txt`, `*.squeal-commands.txt`, `*.times.txt` and `*.rollout-path.txt` per session; `sq2.tui.txt`, `cz1.tui.txt` (the TUI scrollback), `cz1.tui-events.txt` (the hook failures in order).
  - other: `slow-deliveries.txt` (every Squeal message that carried a slow result), `cz.run-slow.txt`, `sq.slow-priority.txt` (nice and ionice of the slow lane's worker), `cz.A-src.diff` (what B got).
