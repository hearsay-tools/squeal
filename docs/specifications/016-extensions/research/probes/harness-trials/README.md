# Probes for 016-35 (throwaway)

Findings are in `../../harness-trials.md`. Everything here is throwaway and ran on 2026-10-26 as the user `squeal-e2e` (`sudo -n -u squeal-e2e -H env -i HOME=/home/squeal-e2e PATH=/home/squeal-e2e/.local/bin:/home/squeal-e2e/.npm-global/bin:/opt/squeal-e2e/node24/bin:/usr/local/bin:/usr/bin:/bin …`, cwd `/`). The files were copied to `~/ht035/probe`; the scratch repository is `~/ht035/repo`; Squeal is `git archive squeal--v0.1.335 plugins/pi plugins/claude-code` in `~/ht035/squeal`. No model was called: OMP talked to `fake-openai.mjs` on 127.0.0.1, configured in `~/.omp/agent/models.yml` as provider `fake`, `api: openai-completions`, `auth: none`, model `fake-gpt`. Cursor was not run (no login).

| File | What it is |
|---|---|
| `setup-repo.sh`, `add-slow.sh` | The scratch repository: `sum.js` + `sum.test.js`, then `mul.js` + `slow.test.js` (a 4 s test, so a check is still pending when a turn ends). |
| `reset-repo.sh` | Puts the tracked files back. `start` starts Squeal's daemon with real Node and gives every test file a result; `baseline` does the same, then `squeal stop`. |
| `fake-openai.mjs` | A scripted chat-completions server. It logs every request body, which is the text OMP sent to the model. |
| `s1.json` … `s6.json` | The model scripts, one step per request. |
| `omp-event-log.js` | An OMP extension that logs every event name and its keys, and returns nothing. |
| `omp-shim.js` | A probe, not a design. It loads Squeal's Pi extension unchanged and maps its four Pi-only events onto OMP's. It traces Squeal's `sendMessage` calls. |
| `node-copy.sh` | A probe copy of the Pi package whose worker uses `$HT_NODE` for the daemon spawn and in `piCommand`. |
| `execpath-worker.mjs` | Shows that assigning `process.execPath` on Bun's main thread does not reach a worker thread. |
| `run-omp.sh`, `rpc-wake.mjs` | Run one OMP session (print mode, or RPC mode with an idle watch after `session_settled`). |
| `shell-break.sh` | Control for omp3: breaks `sum.js` from a shell and reads Squeal's verdict, with no agent. |
| `wake-direct.mjs` | Drives Squeal's Pi extension with a fake `pi` and context, with no agent session, under Node or `BUN_BE_BUN=1 omp`. |
| `show-model-log.cjs` | Prints a fake-model log, request by request. |
| `omp-sessions.txt` | The ten OMP sessions: model requests, RPC frames, events and shim trace, cut to size. |
| `stray-session.txt` | The OMP session Squeal's daemon spawn started in omp2. |
| `ps-omp7.txt` | The processes during omp7: one `omp`, and a daemon under Node. |
| `cursor-source.txt` | Excerpts of the cursor-agent 2026.10.22-27dcf5f bundle. |

The OMP sessions, in order (10, the brief's cap):

1. omp1: event log only.
2. omp2, first try: hung on an open stdin before OMP started; counted anyway.
3. omp2: package unchanged, no daemon; this is the stray agent.
4. omp3: package unchanged, live daemon.
5. omp4: shim, boundary delivered as a steer.
6. omp5: shim, boundary through `tool_result`, RPC mode, an outside edit after settling.
7. omp6: Node-routed copy, no daemon.
8. omp7: the same, with the `ps` sampler.
9. omp8: the same, with the `sendMessage` trace.
10. omp9: Node-routed copy, live daemon, new content; the wake.

After each session, `ps -u squeal-e2e` showed no `omp` and no Squeal daemon left over. What remains under `squeal-e2e`:
- `~/ht035`, with the repository, its store, the logs and both Squeal copies;
- `~/omp-dl/SHA256SUMS.txt`;
- `~/.omp`;
- `~/.local/bin/{omp,agent,cursor-agent}`, `~/.local/share/cursor-agent` and `~/.cursor`.
