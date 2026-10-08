# 002 Codex adapter: proof lessons

Task 002-16, 2026-10-07. Squeal plugin 0.1.21 from `faa202d`, installed into a scratch Codex home with Codex's own commands and trusted in the TUI, run with the real Codex CLI 0.160.1 and model on small Vitest repositories. Probes, prompts and trimmed logs: `research/probes/proof/` (its README holds the rules followed). Inputs: the brief in `tasks/wave-2.md`, `reviews/wave-1.md` N4 and N5.

## Verdict

The shipped Codex plugin does what goals 1, 3, 5 and 6 say, under `codex exec` and under a Cezar-shaped app-server thread. Every proof item is proven, in both modes where it applies. In the three working sessions (exec1, as1, as2) 11 transition reports reached a model, each at the first hook that could carry it, none twice, all in the turn that caused them. The `apply_patch` deny fired once per regression and the model re-issued the edit unprompted. No agent ran Vitest itself.

Two things fall short. First, an inline `/review` thread fires Squeal's hooks as the main agent and takes the main agent's undelivered report (defect 2, review N4 confirmed). Second, the per-tool 80 ms p95 of goal 7 was met only in the bundle test, not in real sessions, and never at calm load: the host stayed between load 7 and 41 for the whole task (N5 below). No hook failed, timed out or exceeded 375 ms in 142 runs, so the 2 s budget held everywhere.

No blocker for 002. Defect 1 is a core (001) defect that stops the daemon in a repository with a symlinked `node_modules`.

## Setup

| Item | Value |
| --- | --- |
| Codex | CLI 0.160.1, model `gpt-6.1-sol` through the host's provider (key from the environment), `approval_policy = "never"`, `sandbox_mode = "danger-full-access"` |
| Codex home | `CODEX_HOME=/tmp/p16/codex`, `HOME=/tmp/p16/home`; `config.toml` holds only the provider block. `~/.codex` untouched (its `config.toml` mtime 18:48, before the task); `~/.codex/auth.json` never read. |
| Install | `codex plugin marketplace add <this checkout>`, then `codex plugin add squeal@squeal`: installed `0.1.21` into `/tmp/p16/codex/plugins/cache/squeal/squeal/0.1.21`; Codex wrote `[marketplaces.squeal]` and `[plugins."squeal@squeal"]` itself (`logs/install.txt`). |
| Trust | The TUI, first launch in a scratch repository: "9 hooks are new or changed", `/hooks` table, `t` trusts all. Codex wrote nine `[hooks.state."squeal@squeal:hooks/hooks.json:<event>:0:0"]` entries (`logs/trust-tui-hooks-state.diff`). Each `currentHash` from `hooks/list` equals the pin in `test/plugins/codex/hooks-json.test.ts` (`logs/hooks-list-plugin.txt`). No bypass flag anywhere. |
| Agent's `squeal` | A two-line wrapper on `PATH` for the installed plugin's `dist/cli/squeal.mjs` (D1: Codex does not put `bin/` on `PATH`). |
| Repositories | `/tmp/p16/r<N>`: `src/math.js` (`add`, `mul`), `src/greet.js`, three Vitest 5.0.3 tests (five checks with the two file-level ones), `squeal init --harness codex`, committed. In r1 to r7 the daemon was started and its baseline finished before the session (`squeal start`, `squeal status --wait`), so SessionStart finds a store. |
| Drivers | `exec`: `codex exec --json -s danger-full-access`, rollouts under the scratch `sessions/`. App-server: `bin/cz.mjs`, shaped on Cezar's `codex-app-server-runner` (`initialize`, `configRequirements/read`, `thread/start` with `cwd`, `sandbox`, `approvalPolicy`, `turn/start`, stdin EOF to end). `bin/watch.mjs` polled the store every 100 ms in every run. |
| Machine | Linux 6.8, 24 cores, Node 24.21.0, load average 7.5 to 34 (other workers ran throughout) |

## Sessions

