# Probes: opencode-sessions-and-wake (throwaway)

Throwaway evidence for `../../opencode-sessions-and-wake.md` (board row 008-02). Not product code; nothing here is imported or built. Run on 2026-10-14 against OpenCode 1.18.35 (Bun 1.3.14 inside it), model `cliproxy/gpt-6-luna`.

## Isolation

- Every OpenCode run was made as the throwaway OS user `squeal-e2e`, never as `agent`. `bin/e2e.sh` is the only script run as `agent`: it strips its own environment to `PATH` and `CLIPROXY_API_KEY`, pipes `plugin/`, `bin/` and `cfgdir/` through `tar` to `/home/squeal-e2e/008-sessions/probe`, and runs one script there with `sudo -n --preserve-env=CLIPROXY_API_KEY -u squeal-e2e -H env HOME=/home/squeal-e2e PATH=…` from cwd `/`. The key passes by name only. `bin/check-env.sh` printed the variable names that arrive, never the values.
- OpenCode 1.18.35 was already installed in `/home/squeal-e2e/.npm-global` by the sibling row 008-01. It was reused, not reinstalled.
- `bin/env.sh` gives the probe its own `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME` and `XDG_STATE_HOME` under `/home/squeal-e2e/008-sessions/xdg`, so the sibling's OpenCode database and plugin cache are not shared. These dirs are not the isolation; the OS user is.
- The serve probe used port 4298; the sibling owns 4198. The TUI probe used a private tmux socket (`-L oc008s`) and killed only that server. No probe process was left running; the background `sleep`s and heartbeat children were killed by pid.
- `bin/fetch-logs.sh` copies the logs out to `logs/raw/` and fails if the key's value appears in any of them.

## Fixture

`bin/setup.sh` makes `/home/squeal-e2e/008-sessions/repo`, a git repository with:
- a project `opencode.json` that declares the `cliproxy` provider (`@ai-sdk/openai`, `apiKey: "{env:CLIPROXY_API_KEY}"`) and allows edit and bash;
- `.opencode/plugin/probe.js`, a copy of `plugin/probe.js`;
- a linked worktree at `/home/squeal-e2e/008-sessions/wt`.

`plugin/probe.js` logs every hook and bus event (except text deltas) to `events.jsonl`. Its `shell.env` hook adds `PROBE_SESSION_ID` and `PROBE_CALL_ID`. Two switches:
- `PROBE_WAKE`: calls `client.session.promptAsync` on the first idle of a root session, either at once or after a delay.
- `PROBE_SPAWN=1`: spawns one `detached: true` child and one attached child at init.

`cfgdir/` is used as `OPENCODE_CONFIG_DIR`. Its `plugin/cfg.js` adds a skill path and an instruction file through the `config` hook, and prepends `cfgdir/assets/bin` to the shell's `PATH` through `shell.env`. `cfgdir/pkg` is a minimal npm-style plugin package.

## Runs

| Label | Script | What |
|---|---|---|
| attempt 1 | `run.sh` | `opencode run` hung after plugin init: it read piped stdin, which never closed. `</dev/null` fixed it. A SIGTERM ended the run, and both plugin-spawned children survived (`logs/raw/attempt1.jsonl`). |
| r1 | `run.sh r1 repo immediate 1` | `opencode run`, a bash call and a `task` subagent's bash call. The plugin calls `promptAsync` at the first root idle. The shell env files are `r1-main.env` and `r1-child.env`. Both children outlived the run's normal exit. |
| r2 | `run.sh r2 repo none 0 … --continue` | Resume the last session: same id? Is r1's stranded wake message in the history? |
| r3 | `run.sh r3 repo none 0 … --session <r1> --fork` | Fork: new id? |
| s1 | `serve.sh s1` | `opencode serve` on 4298 driven like Cezar, in this order: `POST /session`, `prompt_async`, a plugin wake 3 s after idle, an outside `curl` wake, `/tui/append-prompt` and `/tui/submit-prompt` with no TUI attached, `DELETE` on a second session, then SIGTERM. Transcript in `s1.messages.json`. |
| r4 | `run-wt-cfg.sh r4 wt …` | Run from `wt/sub` (linked worktree), with `OPENCODE_CONFIG_DIR=cfgdir`: plugin `directory`/`worktree`, skill and instruction from the `config` hook, a command on `PATH` from `shell.env`. |
| t1 | `tui.sh t1` | Interactive TUI in tmux: one typed prompt, then the plugin's `promptAsync` 3 s after idle. Pane in `t1.pane.txt`. |
| r5 | `run.sh r5 …` then `bg-check.sh` | The agent's shell starts `nohup sleep 301 &` and `setsid sleep 302 &`: alive after the run exits? |
| p1 | `plug.sh` | `opencode plugin file:<cfgdir/pkg> -g`: what it writes, and whether the package loads on the next run. |

`bin/summ.mjs logs/raw/events.jsonl <label>` prints one line per record with milliseconds from the label's first record.

## Leftovers

`/home/squeal-e2e/008-sessions` (scratch repository, the probe's XDG dirs, logs) is left for reproduction. Remove it with `sudo -n -u squeal-e2e rm -rf /home/squeal-e2e/008-sessions`.
