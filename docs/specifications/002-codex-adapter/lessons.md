# 002 Codex adapter: proof lessons

Task 002-16, 2026-10-07. Squeal plugin 0.1.21 from `faa202d`, installed into a scratch Codex home with Codex's own commands and trusted in the TUI, run with the real Codex CLI 0.160.1 and model on small Vitest repositories. Probes, prompts and trimmed logs: `research/probes/proof/` (its README holds the rules followed). Inputs: the brief in `tasks/wave-2.md`, `reviews/wave-1.md` N4 and N5.

## Verdict

The shipped Codex plugin does what goals 1, 3, 5 and 6 say, under `codex exec` and under a Cezar-shaped app-server thread. Every proof item is proven, in both modes where it applies. In the three working sessions (exec1, as1, as2) 11 transition reports reached a model, each at the first hook that could carry it, none twice, all in the turn that caused them. The `apply_patch` deny fired once per regression and the model re-issued the edit unprompted. No agent ran Vitest itself.

Two things fall short. First, an inline `/review` thread fires Squeal's hooks as the main agent and takes the main agent's undelivered report (defect 2, review N4 confirmed). Second, the per-tool 80 ms p95 of goal 7 was met only in the bundle test, not in real sessions, and never at calm load: the host stayed between load 7 and 34 for the whole task (N5 below). No hook failed, timed out or exceeded 375 ms in 142 runs, so the 2 s budget held everywhere.

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

Confirmed, defect 2. In n4inline a silent logging hook in the scratch user layer recorded every hook's stdin (`logs/n4inline.stdin.jsonl`). The inline review ran in its own thread (rollout `...-c375-70b1-aedb-8be359068163`, `source: {"subagent": "review"}`), but its UserPromptSubmit, PreToolUse and PostToolUse carried the parent's `session_id`, no `agent_id` and no `agent_type`, a new `turn_id`, and the review's own `transcript_path`. No SessionStart, SubagentStart or Stop fired for it. Codex reported the runs under the parent's thread id.

So Squeal took the review for the main agent. The outside edit's `PASS -> FAIL` was recorded and undelivered when the review started; the review's UserPromptSubmit returned it (`logs/n4inline.hooks.jsonl`, +14,084 ms) and marked it delivered to `(session_id, main)`:

```text
[userPromptSubmit, review turn] SQUEAL · 1 check changed at revision 1
FAIL  test/math.test.js > mul multiplies
      PASS -> FAIL, seen by Squeal's run at revision 1
      expected 5 to be 6 // Object.is equality
```

The main agent's next UserPromptSubmit and Stop said nothing. It learned of the failure only because the reviewer wrote "which Squeal reports as failing" into a finding that Codex copied into the main thread. A review that did not mention it would have lost the report. The review also got no primer, and its turn ended with no Stop, so the main consumer stayed in a turn until the next prompt. `delivery: "detached"` is not available for an app-server thread ("paginated threads do not support detached review"), so inline is the case that matters for Cezar and the TUI.

## Review wave 1, N5: Stop p95 at calm load

Not shown at calm load, because the host's load average never fell below 4 during the task (7.5 to 34). Measured instead:

- `test/harness/codex/latency.test.ts`, at load 17.18 (`logs/latency-1.txt`): Stop p95 86 ms, Stop (silent) p95 103 ms, SubagentStart p95 129 ms, all others 67 to 81 ms. The test reports and does not assert above load 4.
- Real sessions, Codex's own `durationMs` at load 9 to 34 (`logs/hook-durations-all.txt`): Stop p50 110, p95 259 ms over 9 runs; PostToolUse p95 195 ms over 51; PreToolUse p95 209 ms over 54. In nd-r9, where the fast path ran, PreToolUse and PostToolUse took 1 to 2 ms.

Every one is far inside the 2 s timeout. Whether Stop stays under 80 ms p95 at calm load, as 002-14 measured (76 ms at load 3.9), is still open.

## Defects

1. **The daemon cannot start in a repository whose `node_modules` is a symlink.** Core (001), not the Codex adapter. `squeal start` in r1 with `node_modules -> /tmp/p16/nm/node_modules` printed "Daemon: running", then the daemon exited: "could not start: squeal: git check-ignore -z --stdin exited 128 [...] fatal: pathspec 'node_modules/.package-lock.json' is beyond a symbolic link" (`logs/symlink-node-modules.status.txt`). Every later hook spawns a daemon that dies the same way (nd-r6), so the repository is never validated. `git check-ignore` rejects the whole batch for one path under a symlinked directory. Repositories and worktrees that link a shared `node_modules` are common.
2. **An inline `/review` thread takes the main agent's undelivered report.** Codex adapter, review N4 above. Its hooks carry the parent's `session_id` and no `agent_id`, so `(session_id, main)` is marked told while the main agent never sees the report. Stdin tells the threads apart only by `transcript_path` and `turn_id`.
3. **A hung daemon leaves edits unannounced.** Core (001 D9 and D10), seen in nd-r5. With the daemon stopped, an edit got no report and no "no daemon is validating" line at PostToolUse, unlike nd-r6, where the daemon was dead. The only signal was a clause in the registration header, and the agent summarised the session's Squeal messages as "Known failures: 0". 001's lessons (D1) saw the same header and an agent that read it; this agent did not.

## Notes for the next row (002-19, dogfooding)

- The TUI starts Codex's managed app-server daemon inside `CODEX_HOME`, and it downloaded and ran Codex 0.161.0 there, not the installed 0.160.1. TUI threads therefore run a Codex version the hash port was not checked against. The plugin hashes are Codex's own and survive that; `--print-launcher-config` hashes might not.
- An `apply_patch` context mismatch cost each of the four scripted agents (exec1 and as2, main and subagent) one failed call; nothing to do with Squeal, but such calls count in any per-call measurement.
- Spec open question 5 (a long-running command that yields to `write_stdin`) was not exercised: every command here finished within its yield time.