| Id | Mode, repository | Prompt (shortened) | Squeal said | Agent did |
| --- | --- | --- | --- | --- |
| exec1 | `exec`, r1 | scripted: break `add`, at once edit README, `sleep 6`, restore `add`, `sleep 6`, spawn a subagent that breaks and restores `greet` with a `sleep 6` after each | registration and primer; a deny with `PASS -> FAIL`; `FAIL -> PASS` at PostToolUse; the subagent's own registration, `PASS -> FAIL` and `FAIL -> PASS` | Re-issued the denied patch "as permitted by the message", quoted all five reports in its answer with the step each arrived at. |
| as1 | app-server, r2, two turns, then `review/start` inline | turn 1: give `greet` a `greeting` parameter defaulting to "hi"; turn 2: a subagent renames `mul` to `times` in `src/math.js` only | registration; `PASS -> FAIL` (greet) at PostToolUse; the subagent's registration naming the known failure; the subagent's `PASS -> FAIL` (mul); the parent's own `PASS -> FAIL` (mul) | Turn 1: read the Squeal skill on its own, ran `squeal status --wait 60000` in the same code cell as the patch, reported that the old test still expects "hello ada" and left it (the task said minimal). Turn 2: reported both failures. The reviewer ran `squeal status --wait 60000` and cited Squeal in its findings. |
| as2 | app-server, r7 | the exec1 prompt | as exec1 | as exec1 |
| n4inline | app-server, r3, logging hook on | turn 1: read `src/math.js`; outside edit breaks `mul`; inline review; turn 2: "is any test failing, from what you were told?" | registration; then the main agent's `PASS -> FAIL` went into the review thread (defect 2) | Turn 2: "Yes, the review reports that the `mul multiplies` test is failing, according to Squeal." |
| n4inline2 | app-server, r3b, logging hook on | as n4inline | as n4inline | As n4inline: "The review reports that [...] is failing, confirmed by Squeal". |
| n4detached | app-server, r4 | as n4inline with `delivery: "detached"` | registration | Codex refused: "paginated threads do not support detached review". |
| nd-r9 | app-server, r9, no Squeal | `ls`, append to README, `sleep 2`, a subagent runs `ls src` | nothing | "No message from Squeal was received." |
| nd-r5 | app-server, r5, daemon `SIGSTOP`ped | same | registration with "No daemon has validated since ..."; nothing after the edit | Quoted only "Known failures: 0". |
| nd-r6 | app-server, r6, symlinked `node_modules` (defect 1) | same | registration with "counts are not complete"; "no daemon is validating at revision 0" and "at revision 1" | Quoted the "no daemon is validating" line. |

## Proof items

### 1. SessionStart registers `(session_id, main)` and injects the header and primer: proven

exec1 (`logs/exec1.store.jsonl`, `logs/exec1.main.timeline.txt`): the store held no consumer at +152 ms and `01a1183d-1c24-73b3-a9d2-c6100a82b808/main` at +352 ms; that id is the thread id `codex exec` printed. The model's context at +346 ms, before the user prompt:

```text
+346ms developer:
SQUEAL · registered at revision 0
Revision 0: 5 current, 0 pending, 0 stale, 0 unknown. Full-suite checkpoint: completed at revision 0.
Known failures: 0

Squeal runs this repository's Vitest tests in the background after each edit, and its results arrive as SQUEAL messages after your tool calls; do not run Vitest to learn whether your edits broke something. [...]
```

as1 (`logs/as1.hooks.jsonl`): `sessionStart completed 87ms`, one entry of kind `context` with the same text; consumer `01a11840-2dea-.../main` at +462 ms. as2, n4inline, nd-r5 and nd-r6 show the same. With no Squeal (nd-r9) SessionStart completed in 56 ms with no entry and no store.

### 2. A breaking edit yields `PASS -> FAIL` through PostToolUse in the same turn, the fix `FAIL -> PASS`: proven

Each report arrived at the PostToolUse of the first tool call that ended after the result was recorded, in the same turn. Times are ms after the run started; "recorded" is the transition's `at` in the store.

| Run, consumer | Transition | Recorded | Delivered by | At |
| --- | --- | --- | --- | --- |
| as1 main | greet `PASS -> FAIL` | +15,725 | PostToolUse of `squeal status --wait`, in flight in the patch's code cell | +16,050 |
| exec1 subagent | greet `PASS -> FAIL` | +51,864 | PostToolUse of `sleep 6`, started +53,913 | +60,131 |
| exec1 subagent | greet `FAIL -> PASS` | +63,291 | PostToolUse of `sleep 6`, started +66,122 | +72,357 |
| exec1 main | add `FAIL -> PASS` | +28,813 | PostToolUse of `sleep 6`, started +31,058 | +37,267 |
| as2 main | add `FAIL -> PASS` | +101,383 | PostToolUse of `sleep 6`, started +103,054 | +109,243 |
| as2 subagent | greet `PASS -> FAIL` | +124,617 | PostToolUse | +133,476 |
| as2 subagent | greet `FAIL -> PASS` | +137,016 | PostToolUse | +147,678 |

as1, the PostToolUse entry (`logs/as1.hooks.jsonl`, 74 ms):

```text
SQUEAL · 1 check changed at revision 1
Revision 1 (changed src/greet.js): 5 current, 0 pending, 0 stale, 0 unknown. Full-suite checkpoint: none completed at revision 1; last completed at revision 0.

FAIL  test/greet.test.js > greet says hello
      PASS -> FAIL, seen by Squeal's run at revision 1
      expected 'hi ada' to be 'hello ada' // Object.is equality
      at test/greet.test.js:3:55
      touches files changed here since this session started: src/greet.js

Full output: squeal why "test/greet.test.js > greet says hello"
```

