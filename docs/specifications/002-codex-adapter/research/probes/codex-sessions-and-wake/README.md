# Probes: codex-sessions-and-wake (throwaway)

Throwaway probes for `../../codex-sessions-and-wake.md`. Not product code; nothing here is built, tested or shipped. Delete freely.

Run on 2026-10-07 with Codex CLI 0.160.1 (`codex-cli 0.160.1`), Node 24.21.0, Linux. Every probe ran against scratch repositories under `/tmp/csw/`, never against this repository or its Squeal store.

## Files

- `bin/mkrepo.sh <name> [primer]`: scratch repo `/tmp/csw/<name>` whose untracked `.codex/hooks.json` sends every hook event to `hooks/log-event.mjs`, which appends the stdin payload and the non-credential `CODEX_*`/`PLUGIN_*` environment names to `/tmp/csw/logs/<name>.jsonl`. With a primer file, SessionStart returns it as `additionalContext`.
- `bin/codexp.sh <repo> <args>`: runs `codex` with Cezar's credential variables unset, `-c projects."<repo>".trust_level="trusted"`, the user's three marketplace plugins disabled by `-c`, and `--dangerously-bypass-hook-trust`.
- `bin/appserver-probe.mjs <repo> <log>`: drives `codex app-server` over stdio as Cezar does (`initialize` with `experimentalApi`, `thread/start`, `turn/start`), then tries `thread/inject_items` while idle, an async hook finishing while idle, `codex queue` from another process, and `turn/steer` mid-turn.
- `bin/mkprimer.sh <name> none|sessionstart|agents`, `primer.txt`, `fakebin/squeal`: the primer probe. A buggy `add.js` with a `node:test` file; the primer in SessionStart context, in `AGENTS.md`, or absent; a fake `squeal status` that logs its calls.
- `plugin-fixture/`: a repo marketplace (`.agents/plugins/marketplace.json`), a plugin with `.codex-plugin/plugin.json`, `hooks/hooks.json`, `skills/`, `bin/`, and a repo `.codex/config.toml` enabling it.
- `bin/fake-daemon.sh`, `hooks/spawn-daemon.mjs`, `hooks/async-late.sh`: a heartbeat process standing in for a daemon (exits after 120 s), a SessionStart hook spawning it detached, and an async PostToolUse hook answering 8 s late.
- `evidence/`: curated excerpts of the logs (hook payload summaries per run, the app-server timeline and messages, shell environment output, primer-run commands, daemon heartbeats).

## Runs

| Run | What | Evidence |
|---|---|---|
| r1 | `codex exec`, one shell call; then `exec resume` and `exec fork` of the same thread | `hooks-r1.jsonl`, `shell-env.txt` |
| r2 | `codex exec` with one subagent running a shell call | `hooks-r2.jsonl`, `shell-env.txt` |
| r3 | app-server with `-c` trust only: hooks skipped (project not trusted) | not kept |
| r4 | app-server with `thread/start` `config: { bypass_hook_trust, projects }` | `hooks-r4.jsonl`, `appserver-r4-*.jsonl` |
| r5 | interactive TUI in tmux: `codex queue` while idle, Escape mid-tool, `/quit`; then a second TUI killed with `tmux kill-session` | `hooks-r5.jsonl` holds only the killed session; the first session's events are quoted in the findings |
| r6 | `codex exec` with `codex queue` sent during its turn | `hooks-r6.jsonl` |
| p-* | primer: none, SessionStart, AGENTS.md | `primer-*-commands.jsonl`, `fake-squeal.log` |
| pl1 | repo-marketplace plugin, enabled in repo config only; then installed with `codex plugin` | quoted in the findings |
| wt1 | `codex exec --worktree` | quoted in the findings |
| dm-* | detached daemon from a SessionStart hook and from the shell tool, `danger-full-access` and `workspace-write` | `daemon-*.head-tail.log`, `shell-env.txt` |

## User-level side effects, and how they were undone

- The TUI probe (r5) asked to trust `/tmp/csw/r5` and saves that choice to `~/.codex/config.toml`. Before accepting, `~/.codex/config.toml` was copied to `/tmp/csw/config.toml.backup-before-r5`; after the probe, `diff` showed only the added `[projects."/tmp/csw/r5"]` block and a model-notice counter, and the backup was copied back (sha256 prefix `0ac6c354b2baa8e8` before and after).
- The plugin probe ran `codex plugin marketplace add /tmp/csw/pl1` and `codex plugin add squeal-probe@squeal-probe-local`, which wrote `[marketplaces.squeal-probe-local]` and `[plugins."squeal-probe@squeal-probe-local"]` to `~/.codex/config.toml` and copied the plugin to `~/.codex/plugins/cache/squeal-probe-local/`. The config was backed up first; `codex plugin remove` and `codex plugin marketplace remove` undid both entries (`diff` against the backup empty), and the empty cache directory was removed by hand.
- Unplanned: every `codex exec` and app-server `thread/start` with a writable sandbox persisted `[projects."/tmp/csw/<name>"] trust_level = "trusted"` into `~/.codex/config.toml` on its own (see the findings, question 4). `/tmp/csw/untrust.py` removed exactly those blocks after the probes, each time after copying the file aside; other entries were untouched.
- `codex exec --worktree` created `~/.codex/worktrees/6e84/wt1`; it was removed with `git worktree remove` and the empty directories deleted.
- No daemon was left running: the fake daemons were killed (`pgrep -af fake-daemon` empty) and no shared Codex app-server daemon was started (`~/.codex/app-server-control/` holds only its lock file, as before). `~/.codex/auth.json` was never read.
