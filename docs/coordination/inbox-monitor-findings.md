# Inbox monitor findings

Answers `docs/coordination/inbox-monitor-brief.md`. Researcher, 2026-10-27. Versions examined: Claude Code 2.1.311, codex-cli 0.164.0, Codex docs at developers.openai.com fetched 2026-10-27, and the Cezar MCP tool descriptions in this session. All probes ran against a fake inbox in task scratch, not the real `.agent-inbox/`. No peer was contacted. No human question was opened or changed.

## Answers

| # | Question | Answer | Tag |
|---|----------|--------|-----|
| 1 | Can Claude Code watch the inbox with a native background task and notify its session? | Yes. Bash with `run_in_background: true` runs a watcher that exits on the first relevant new message. Claude Code then delivers a task notification, both during an active turn and when the session is parked. | verified by experiment |
| 2a | Can Codex notify an active turn natively? | Only indirectly. A background terminal must be polled by the model with `write_stdin`. An async hook can add context at the next model request, but a hook event triggers it, not a new file. | read in official docs |
| 2b | Can Codex wake a parked session natively? | No, without a channel that acts as user input. The docs say a finished background hook "doesn't start a new turn". The Stop hook and `codex queue` add user-prompt input, which the protocol forbids. | read in official docs, read in CLI help |
| 2c | What is the smallest honest Codex fallback? | Under Cezar: run the same watcher detached and register `cezar_wait` with `kind: "process"`. Outside Cezar: read at the checkpoints in `docs/agent-inbox.md`. | read in Cezar tool description; not run from Codex |
| 3 | Which sequence prevents missed messages, loops and orphans, and leaves human questions alone? | Use a list of seen message IDs, not timestamps. Snapshot, read, arm, and on each wake read, append and rearm. Cleanup is TaskStop plus an owner-PID guard. The notification says it is not user input. | verified by experiment (except the open-ask case: inferred) |

## 1. Claude Code

The Bash tool description in Claude Code 2.1.311 says `run_in_background` "keeps running across turns and re-invokes you when it exits". Its timeout is at most 7,200,000 ms; at the limit the harness stops the command and re-invokes the session. The Monitor tool sends one event per stdout line, but every monitor expires after at most 30 minutes, so it needs more rearms. A one-shot Bash background task fits a "new message" signal better (read in the installed tool descriptions).

Probes, all verified by experiment with `docs/coordination/probes/inbox-monitor/watch-inbox.sh`:

- **Filtering.** The test published one message to another session, one from my own session to `all`, and then one to me. The watcher stayed running for the first two. It exited 0 with `inbox: cccc-mine` for the third.
- **Active turn.** The completion arrived as `<task-notification>` with status `completed`, under a header: "This is an automated background-task event, NOT a message from the user. Do NOT interpret this as user acknowledgement, confirmation, or response to any pending question."
- **Parked session.** I armed the watcher, started a detached publisher (`setsid nohup`, 45 s delay) and ended the turn on a 10-minute Cezar timer. The message was published at 09:59:17Z. The session woke from the task notification by 09:59:24Z (within one 5 s poll), and the timer was then cancelled.
- **Rearm, no loop.** With `cccc-mine` added to the seen file, a rearmed watcher stayed silent for 8 s while that message was still present.
- **Cleanup.** `TaskStop` on the task ID reported success, and `pgrep` then found no watcher process. With an owner PID passed in, killing the owner made the watcher print `owner <pid> gone` and exit 3 within 5 s.
- **Owner PID.** In the Bash tool shell, `$PPID` is the `claude` process (seen as `claude --input-format stream-json ...`).
- **Cost.** With 204 message files, the loop used 0.17 s of user CPU in 6 s, about 0.08 s per 5 s pass.

Not tested: whether Claude Code kills background tasks when the session exits. The owner-PID guard covers that case either way.

## 2. Codex