In exec1 and as2 the main agent's `PASS -> FAIL` came through the deny of item 4, not PostToolUse, because its next call was an `apply_patch`; the deny marks the regression told, and no later hook repeated it. Silence held: no `PASS -> PASS` was ever reported, the unchanged greet failure in as1 turn 2 was not repeated, and every Stop was silent (9 of 9 in app-server threads, and no `<hook_prompt>` in any rollout), so no Stop cost a continuation.

### 3. A subagent's calls deliver only to `(session_id, agent_id)`, and SubagentStart gives it the header and primer: proven

exec1 (`logs/exec1.store.jsonl`): SubagentStart registered `01a1183d-1c24-.../01a1183d-bdae-7aa3-8df9-5e06ccd27097` at +41,738 ms; the subagent's rollout has, at +41,649 ms, before its first call:

```text
SQUEAL · registered at revision 3
Revision 3 (changed src/math.js): 5 current, 0 pending, 0 stale, 0 unknown. Full-suite checkpoint: none completed at revision 3; last completed at revision 0.
Known failures: 0

Squeal runs this repository's Vitest tests in the background after each edit, [...]
```

The subagent's two deliveries moved only its own `last_delivered_at` (+60,116, +72,343) and its own view of greet (fail, then pass). The main consumer's `last_delivered_at` stayed at +37,254 and its view of greet stayed `pass` throughout. SubagentStop removed the subagent at +86,349. The parent was never told about greet: at its next boundary greet was passing again, which is its view, so silence is right.

as1 is the case where both hear: the subagent's PostToolUse delivered mul `PASS -> FAIL` at +38,533 to the subagent only (main's view still `pass` for mul), and the parent heard it from its own view at its next PostToolUse, after `wait_agent`, at +45,461. The subagent's SubagentStart header named the parent's open failure: "registered at revision 1 [...] Known failures: 1 / FAIL test/greet.test.js > greet says hello".

Seen, not a defect: a Codex subagent starts from a fork of its parent's history, so its context already holds the parent's SQUEAL messages, followed by its own registration and a second copy of the primer (`logs/exec1.subagent.timeline.txt`). The subagent in exec1 quoted the parent's two messages as its own in its report.

### 4. The next `apply_patch` after an undelivered regression is denied once: proven

exec1 (`logs/exec1.main.timeline.txt`): the breaking patch applied at +10,615 ms, the transition was recorded at +10,864, and the next call, an `apply_patch` to README at +13,695, came back:

```text
Command blocked by PreToolUse hook: SQUEAL · 1 check changed at revision 1
[...]
FAIL  test/math.test.js > add sums
      PASS -> FAIL, seen by Squeal's run at revision 1
      expected -1 to be 5 // Object.is equality
[...]
Squeal policy interrupt.onRegression denied this apply_patch call, so the edit was not applied. The same call can be re-issued; this regression does not deny again.. Command: *** Begin Patch [...]
```

The model re-issued the identical patch at +16,813 and it applied. as2 repeated this: transition +77,642, deny +82,940, which Codex reports as `status: "blocked"` with an entry of kind `feedback` (`logs/as2.hooks.jsonl`), then the re-issued patch applied. No `Bash` call was ever denied. The doubled period in "again.. Command:" is Codex appending ". Command:" to a reason that already ends in a period.

### 5. SessionEnd unregisters at `exec` end and at stdin EOF: proven

- `exec` (`logs/exec1.store.jsonl`): the main consumer was present at +86,349 and gone at +113,000; `codex exec` returned at +113,046.
- stdin EOF, as1: EOF at +90,529, app-server exit at +90,664, consumer gone at the next poll, +90,756. as2: EOF +184,522, gone by +184,745. n4inline: the logging hook saw `SessionEnd` with the thread's `session_id` at +31,763, 113 ms after EOF, and the store was empty after.
- No run needed the SIGTERM grace. SessionEnd's duration is not reported: the app-server exits before its `hook/completed` reaches the client.

### 6. Every hook exits 0 within its budget with no daemon: proven

Over the six app-server threads Codex reported 142 Squeal hook runs: 141 `completed`, 1 `blocked` (the deny), none `failed` or timed out (`logs/hook-durations-all.txt`). The slowest was 375 ms, SessionStart in nd-r6, which spawns a daemon. `exec --json` does not show hooks; the exec run exited 0 with every hook effect above present.

