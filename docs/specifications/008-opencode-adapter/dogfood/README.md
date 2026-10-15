# 008-20 dogfooding: scripts and condensed logs

What `../lessons.md` was observed with. Everything ran as `squeal-e2e` under `/home/squeal-e2e/dogfood-008`, never as the agent user and never in its `~/.config/opencode`, `~/.local/share/opencode` or `~/.cache/opencode`; no `claude`, `codex` or `pi` was on any session's `PATH`, and no Claude model ran in OpenCode (the human's rule, 2026-10-14).

## Rules followed

- The cliproxy key goes by name only: `sudo -n --preserve-env=CLIPROXY_API_KEY -u squeal-e2e … proxy.sh`. Only the proxy process holds it; OpenCode's provider has a placeholder key and points at the proxy, and `as-user.sh` drops every inherited variable, so OpenCode and the agent's `bash` never see it. This is stricter than the brief's `apiKey: "{env:CLIPROXY_API_KEY}"`, which would put the key in OpenCode's environment and so in every shell the agent runs. The proxy logs request bodies, never headers.
- A session starts only when `gate.sh` passes: load below 24 (the CPU count) and no `squeal-e2e` process outside `dogfood-008`.
- `src/` was not changed; defects are in `../lessons.md`.

## Layout under `/home/squeal-e2e/dogfood-008`

| Path | What |
| --- | --- |
| `home/` | `HOME`; `install.sh` put the launcher in `home/.local/bin/squeal` |
| `xdg/{config,data,cache,state}` | the four `XDG_*` directories: OpenCode's global config (`xdg/config/opencode/opencode.json`), its database and logs, Squeal's packages (`xdg/data/squeal/opencode/<version>`, `current`) and install record |
| `tmp/` | `TMPDIR`, and the TUI's tmux socket |
| `bin/opencode` | a link to OpenCode 1.18.35 in squeal-e2e's npm prefix, the only harness on the `PATH` |
| `src/` | the release archives and `install.sh` copies (`make-archives.sh`) |
| `remeda/` | the project, `github.com/remeda/remeda` at `8e6e78f6` |
| `cezar-source/` | Cezar 0.16.0-dev.1634, copied unchanged (`copy-cezar.sh`) |
| `logs/` | raw proxy logs (`<session>.requests.jsonl`), Cezar events, transcripts |
| `scripts/` | this directory (`sync.sh`) |

## Files

| File | What |
| --- | --- |
| `as-user.sh` | Runs a command as the dogfood user: clean environment, `HOME`, `TMPDIR` and `XDG_*` inside `dogfood-008`, a `PATH` whose only harness is `opencode`, `OPENCODE_DISABLE_AUTOUPDATE=1`, `OPENCODE_DISABLE_MODELS_FETCH=1`. `-C <dir>` sets the cwd. |
| `setup.sh`, `opencode.json` | The sandbox, OpenCode's global config (provider `cliproxy` at the proxy, `@ai-sdk/openai-compatible`, the three models), the remeda clone and `npm ci`. |
| `make-archives.sh` | The release archives `install.sh` reads through `SQUEAL_SOURCE`: 0.1.184 (`git archive` of `4c6d1176`) and 0.1.190 (the same tree relabelled: a later version with no code change). |
| `copy-cezar.sh` | Copies the installed Cezar into `cezar-source/`. |
| `proxy.mjs`, `proxy.sh`, `proxy-start.sh`, `proxy-stop.sh` | The model endpoint on 127.0.0.1:47320: forwards to cliproxy adding the key, appends each request body and the streamed answer to `logs/<session>.requests.jsonl`. |
| `cezar-drive.mjs`, `serve.sh`, `scenarios/*.json` | The Cezar-shaped `opencode serve` session: Cezar's `OpencodeServerRunner` in persistent mode, prompts sent `gapMs` after each turn-end, then held open until quiet for `idleMs`, so a wake shows as events after the last turn-end. |
| `run.sh` | One `opencode run --format json` in the clone, with its wall time and the load before and after. |
| `tui.sh` | One OpenCode TUI in a tmux server private to the dogfood user: start, send, keys, screen capture. |
| `gate.sh` | Waits for load below 24 and no other `squeal-e2e` process. |
| `tree.sh` | Lists `home/` and `xdg/` (without package bodies) and prints OpenCode's global config, before and after the install and the update (goal 8). |
| `condense.py`, `stats.py`, `events.py`, `collect.sh` | Turn a proxy log into a timeline (new messages per model request, Squeal texts and their role, tool calls, whether a system message carries the primer and which CLI it names), count per session, condense Cezar's event log (with time and load), and copy the condensed record into `logs/`. |
| `sync.sh` | Copies these scripts into `dogfood-008/scripts`. |

## Logs

`logs/<session>.timeline.md` per session (from the proxy, so it is what reached the model), `logs/<session>.cezar-events.txt` for the `serve` sessions (Cezar's events with time and load), `logs/<session>.run.txt` for `opencode run` (wall time and load), `s3b-run-luna.run.err` (OpenCode's log for defect 1), `logs/stats.txt`, the install, setup, warm-up and update transcripts, `s5-tui.screens.txt` (TUI captures with time and load), `s5-ps-*.txt` (processes around the update and the restart) and `tree-*.txt` (goal 8). Raw request logs and OpenCode's database stay in `dogfood-008`.

## Repeat

From this directory, as the agent user: `sh sync.sh`, `sudo -n -u squeal-e2e -H sh /home/squeal-e2e/dogfood-008/scripts/setup.sh`, `sh copy-cezar.sh`, `sh make-archives.sh`, then the install (`lessons.md`, Setup). Per session: `sh gate.sh`, `sh proxy-start.sh <session>`, the session (`sh serve.sh <session> <scenario>`, `sh run.sh …`, or `tui.sh` through `as-user.sh`), `sh proxy-stop.sh`, `sh collect.sh`.
