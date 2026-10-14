# 009-20 dogfooding: scripts and condensed logs

What `../lessons.md` was observed with. Everything ran as `squeal-e2e` under `/home/squeal-e2e/dogfood-009`, never as the agent user and never in its `~/.pi`; no `claude` or `codex` was on any session's `PATH`, and no Claude model ran in Pi (the human's rule, 2026-10-14).

## Rules followed

- The cliproxy key goes by name only: `sudo -n --preserve-env=CLIPROXY_API_KEY -u squeal-e2e … proxy.sh`. Only the proxy process holds it; Pi's `models.json` has a placeholder, and `as-user.sh` drops every inherited variable, so Pi and the agent's `bash` never see it. The proxy logs request bodies, never headers. `collect.sh` copies only condensed logs; the raw request logs and Pi's session files stay in `dogfood-009`.
- A session starts only when `gate.sh` passes: load below 24 (the CPU count) and no `squeal-e2e` process outside `dogfood-009` (another coordinator's evals).
- `src/` was not changed; defects are in `../lessons.md`.

## Files

| File | What |
| --- | --- |
| `as-user.sh` | Runs a command as the dogfood user: clean environment, `HOME`, `PI_CODING_AGENT_DIR` and `TMPDIR` inside `dogfood-009`, a `PATH` whose only harness is `pi`. `-C <dir>` sets the cwd. |
| `proxy.mjs`, `proxy.sh`, `proxy-start.sh`, `proxy-stop.sh` | The model endpoint: forwards to cliproxy adding the key, appends each request body and the streamed answer to `logs/<session>.requests.jsonl`. |
| `models.json` | Pi's provider `cliproxy` at the proxy, with the four models used. |
| `cezar-drive.mjs`, `scenarios/*.json` | The Cezar-shaped RPC session: the installed Cezar 0.16.0-dev.1634 `PiRunner` (copied unchanged into `dogfood-009/cezar-source`) in persistent mode, prompts sent after each `turn-end`, then held open for a wake. `rpc-astra.json` (s2), `rpc-grok.json` (s3), `rpc-sol.json` (s4). |
| `tui.sh` | One Pi TUI in a tmux server private to the dogfood user: start, send, keys, screen capture. s5 was driven by hand with it; `pair.sh` is s6. |
| `gate.sh` | Waits for load below 24 and no other `squeal-e2e` process. |
| `tree.sh` | Lists the agent dir and HOME (without the clone, npm cache and package bodies), before and after the install. |
| `condense.py`, `stats.py`, `collect.sh` | Turn a proxy log into a timeline (new messages per model request, SQUEAL texts, tool calls, whether the primer is in the system prompt), count per session, and copy the condensed record into `logs/`. |
| `sync.sh` | Copies these scripts into `dogfood-009/scripts`. |

## Logs

`logs/<session>.timeline.md` per session (from the proxy, so it is what reached the model), `logs/<session>.cezar-events.txt` for the RPC sessions (Cezar's events with time in ms and load), `logs/stats.txt`, the install, setup and update transcripts, `s5-tui.screens.txt` and `s6-pair.screens.txt` (TUI screen captures with time and load), `s5-tui.ps-before-quit.txt` (the zombie of defect 2), and `tree-*.txt` (goal 8). `s0-claude-refused.*` is the refused Claude request.

## Repeat

Set up as `lessons.md`'s Setup table says (the archives are `git archive --prefix=squeal-squeal--v<version>/` of the release commits, named `squeal--v<version>.tar.gz`), then from this directory: `sh sync.sh`, `sh gate.sh`, `sh proxy-start.sh <session>`, the session (`sudo -n -u squeal-e2e -H sh /home/squeal-e2e/dogfood-009/scripts/as-user.sh -C / node …/cezar-drive.mjs …/scenarios/<x>.json …/logs/<session>.events.jsonl`, or `tui.sh`), `sh proxy-stop.sh`, and `sh collect.sh`. Reset the clone between sessions (`git checkout -- . && git clean -fd packages`) and let the daemon re-validate (`squeal start`, `squeal status --wait`).