| Run | Daemon | Hook runs | Max | What the model saw |
| --- | --- | --- | --- | --- |
| nd-r9 | none, no Squeal in the repository | 17 | 75 ms; PreToolUse and PostToolUse 1 to 2 ms (the `sh` fast path) | nothing |
| nd-r5 | alive pid, `SIGSTOP`ped | 19 | 205 ms | the registration with "No daemon has validated since 2026-10-07T21:32:20.155Z; results are as of revision 0", nothing more |
| nd-r6 | exits at its start scan (defect 1) | 19 | 375 ms | registration, then "SQUEAL · no daemon is validating at revision 0" and "at revision 1" at PostToolUse |

## Review wave 1, N4: an internal review thread fires tool hooks as the main agent

Confirmed twice, defect 2. In n4inline (r3) and again in n4inline2 (r3b) a silent logging hook in the scratch user layer recorded every hook's stdin. The first run's stdin log was overwritten by the detached attempt, so the fields below come from n4inline2 (`logs/n4inline2.stdin.jsonl`, `logs/n4inline2.session-meta.jsonl`, `logs/n4inline2.hooks.jsonl`). The first run's summary, printed before it was lost, matched it on event, `session_id`, `agent_id`, `agent_type`, `turn_id` and `transcript_path`.

Both runs: turn 1 reads a file; an outside edit breaks `mul` and the daemon records `PASS -> FAIL` while no hook runs; `review/start` with `delivery: "inline"`; turn 2 asks whether a test is failing. The review ran in its own thread, but its UserPromptSubmit returned the main agent's undelivered delta and marked `(session_id, main)` told (n4inline at +14,084 ms, n4inline2 at +42,310 ms):

```text
[userPromptSubmit, review turn] SQUEAL · 1 check changed at revision 1
FAIL  test/math.test.js > mul multiplies
      PASS -> FAIL, seen by Squeal's run at revision 1
      expected 5 to be 6 // Object.is equality
```

The main agent's next UserPromptSubmit and Stop said nothing. In both runs it answered turn 2 from the review's prose ("The review reports that `test/math.test.js > mul multiplies` is failing, confirmed by Squeal"), because the reviewer had cited Squeal in a finding that Codex copied into the main thread. A review that did not mention it would have lost the report. The review also got no primer, and no Stop ended its turn, so the main consumer stayed in a turn until the next prompt.

Every field the hooks received, main thread against review thread, in n4inline2 (main thread id `01a1185a-4716-7c01-b1ca-853a7eeea04c`):

| Field | Main thread's hooks | Review thread's hooks |
| --- | --- | --- |
| Events | SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, SessionEnd | UserPromptSubmit, PreToolUse, PostToolUse only; no SessionStart, SubagentStart, Stop or SubagentStop |
| `session_id` | `01a1185a-4716-...` | `01a1185a-4716-...`, the parent's |
| `agent_id`, `agent_type` | absent | absent |
| `turn_id` | `01a1185a-4742-...` (turn 1), `01a1185b-1d9c-...` (turn 2) | `01a1185a-eb43-7a10-b50d-ad4317188252`, its own; not the turn id `review/start` returned (`01a1185a-eb0c-...`) |
| `transcript_path` | `.../rollout-2026-10-07T23-52-12-01a1185a-4716-7c01-b1ca-853a7eeea04c.jsonl`: ends in `session_id` | `.../rollout-2026-10-07T23-52-54-01a1185a-eb11-7ad3-9c79-ff5c7b0691eb.jsonl`: ends in the review thread's id, not `session_id` |
| `cwd` | `/tmp/p16/r3b` | `/tmp/p16/r3b` |
| `model`, `permission_mode` | `gpt-6.1-sol`, `bypassPermissions` | the same |
| `source` | `startup`, on SessionStart only | absent (no SessionStart) |
| `prompt` (UserPromptSubmit) | the user's text | "Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings." |
| `tool_name`, `tool_use_id` | `Bash`, `exec-<uuid>` | the same shape |
| `stop_hook_active` (Stop), `reason` (SessionEnd) | `false`, `other` | none |
| First line of the rollout at `transcript_path` (`session_meta`) | `id` = `session_id`, no `parent_thread_id`, `source: "vscode"` (the app-server client) | `id: 01a1185a-eb11-...`, `session_id` and `parent_thread_id` = the parent's, `source: {"subagent": "review"}`, `thread_source: "subagent"`, `multi_agent_version: "disabled"` |
| Codex's `hook/started` and `hook/completed` | `threadId` = main | `threadId` = main too, so an app-server client cannot tell them apart either |

So the stdin fields that differ are `transcript_path`, whose file name ends in an id other than `session_id`, and `turn_id`. The `prompt` text differs too but is not a contract. The rollout's `session_meta` names the review outright, but 002-18 left the rollout format unverified (N3). `delivery: "detached"` is not available for an app-server thread (n4detached: "paginated threads do not support detached review"), so inline is the case that matters for Cezar and the TUI.

## Review wave 1, N5: Stop p95 at calm load