- **Background terminals.** With `unified_exec` (stable, on in 0.164.0), the model polls a background terminal with empty `write_stdin` calls, up to `background_terminal_max_timeout` (default 300000 ms). `/ps` lists terminals and `/stop` stops them. This is model polling of tool output (config-reference, slash-commands). In the 0.164.0 binary strings I found no text that says a terminal's exit notifies the model. Not determined beyond that, because there is no source to read and a live Codex run was out of scope.
- **Async hooks.** "If a turn is active, Codex ... makes the output available to the next model request in that turn. If no turn is active, Codex waits until the next user turn. Finishing a background hook doesn't start a new turn." Async hooks cannot control turn continuation (hooks, "How background hooks run"). A `PostToolUse` hook that lists unseen inbox IDs could therefore show new messages during an active turn, after each tool call. This is inferred and was not tested. It also needs a hooks config and hook trust, which are the parent's decision.
- **Rejected native paths.** A Stop hook `decision: "block"` "creates a new continuation prompt that acts as a new user prompt" (hooks, "Stop"). `codex queue --thread <id> --message <text>` "Queue[s] a message for an existing session" (CLI help). Both inject user-turn input. Both can collide with a pending human question, so `docs/agent-inbox.md` excludes them. `notify` covers only `agent-turn-complete` and calls an external program; it does not wake the agent.
- **Unknown.** `wake_on_agent_messages` is listed as "under development, false" in `codex features list`. Its scope is not determined: no docs page describes it, and it is off.
- **Fallback (Cezar).** The `cezar_wait` description says: kind `"process"` "wakes you when a command you started in the background ends". Start the watcher as `sh -c '( cmd > "$TMPDIR/x.log" 2>&1; echo $? > "$TMPDIR/x.exit" ) > /dev/null 2>&1 & echo $!'`, then pass `pid` and a new `exit_file`. "The job outlives this session and Cezar does not stop it", so keep the owner-PID guard or a timeout on the watcher. This applies to Codex sessions under Cezar. It is read only and was not run from Codex.

## 3. Minimal procedure (Claude Code; Codex under Cezar uses the same watcher)

Keep the seen file in session scratch. A restart wipes `$TMPDIR` (project memory), so step 1 rebuilds it at every start or resume.

1. **Snapshot.** `ls "$SQUEAL_INBOX/messages"/*.md | xargs -n1 basename | sed 's/\.md$//' > "$SEEN"`. Every ID in `$SEEN` is one you will read now.
2. **Read.** Read the messages in `$SEEN` addressed to you or `all`, as `docs/agent-inbox.md` says. Record handled and open IDs in the handoff.
3. **Arm.** Run one watcher with Bash `run_in_background: true` and `timeout: 7200000`:
   `exec <path>/watch-inbox.sh "$SQUEAL_INBOX/messages" <session-id> "$SEEN" "$PPID"`
   A message that arrived between steps 1 and 3 is not in `$SEEN`, so the watcher reports it on its first pass. Nothing is missed.
4. **Wake.** Read the task output (`inbox: <id> ...`). Read those messages, append their IDs to `$SEEN`, handle them, then rearm (step 3). Old IDs are in `$SEEN`, so they do not loop. On a timeout re-invocation, rearm only.
5. **Human questions.** A notification is a system event, not a human answer. Never treat it as approval, and never answer, re-ask or cancel an open human question because of it. `cezar_cancel_wait` cannot close a question the user already sees.
6. **Cleanup.** Before you mark the session `closed` or finish: `TaskStop` the watcher's task ID, then confirm with `pgrep -af watch-inbox.sh`. Keep at most one watcher per session. The owner-PID argument stops a watcher whose session is gone.

The watcher filters on the `to:` and `from:` header lines. It skips files that do not end in `.md`, so drafts are never read. It polls the directory every 5 s instead of using inotify, because `inotifywait` is not installed on this host. This is a shell loop that sleeps, not polling by the model.

## Recommendation

Claude coordinators: adopt the procedure above with a one-shot `run_in_background` watcher. It is native, verified for active and parked sessions, and cheap. Codex coordinators under Cezar: use the same watcher with `cezar_wait` kind `process`. Outside Cezar, keep the checkpoint reads. Do not use the Stop hook, `codex queue` or `cez task` to wake an agent.

## Open questions

1. When a Claude session wakes from a notification while it has an open human question (`cezar_ask`), which Cezar call should end that turn? I did not test this, so no human question would be opened. Decided by a Cezar maintainer or a controlled probe with a throwaway card.
2. Does `cezar_wait` kind `process` work from a Codex session? Read only. Decided by one run under Cezar's Codex runner.
3. Would a `PostToolUse` inbox hook in Codex be acceptable? It needs hook trust and config the parent owns.
4. What does `wake_on_agent_messages` cover? It is off and undocumented in 0.164.0.

## Sources

- Claude Code 2.1.311 Bash, Monitor and TaskStop tool descriptions, as loaded in this session.
- https://developers.openai.com/codex/hooks.md ("Run hooks in the background", "Stop"), fetched 2026-10-27.
- https://developers.openai.com/codex/config-reference.md (`background_terminal_max_timeout`, `notify`, `features.unified_exec`), fetched 2026-10-27.
- https://developers.openai.com/codex/cli/slash-commands.md (`/ps`, `/stop`), fetched 2026-10-27.
- `codex --help`, `codex queue --help`, `codex features list` (codex-cli 0.164.0).
- Cezar MCP `cezar_wait` and `cezar_cancel_wait` descriptions in this session.
- Probe: `docs/coordination/probes/inbox-monitor/` (throwaway).
