# Research: a pull advances its consumer's push view

Task 001-84, 2026-10-07. Claude Code 2.1.292 on Linux, Sonnet as the session model. Squeal at `6ca3c8f`, Vitest 5.0.3. Every Claude Code session ran in a scratch repository under `/tmp/sq84/` with a scrubbed environment and no Squeal store; probes and logs are under `probes/pull-advances-push/`.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | What a Bash subprocess sees of its session and agent | The session, reliably: `CLAUDE_CODE_SESSION_ID` equals the hooks' `session_id` in `-p`, interactive, `--agent` and subagent Bash calls, and follows `/clear`. The agent, not at all: a subagent's Bash has the main agent's environment, parent process and descriptors. Only a PreToolUse `updatedInput` rewrite can hand it the agent id. | verified by experiment; session variable also read in official docs |
| 2 | Can `status --wait` advance the view without losing a transition | Not from the CLI with what it can see: a subagent's pull would advance the main agent's view and lose its news (race 4). Even with an injected agent id the CLI cannot know whether its output reached the model. The store side is safe if the view takes the states the pull read, never over a newer entry. | verified by experiment (store probe); inferred for output loss |
| 3 | The fallback | PostToolBatch confirms the pull: it receives every tool's result text, as the model got it, plus its own `agent_id`. It credits a pull whose output block arrived intact. Preferred over a PreToolUse rewrite. | verified by experiment (hook inputs and store probe) |
| 4 | Codex, Pi, OpenCode | Codex: `CODEX_SESSION_ID` and per-thread `CODEX_THREAD_ID` (source only). Pi: `PI_SESSION_ID`. OpenCode: none by default; plugin hook `shell.env` gets `sessionID`. | read in source code / read in official docs |

## Findings

### 1. What the Bash subprocess sees (verified by experiment, Claude Code 2.1.292)

`probe.sh` ran as a Bash tool call in the main agent, in a `general-purpose` subagent and in a custom `prober` subagent (`-p`, `p-main`); in the main agent and a background subagent of an interactive tmux session (`i-main`); under `claude -p --agent prober` (`p-agent`). Values from `p-main`, identical in all three agents:

```
CLAUDECODE=1  CLAUDE_CODE_CHILD_SESSION=1  CLAUDE_CODE_ENTRYPOINT=sdk-cli  CLAUDE_CODE_SESSION_ATTENDED=0
CLAUDE_CODE_SESSION_ID=5969d1b5-e562-4804-97c4-a7fe6997db80  CLAUDE_PID=129610  CLAUDE_EFFORT=medium
CLAUDE_CODE_MESSAGING_SOCKET=/run/user/1001/cc-socks/129610.sock  CLAUDE_CODE_EXECPATH=.../claude.exe
```

- Session: `CLAUDE_CODE_SESSION_ID` equalled `session_id` in every hook input of the session. Interactive sessions differ only in `CLAUDE_CODE_ENTRYPOINT=cli` and `CLAUDE_CODE_SESSION_ATTENDED=1`. After `/clear` the SessionStart (`source: clear`) and the next Bash call both had the new id `66d38a9f-...`, under the same `CLAUDE_PID`. The env-vars page documents it: "this matches the `session_id` field in the hook JSON input and is updated on `/clear`" (read in official docs, code.claude.com/docs/en/env-vars, 2026-10-07).
- Agent: nothing. The subagents' Bash calls had the same variables, the same parent (`bash -c source .../shell-snapshots/snapshot-bash-<t>.sh ...` under the `claude` process `CLAUDE_PID`) and the same messaging socket. Descriptors 1 and 2 point at `<TMPDIR>/claude-<uid>/<project>/<session id>/tasks/<random>.output`, one file per tool call; the random part is not the `tool_use_id`. Under `--agent prober` a variable `CLAUDE_CODE_AGENT=prober` appears; it is not on the env-vars page and names the session's agent, not a subagent.
- Hooks do carry the agent: `agent_id` (e.g. `a04dcac59c8fb8c0a`) and `agent_type` on PreToolUse, PostToolUse, PostToolBatch, SubagentStart and SubagentStop events of a subagent, and `tool_use_id` on PreToolUse and PostToolUse. Under `--agent` the main thread's hooks have `agent_type: prober` and no `agent_id`, so Squeal's `agent_id ?? "main"` still names it `main`.
- Concurrency is real: in `i-main` the subagent was backgrounded and its Bash call ran 1.5 s after the main agent's second one, in the same session. In `p-tag` two parallel subagents ran the same command 375 ms apart.