Not measured at calm load. The host's 1-minute load average stayed between 7.4 and 41.3 for the whole task, never under the test's threshold of 4, and the coordinator called off the wait. For comparison, 002-14 measured Stop at 76 ms p95 at load 3.9. The best Stop numbers here:

- `test/harness/codex/latency.test.ts` at load 17.18 (`logs/latency-1.txt`, best of up to 3 rounds of 20 cold runs): Stop p95 86 ms, Stop (silent) p95 103 ms, SubagentStart p95 129 ms; every other hook 67 to 81 ms. Above load 4 the test reports and does not assert.
- Real sessions, Codex's own `durationMs`: the best is as1 at load about 9, Stop 74 and 78 ms (2 runs). Over all 9 Stop runs at load 9 to 34, p50 110 ms and p95 259 ms. PostToolUse p95 195 ms over 51 runs and PreToolUse p95 209 ms over 54 (`logs/hook-durations-all.txt`). In nd-r9, where the `sh` fast path exits before Node, PreToolUse and PostToolUse took 1 to 2 ms.

Every run is far inside the 2 s timeout. Whether Stop stays under 80 ms p95 at calm load is still open.

## Defects

1. **The daemon cannot start in a repository whose `node_modules` is a symlink.** Core (001), not the Codex adapter. `squeal start` in r1 with `node_modules -> /tmp/p16/nm/node_modules` printed "Daemon: running", then the daemon exited: "could not start: squeal: git check-ignore -z --stdin exited 128 [...] fatal: pathspec 'node_modules/.package-lock.json' is beyond a symbolic link" (`logs/symlink-node-modules.status.txt`). Every later hook spawns a daemon that dies the same way (nd-r6), so the repository is never validated. `git check-ignore` rejects the whole batch for one path under a symlinked directory. Repositories and worktrees that link a shared `node_modules` are common.
2. **An inline `/review` thread takes the main agent's undelivered report.** Codex adapter, review N4 above. Its hooks carry the parent's `session_id` and no `agent_id`, so `(session_id, main)` is marked told while the main agent never sees the report. Stdin tells the threads apart only by `transcript_path`, whose file name ends in the review thread's id rather than `session_id`, and by `turn_id`; the N4 section lists every field.
3. **A hung daemon leaves edits unannounced.** Core (001 D9 and D10), seen in nd-r5. With the daemon stopped, an edit got no report and no "no daemon is validating" line at PostToolUse, unlike nd-r6, where the daemon was dead. The only signal was a clause in the registration header, and the agent summarised the session's Squeal messages as "Known failures: 0". 001's lessons (D1) saw the same header and an agent that read it; this agent did not.

## Notes for the next row (002-19, dogfooding)

- The TUI starts Codex's managed app-server daemon inside `CODEX_HOME`, and it downloaded and ran Codex 0.161.0 there, not the installed 0.160.1. TUI threads therefore run a Codex version the hash port was not checked against. The plugin hashes are Codex's own and survive that; `--print-launcher-config` hashes might not.
- An `apply_patch` context mismatch cost each of the four scripted agents (exec1 and as2, main and subagent) one failed call; nothing to do with Squeal, but such calls count in any per-call measurement.
- Spec open question 5 (a long-running command that yields to `write_stdin`) was not exercised: every command here finished within its yield time.

## After 002-22: the CLI command in a real session

2026-10-08. 003-31 ran as a Cezar Codex worker (gpt-6.1-sol) with the installed plugin 0.1.30. Its SessionStart primer named `node --disable-warning=ExperimentalWarning "/home/agent/.codex/plugins/cache/squeal/squeal/0.1.30/dist/cli/squeal.mjs" status --wait 60000` (rollout `rollout-2026-10-08T09-15-36-01a11a5e-...`), so defect 4's text is right in a real session. The agent, a reviewer, ran no `squeal` command, so a real run of it is not shown there; `test/harness/codex/command.test.ts` runs both the primer's command and a FAIL report's `why` line from `bash -c` with no `squeal` on PATH, on Node 22 and 24.

## Dogfooding with a Cezar Codex worker

Task 002-19, 2026-10-08. One real Cezar worker on Codex, `--backend codex --model gpt-6.1-sol`, did row 003-27 in this repository with the Squeal Codex plugin 0.1.24 installed into the real `~/.codex` and trusted (`status.md`, 2026-10-08). Cezar run `c7896f0e-662d-4172-adaf-81b907da8afe`, Codex thread `01a1188e-2475-7030-aa81-c1396f0402c1`, Squeal worktree id `b2baa0c8131a6dc2`, one turn from 00:48:51 to 00:59:03 local time (UTC+2; every time below is local), Codex CLI 0.160.1, load average 66 to 85. Extraction scripts and trimmed logs: `research/probes/dogfood/` (its README lists the sources and the rules followed). All sources were read only; `~/.codex/auth.json` and `config.toml` were not opened.

The worktree was removed before this report, and with it its store rows: `revisions`, `runs`, `results`, `transitions`, `consumers` and `known_states` hold nothing for `b2baa0c8131a6dc2`; only its `meta` rows survive (`logs/store.txt`). The Codex rollout records no hook runs and Cezar's run log records no `hook/started` or `hook/completed`. So what the model received comes from the rollout, which is complete for that; when a result was recorded comes only from the agent's own `squeal status` and `squeal why` output; hook durations are not recorded anywhere, and only upper bounds are given.

### Verdict

| Goal | Verdict | Evidence |
| --- | --- | --- |
| 1. `PASS -> FAIL` within one tool call, same turn, through PostToolUse | held for first-seen failures | Four reports, each at a PostToolUse; the one with a known record time came at the first tool call after it. No `PASS -> FAIL` happened in the session, so the reports were first-seen failures and one recovery. |
| 2. `FAIL -> PASS` the same way; silence otherwise; one report per cell | held | The one recovery arrived at PostToolUse. 35 code-mode cells ran 66 tool calls; no report repeated and none came for an unchanged state. One recovery that should have existed never did: Squeal never re-ran that test (defect 5, not the adapter). |
| 3. `apply_patch` deny after an undelivered regression | not shown | No `PASS -> FAIL` in the session. The agent's only `apply_patch` ran with nothing pending; it wrote its new test file and every note through the shell, which is never denied. |
| 4. Stop speaks only with news; silent Stop costs nothing | held, silent case only | One Stop, silent; the turn ended 0.2 s after the final message with no `<hook_prompt>` in the rollout. |
| 5. Subagents | not shown | No subagent; Cezar's developer message forbids spawning one. |
| 6. SessionEnd at stdin EOF | held | Cezar closed the session at 00:59:03.038; the store recorded the consumer `(thread, main)` leaving at 00:59:03.169. The daemon stopped at 01:59:03.380, "idle for 60 min with no registered consumers". |
| 7. 2 s budget, silence without a daemon, 80 ms p95 at calm load | not shown | No hook timing exists for the session. Upper bounds of 147 to 885 ms for PostToolUse and 1,562 ms for SessionStart keep every observed hook under its 2 s timeout. The bundle test in the worker's own run, at load 75.7, gave Codex p95 of 155 to 562 ms. The daemon never died. |
| 8. Install with Codex's commands, trust, `squeal status` when hooks never ran | held for install and trust | The hooks ran in a Cezar app-server thread with no bypass flag. The status line for unrun hooks was not exercised. The agent's own `squeal` did not resolve (defect 4). |

Open question 5 (a command that yields to `write_stdin` delivers its PostToolUse late) is still not measured. Two commands yielded, `squeal status --wait 60000` for 60.3 s and the full Vitest run for 248 s, polled by 27 `write_stdin` calls. But no result can be shown to have landed while either one was in flight, and the rollout does not say which call's hook spoke.

No blocker for 002. Defect 4 belongs to the adapter. Defect 5 is a repository config gap that Squeal cannot see from the inside. Defect 6 is a 001 test.

### What Squeal said

Every Squeal text the model received is below. There was no deny, no Stop block, no "Not validated" line and no UserPromptSubmit context. The task prompt at 00:48:53 and the parent's reply, which arrived as a user message at 00:56:19, carried nothing from Squeal. The bound is the time from the preceding tool item's completion to the message, from `logs/gaps.txt`.

| # | At | Hook, after | Bound | Text (first line) |
| --- | --- | --- | --- | --- |
| S1 | 00:48:52.880 | SessionStart, before the task prompt | 1,562 ms after `session_meta` | `SQUEAL · registered at revision 0` |
| S2 | 00:51:27.621 | PostToolUse, `cezarion worker progress` | 885 ms | `SQUEAL · Squeal's baseline run found 1 failing check at revision 1` |
| S3 | 00:53:16.253 | PostToolUse, `git commit` | 169 ms | `SQUEAL · 2 checks changed at revision 3` |
| S4 | 00:53:29.627 | PostToolUse, `cezarion worker progress` | 329 ms | `SQUEAL · Squeal's baseline run found 1 failing check at revision 3` |
| S5 | 00:58:15.336 | PostToolUse, a `python3` notes write | 147 ms | `SQUEAL · Squeal's baseline run found 1 failing check at revision 3` |

S1, the header and primer. The store's `daemon-bootstrapped` is 00:48:52.723, so this SessionStart spawned the daemon. The note "no dependencies are installed in this worktree" was written at 00:48:53.801, after the header, and reached the agent only through `squeal status` later.