Injecting the agent through PreToolUse `updatedInput` (`hooks/tag.mjs`, no `permissionDecision`) works: each of the two parallel subagents got its own `SQUEAL_AGENT_ID`, and the transcript keeps the original command (the model's `tool_use` input and its final answer both say `./probe.sh tag-main`). It collides with permissions. With `--permission-mode default --allowedTools 'Bash(./probe.sh *)'`: an env-assignment prefix and an `export SQUEAL_AGENT_ID=...;` prefix were both refused, "This command requires approval" (in `permission_denials` with the rewritten command); an appended argument, `./probe.sh shape-test --squeal-agent main`, ran. The same call without the hook ran.

### 2. Advancing the view from the pull (read in source code at `6ca3c8f`; verified by experiment)

Today `deliver` reads the view and the known states and writes the view in one `BEGIN IMMEDIATE` transaction (`src/core/delivery/delivery.ts:96`, `src/core/store/connection.ts:43`), so it is serialized with the daemon's writes. `waitForStatus` reads known states once to decide (`src/cli/status-wait.ts:112`) and again inside `buildSnapshot` to print (`status-wait.ts:130`, `src/core/status/snapshot.ts:85`), outside any transaction. A pull that writes a view must record the states it printed from the same read.

`race/race.probe.ts` drives the real store, state sink and `createDelivery`, with a candidate `confirmPull(consumer, pull)`: in one transaction, `planDelta(view, pulledStates)` with `toldAt` = the pull's read time, its writes kept only where the view entry is older than the read, its removals ignored. 9 of 9 cases pass:

| Case | Result |
|---|---|
| Today | The push repeats `a:first-seen-fail` after the pull printed it. |
| Confirmed pull, B breaks after the read | Push delivers only `b:first-seen-fail`. |
| Race 1: transition between read and advance, view advanced to the current states | B is never pushed. Lost. |
| Race 2: the waiter told A "two" between the pull's read ("one") and its confirmation | Unguarded: the view rolls back and "two" is pushed again as `fail-changed`. Guarded: nothing. |
| Race 3: two pulls confirmed newest first | Guarded: the view keeps the newer read (`pass`). |
| Race 4: a subagent's pull credited to `main` (session-only identity) | Main is never told A fails; the subagent hears it twice. Keyed by the hook's `agent_id`: both correct. |
| Recovery shown only as absence from the failure list | Consumed by the pull (no `fail-to-pass` push). |

So the transaction needs: the pulled states from the printed read, the `toldAt` guard, no removals (status never prints a retirement, so `fail-retired` is still pushed), and the consumer the output actually reached. The last one is outside the store. A pull's output can fail to reach the model intact: `./emit.sh B | tail -2` arrived as its last two lines (`p-batch`), the Bash tool truncates long output, and an interrupt can land after the CLI commits. The CLI cannot observe any of these (inferred).

### 3. The fallback: PostToolBatch confirms the pull (verified by experiment)

PostToolBatch input has `tool_calls[]`, each with `tool_name`, `tool_input`, `tool_use_id` and `tool_response`, a string equal to what the model received, stderr merged in (`p-batch`, `p-batch-stderr`). It fires after the batch's PostToolUse hooks, 17 ms after the last one in `p-batch`. A subagent's Bash result arrives in the subagent's PostToolBatch, with its `agent_id`; the main agent's PostToolBatch gets the Agent tool's hand-back, in which "the harness indents every line of the report" (`p-batch-sub`), so a block a subagent quotes never matches for the main agent.

| | H: hook-confirmed pull | R: PreToolUse rewrite, CLI advances |
|---|---|---|
| Identity | The hook's own `session_id`, `agent_id` | `--squeal-agent <id>` appended by a PreToolUse hook with `if: "Bash(squeal *)"` |
| Cost | Status writes one `pulls` row (token, worktree, read time, states read, digest of the printed block) and prints begin and end lines with the token. PostToolBatch scans its tool results for the begin line (a string search) and, on a hit, checks the digest and confirms in the transaction it already runs. New table, one migration. | One more hook process per `squeal` Bash call (about 80 ms, `lessons.md`). The rewrite must refuse compound commands. An exact allow rule such as `Bash(squeal status --wait 60000)` stops matching. |
| What can be lost | Nothing by construction: it credits only what arrived intact, as told at read time, never over a newer entry. | Output that never reached the model intact (piped, truncated, interrupted): the CLI already advanced the view. |
| What still repeats | Pulls whose output was filtered or truncated, ran outside a hook-carrying harness, or reached the agent only through a subagent's report. | Pulls the hook did not rewrite. |

Verdict: H. It needs no identity in the subprocess, so Question 1's negative answer for agents does not matter, and it is the only option that knows the output reached the model.

### 4. Other harnesses (one line each)

- Codex: shell commands get `CODEX_SESSION_ID` ("shared root-session identity") and `CODEX_THREAD_ID`, and subagents are spawned threads, `SubAgentSource::ThreadSpawn` (read in source code, openai/codex `5b0b253`, `codex-rs/core/src/exec_env.rs:38`, `codex-rs/protocol/src/shell_environment.rs:6,153`, `codex-rs/protocol/src/protocol.rs:3029`). The hooks page names neither, says "Subagent hooks use the parent session id" and documents `agent_id` only on SubagentStart and SubagentStop (read in official docs, learn.chatgpt.com/docs/hooks). Whether a Codex post-tool hook can tell a subagent apart is not determined, because the page does not say and it was not run.
- Pi: `bash` and `powershell` commands get `PI_SESSION_ID` and `PI_SESSION_FILE` (read in official docs, earendil-works/pi `7fb59f9`, `packages/coding-agent/docs/environment-variables.md`). Its docs describe no built-in subagents; an extension's `tool_result` handler sees the output in-process.
- OpenCode: no session variable by default; the plugin hook `shell.env` receives `{ cwd, sessionID, callID }` and sets variables per command (read in official docs and source, sst/opencode `ecc4916`, `packages/web/src/content/docs/plugins.mdx`, `packages/plugin/src/index.ts:270`). Subagents run as child sessions with their own id, and `tool.execute.after` sees the output.

## Recommendation for Squeal

Feasible, by design H. A pull advances its consumer's view only when the harness shows that the pull's output reached that consumer intact, and the view then takes the states the pull read. Nothing a pull printed is pushed again, and a transition recorded after its read is still pushed.

Spec sentences it changes:

- D6, after "Its view is the state and fingerprint last told to it for each check.": add "A pull is told too: when a tool result a consumer received contains a pull's output intact, its view takes the states that pull read, as a delivery of them would write, except entries told later than the read. A pull removes no view entry, so a retired failure is still delivered."
- D7, "`squeal status` and `squeal status --json` read the store directly and need no daemon.": add that each records the states it printed under a token it prints at the start and end of its output, from the same read as the snapshot, and that `--wait` prints that read.
- D8, "Tables:": add `pulls` (token, worktree, read time, states, digest), dropped after 10 minutes.
- D9, "`PostToolBatch`: deliver the delta for this consumer.": becomes "first credit this consumer with every pull whose output appears intact in the batch's tool results, then deliver the delta". The adapter's `onToolBoundary(consumer)` takes the batch's tool results.

"Push transitions. Pull state." stands.

Board row done-when: in a `-p` and an attended session on a scratch repository, an agent that read a failure through `squeal status --wait` gets no PostToolBatch or Stop repeat of it, while a transition recorded after the pull is pushed. A subagent's pull leaves the main agent's view unchanged, and `squeal status --wait 60000 | tail -3` advances nothing. Store tests pin races 1 to 4. PostToolBatch stays within its 80 ms p95.

## Open questions

1. Recovery by absence: the probe's last case consumes a `fail -> pass` push because the pull listed no failure for the check. Every failure is printed whatever its validity (`toKnownFailure`, `src/core/state/header.ts:127`), so I recommend counting it. `to-unknown` is different: status shows unknown checks only as a count, so confirmation should skip `to-unknown` writes or status should name them. For the human.
2. The digest's normalization: the Bash tool trims the trailing newline (seen in every `tool_response`). JSON mode puts its wait line on stderr, which arrives merged. Neither is pinned yet.
3. Not run: interactive `--agent`, `run_in_background` pulls read later through another tool, output over the Bash tool's limit.
4. Codex hook identity inside subagents, above.

## Sources

- Claude Code env vars: https://code.claude.com/docs/en/env-vars (`CLAUDE_CODE_SESSION_ID`, `CLAUDE_PID`, `CLAUDE_CODE_CHILD_SESSION`), fetched 2026-10-07.
- Claude Code hooks: https://code.claude.com/docs/en/hooks (`agent_id`, `if`, PreToolUse `updatedInput`), fetched 2026-10-07.
- Codex hooks: https://learn.chatgpt.com/docs/hooks (redirected from developers.openai.com/codex/hooks), fetched 2026-10-07; https://github.com/openai/codex at `5b0b253`.
- Pi: https://github.com/earendil-works/pi at `7fb59f9`, `packages/coding-agent/docs/environment-variables.md`.
- OpenCode: https://github.com/sst/opencode at `ecc4916`, `packages/web/src/content/docs/plugins.mdx`, `packages/web/src/content/docs/agents.mdx:131`, `packages/plugin/src/index.ts`.
- Squeal at `6ca3c8f`: `src/core/delivery/delivery.ts`, `src/core/delivery/delta.ts`, `src/cli/status-wait.ts`, `src/core/status/snapshot.ts`, `src/core/store/schema.ts`.
- Probes: `probes/pull-advances-push/` (README, `logs/*.hooks.jsonl`, `logs/*.probe.txt`, `race/race.probe.ts`).