```text
SQUEAL · registered at revision 0
Revision 0: 0 current, 0 pending, 0 stale, 0 unknown. The daemon has not listed this worktree's test files yet; these counts are not complete. Full-suite checkpoint: none completed at any revision.
Known failures: 0

Squeal runs this repository's Vitest tests in the background after each edit, [...] wait only when you need a result before your next step, for example before saying the task is done: `squeal status --wait 60000`. Run tests yourself only when no daemon is validating, when results are unknown, or when the repository's own gate requires it. [...]
```

S2: a load-induced timeout from the baseline.

```text
FAIL  test/cli/codex.test.ts > squeal init --harness codex > touches nothing under a scratch HOME/.codex or CODEX_HOME, run as the CLI
      first observed: FAIL, seen by Squeal's baseline run at revision 0
      Test timed out in 5000ms.
      load average 81.79 when it ran
```

S3: the agent's new heap test, failing at revision 2, and S2's test recovering. The agent had already fixed the heap test at revision 3 (patch at 00:52:26) and watched it pass in its own run at 00:52:47.

```text
SQUEAL · 2 checks changed at revision 3
Revision 3 (changed test/runners/node-test/graph-memory.test.ts, src/runners/node-test/graph/graph.ts, src/runners/node-test/graph/resolver.ts): 155 current, 27 pending, 0 stale, 0 unknown. [...]

FAIL  test/runners/node-test/graph-memory.test.ts > releases build caches after cold builds, re-resolves, edits and listing changes
      first observed: FAIL, seen by Squeal's run at revision 2
      expected 15814984 to be less than 8388608
[...]
PASS  test/cli/codex.test.ts > squeal init --harness codex > touches nothing under a scratch HOME/.codex or CODEX_HOME, run as the CLI
      FAIL -> PASS
```

S4: bundle drift, expected because the worker's brief forbade `npm run build`.

```text
FAIL  test/harness/plugin.test.ts > bundles > are committed exactly as `npm run build` produces them
      first observed: FAIL, seen by Squeal's baseline run at revision 3
      cli/squeal.mjs differs from the build: expected false to be true // Object.is equality
      touches files changed here since this session started: src/runners/node-test/graph/graph.ts, src/runners/node-test/graph/resolver.ts
```

S5: the known Claude Code transitions race (002-20, relayed to 001). `squeal why` puts the failing result at 00:58:09.241 and the first-seen transition at 00:58:09.260. The agent made no tool call between 00:57:52 and 00:58:14.5, and the report came at the first call after that, 6.1 s after it was recorded.

```text
FAIL  test/e2e/transitions.test.ts > transitions on PostToolBatch, claude-code > delivers one PASS -> FAIL and one FAIL -> PASS, nothing in between
      first observed: FAIL, seen by Squeal's baseline run at revision 3
      expected false to be true // Object.is equality
      at test/e2e/transitions.test.ts:39:70
```

### What the agent did

- **It read the skill on its own.** It read the installed `skills/squeal/SKILL.md` at 00:49:15 and 00:49:25 and `references/commands.md` at 00:50:24. Its message at 00:49:53: "I'll also add a heap regression check and use Squeal's feedback during development."
- **It tried to wait for Squeal, then ran the test itself.** At 00:51:09 one shell command wrote the new heap test with a heredoc and then ran `node plugins/codex/dist/cli/squeal.mjs status --wait 60000`. It used the checkout's bundle because `command -v squeal` had printed nothing at 00:50:24 (defect 4). Its progress message to the parent at 00:51:26: "Heap regression added; waiting for its red result." At 00:51:47, with the wait still running, it started `npx vitest run test/runners/node-test/graph-memory.test.ts` and got its red at 00:52:00. The wait returned at 00:52:10 without the new test:

  ```text
  Returned on timeout after 60.1 s: 0 checks and 168 test files without checks pending at revision 2
  Known failures: 1
    FAIL  test/cli/codex.test.ts > [...] observed at revision 0, current
  ```

  Squeal's red for that test reached the agent at 00:53:16 (S3), 2 min 7 s after the file was written and after the fix. Squeal's first baseline over the 183 test files was still running at load 80 on a fresh worktree, so the agent's TDD loop outran it. Whether the daemon queued the new test file behind the baseline is not recoverable from what survived.
- **S2:** it called the failure unrelated and kept it for the report. At 00:51:43: "Squeal also reported an unrelated baseline timeout in the Codex init test at load 82. I'll include it in the verification report." At 00:54:18: "The earlier Codex init timeout has recovered."
- **S3:** it read the revision correctly. Handoff, 00:53:30: "memory red result at prior revision arrived, latest green pending". The green never came (defect 5). Both later `squeal status --json` calls, at 00:55:16 and 00:57:51, listed the test as a current failure observed at revision 2. In its final report to the parent the agent said Squeal "retains the memory test red observation from revision 2; standalone graph and full gates passed it."
- **S4 changed what it did and when.** Fourteen seconds after S4, at 00:53:43, it asked the parent to accept the drift ("Squeal reports expected plugin bundle drift [...] Brief forbids build and owns no bundles. Please confirm"). Its own full run, started at 00:53:26, showed the same failure only by 00:55:44. The parent's yes came at 00:56:08, before the suite ended at 00:57:34. So Squeal moved a coordination question about 2 minutes earlier, and the gate ended with the answer already in hand.
- **S5:** it asked Squeal before reporting. `squeal why 'transitions on PostToolBatch, claude-code'` matched two checks and exited 1; it retried with the full name, read a history that showed passes in other worktrees and earlier failures in one, and told the parent the test "passed in the required standalone full gate".
- **It ran Vitest itself three times:** the red run above, `npx vitest run test/runners/node-test/graph*.test.ts` 9 s after the fix (00:52:35), and the full suite (00:53:26 to 00:57:34; 3 failed, 1,557 passed). Its brief required the full suite and pasted output, which the primer allows ("when the repository's own gate requires it"). Squeal did not change which tests it ran. It did not wait for Squeal's green after the fix, and its reasoning is encrypted, so why is not on record. When it ran the full suite, Squeal's baseline had not completed: 129 test files were still without checks at 00:57:51, nine minutes in.

### False, late, repeated or missing

- **False:** the heap test stayed a current failure at revision 3 after the fix made it pass (defect 5). It is the one false statement in the session. The agent caught it only because it had run the test itself.
- **Late:** the first result for the agent's new test took 2 min 7 s at load 80 against a cold baseline. The `--wait 60000` timed out, and the agent ran the test itself. The adapter delivered at the first tool call after each result where the time is known (S5). The lateness was upstream of it.
- **Repeated:** nothing. The headers of S3 to S5 each name revision 3's changed files again, which is the header's job.
- **Missing:** the heap test's `FAIL -> PASS` (defect 5). The daemon note about missing dependencies came 0.9 s after the header that could have carried it, and was never pushed. That is harmless here, since the brief ran `npm ci` first.

### Defects

Numbered after the proof's defects 1 to 3.

4. **Under Codex the agent's `squeal` does not resolve, while the primer and the skill tell it to run `squeal status --wait 60000`.** Codex adapter, D1 and the primer. In the worker's shell `command -v squeal` printed nothing. The worker found `node plugins/codex/dist/cli/squeal.mjs` only because this repository is Squeal's own, and that file was its branch's bundle, stale against the branch's source (S4). D1 says the agent's `squeal` "comes from the npm install", but `package.json` is `"private": true` and the npm name `squeal` belongs to an unrelated package ("Create your SQL more easily.", 0.4.1). `npm i -g squeal` would install that one. In any other repository a Codex agent cannot run the one command the primer names. A fix within 002: the Codex SessionStart and SubagentStart text names the installed CLI by its absolute path, `node <plugin root>/dist/cli/squeal.mjs`, since the hook knows its root. The skill copy would say the same.
5. **A test that loads the source in a child process keeps a stale failure as current.** Repository config, seen with 003-27's new test. `test/runners/node-test/graph-memory.test.ts` imports `src/runners/node-test/graph/index.ts` only inside `execFileSync(process.execPath, [..., "-e", <module text>])`. The closure (static imports plus declared inputs) does not contain the graph sources, and `squeal.config.json` declares no inputs for the file. Its key at revision 3 therefore equals revision 2's, and Squeal served revision 2's failure as `validity: current` at revision 3 and never re-ran it. The same config lists `plugins/claude-code/**` for `test/e2e/*.test.ts`, which also drive `plugins/codex` (`test/e2e/plugins.ts`), and declares nothing for `test/harness/codex/plugin.test.ts`. Those two are from reading the config, not seen failing. Fix: declare the inputs, e.g. `"test/runners/node-test/graph-memory.test.ts": ["src/runners/node-test/**"]`, and add `plugins/codex/**` to the e2e and Codex plugin entries. 001 may want a rule that a test file which spawns `process.execPath` gets a note.
6. **`test/harness/latency.test.ts` (Claude Code hooks) times out at its 180 s limit under load instead of reporting.** 001 test. In the worker's full suite at load 66 to 85 it was one of the three failures: "Test timed out in 180000ms". The Codex twin finished and printed its table at load 75.7. A gate that must report timing failures "as such" should not have one that dies of its own timeout.

### Notes for the next row

- To check goal 7 in a real Cezar session, hook durations must be recorded somewhere. Codex's app-server sends `hook/completed` to its client, and Cezar does not log it. A store row would not help, because it goes with the worktree.
- 65 of this GPT agent's 66 tool calls were shell commands, its new test file and every note included; its one `apply_patch` was the source fix. The deny of goal 3 covers a small share of such an agent's edits, by design (D3: shell writes are never denied).
