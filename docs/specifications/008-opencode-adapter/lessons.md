# 008 OpenCode adapter: dogfooding lessons

Task 008-20, 2026-10-15. Squeal 0.1.184 (main `4c6d1176`) installed into a real OpenCode 1.18.35 with its own `install.sh`, updated with `squeal update` to a later archive while a TUI session was open, and used by real models on remeda through Cezar-shaped `opencode serve` sessions, `opencode run` and the TUI. Scripts, scenarios and condensed logs: `dogfood/` (its README lists them). Inputs: the brief in `tasks/wave-2.md`, `reviews/wave-2.md` (Inputs for the next wave), the human's model rule of 2026-10-14.

## Verdict

The OpenCode package does what goals 1, 3, 5, 7, 8 and 9 say with real models, and goal 4 under `serve` and the TUI. Across seven working sessions, 33 Squeal texts reached a model, the registration headers included: 18 appended to a tool result, 14 as user text and 1 as a denied edit. Each came in the request after the tool call or idle at which its result became known, and none came twice. One `edit` in a parallel batch was denied with the regression entries and re-issued in the next request. All 103 agent requests of the sessions in a Squeal repository carried the primer, including OpenCode's compaction request, the first request after `/compact`, and a `task` subagent's requests. No agent ran Vitest. grok-4.7 ran `npm run test:types` and `npm run check`, which Squeal does not cover, after waiting on Squeal's `status --wait`.

Open question 4 is answered for the three models: each read a Squeal continuation or wake, which OpenCode sends with the `user` role, as Squeal's report, not as the user's words. grok-4.7 said: "Those two, plus this question, are the messages from you. The other message was Squeal reporting 32 test failures. It did not ask me to fix or revert anything." No model widened the user's scope because of a report.

The update behaves as D1 says. `squeal update` repointed `current` to the new version and kept the old directory. The open TUI went on running the version it loaded: the primer's CLI, the idle waiter and the daemon all stayed 0.1.184, and it still delivered, including a wake. After `/exit` and `opencode -c`, the new version ran.

One defect touches a goal: under `opencode run`, news known before the turn's idle is never stored as a continuation (defect 1, goal 4 and D5). It is not lost: the next prompt's registration header carries it. Two defects mislead a user who has not set the repository up: the `squeal status` line, and setup in an OpenCode-only home (defects 2 and 3). Two text slips (defect 4). None blocks shipping 008.

| Goal or question | Holds? | Model, session | Evidence |
| --- | --- | --- | --- |
| 1. `PASS -> FAIL` in the result of the tool call during which it became known, and it changes what the agent does | Yes | gpt-6-astra s1, grok-4.7 s2, gpt-6-luna s5 | Goal 1 below |
| Agents leave the tests to Squeal | Yes | all | No Vitest command in any session; grok-4.7 ran the typecheck project Squeal does not run (Observation 2) |
| 3. The next edit after an undelivered regression is blocked once, re-issuable | Yes | grok-4.7 s2 | Goal 3 below |
| 4. One continuation with news, none without, never twice | Yes under `serve` and the TUI; under `run` the continuation is never stored | grok-4.7 s2, gpt-6-luna s4; gpt-6-astra s3, gpt-6-luna s3b | Goal 4 below; defect 1 |
| 5. The primer in every request, after compaction and in a subagent | Yes | all; compaction and subagent in s5 | Goal 5 below |
| 7. An idle agent woken once with news (`serve`, TUI) | Yes | gpt-6-luna s4b (`serve`), s5 (TUI, after the update) | Goal 7 below |
| 8. OpenCode's own install, no trust step, no Squeal file under OpenCode's config; the status line | Install yes; the status line prints, but names the wrong cause | gpt-6-luna s0 | Goal 8 below; defect 2 |
| 9 (seen in passing). A subagent is its own consumer | Yes | gpt-6-luna s5 | Goal 5 below |
| Open question 4: a continuation or wake read as Squeal's, not the user's | Yes, three models of three | all, asked directly in s1, s2, s3, s4, s4b | Open question 4 below |
| Update with a session open (D1) | Yes | gpt-6-luna s5 | Updating below |

## Setup

| Item | Value |
| --- | --- |
| Where | Only as `squeal-e2e`, through `dogfood/as-user.sh`. Every inherited variable is dropped. `HOME`, `TMPDIR` and the four `XDG_*` directories are under `/home/squeal-e2e/dogfood-008`, with `OPENCODE_DISABLE_AUTOUPDATE=1` and `OPENCODE_DISABLE_MODELS_FETCH=1`. The `PATH` holds the launcher's `~/.local/bin`, a `bin/` with only `opencode` (1.18.35 from squeal-e2e's npm prefix), Node 24.21.0, `/usr/bin` and `/bin`, so `claude`, `codex` and `pi` were not on it. The agent user's OpenCode directories were never touched. |
| Models | `cliproxy`, through `dogfood/proxy.mjs` on 127.0.0.1:47320. The proxy adds `CLIPROXY_API_KEY`, which only the proxy process holds (passed by name with `sudo --preserve-env`), and logs each request body, never a header. OpenCode's provider (`@ai-sdk/openai-compatible`) has a placeholder key. This is stricter than the brief's `apiKey: "{env:CLIPROXY_API_KEY}"`, which would put the key in OpenCode's environment and so in every agent shell. Tiers: `gpt-6-luna` where the daemon is the subject (s0, s3b, s4, s4b, s5), `gpt-6-astra` for ordinary tasks where the reading matters (s1, s3), and `grok-4.7` (s2). No Claude model (the human's rule). |
| Install | `install.sh` of 0.1.184 (`git show 4c6d1176:install.sh`) with `SQUEAL_SOURCE=file://…/src`, which holds a `git archive` of `4c6d1176` named as the tag archive. The later version is 0.1.190: the same tree with every `0.1.184` in `install.sh`, `package.json` and `plugins/` replaced. It stands in for the next release; the only later candidate, `cand/0.1.185`, does not contain 0.1.184's OpenCode changes. So the update proves the mechanics (repoint, keep, which version an open session runs), not a code change. |
| Project | remeda (`github.com/remeda/remeda` at `8e6e78f6`, 2026-10-04), cloned from 009-20's clone. It is a TypeScript utility library, an npm-workspaces monorepo whose `packages/remeda` has 175 Vitest runtime files and 142 typecheck files: 2,413 checks. Chosen as 009-20 chose it: real, in the size range, fast, with a widely imported core (`purry` re-keys 125 files). Being the same project as 009-20, it also allows a direct comparison with Pi. Setup was `npm ci`, `squeal setup --yes --no-warmup` (defect 3), then `squeal setup --yes` with the warm-up, `npm run build` in `packages/remeda` (7 files import the built package; 009's Observation 4) and `squeal run --all --force`: 2,411 passed, 0 known failures. |
| Drivers | `serve`: `dogfood/cezar-drive.mjs` runs the installed Cezar 0.16.0-dev.1634 `OpencodeServerRunner` (sha256 `20b478af…`), copied unchanged, in persistent mode, the shape of an interactive Cezar step. Each prompt is sent `gapMs` after the previous turn-end; afterwards the server stays open until quiet. `run`: `dogfood/run.sh`, `opencode run --format json`. TUI: `dogfood/tui.sh`, OpenCode in a 200x50 tmux window, with keys sent and the screen captured. |
| Machine | Linux 6.8, 24 cores. Sessions started only below load 24, after `dogfood/gate.sh`. The first one waited 25 minutes for the load to fall from 177. Other work on the host pushed the load to 97 during s2. The load is recorded beside each session. |

## Sessions

| Id | Mode, model, Squeal | Load at start (range) | Prompt (shortened) | Squeal said | Agent did |
| --- | --- | --- | --- | --- | --- |
| s0-nostore | `run`, gpt-6-luna, 0.1.184, before the warm-up (no store) | 21.8 (19.8 to 21.8) | run `squeal status`, quote it | the `OpenCode:` line (defect 2); no primer, since the plugin's fast path saw no Squeal repository | Quoted it |
| s1-astra | `serve` (Cezar), gpt-6-astra | 20.6 (5.5 to 20.6) | 1: `purry` throws a `RangeError` naming the counts, "only edit src/purry.ts"; 2: "did anyone ask you to fix, revert or change anything? Quote who said what" | registration; `PASS -> FAIL` in `purry.test.ts` (with its `status --wait`); then `FAIL -> PASS` | Kept the old message text inside the new one so the test passes, still only in `purry.ts`; waited with `status --wait`; answer 2 below |
| s2-grok | `serve` (Cezar), grok-4.7 | 19.8 (10.6 to 97.0) | 1: `words` keeps digits in a word, "do whatever else that change needs"; 2: also `_`, "only edit words.ts … reply DONE as soon as the edit is made"; 3: "who said what" | registration; 11 reports after tool results; one deny of an edit to `words.test.ts` with 10 `PASS -> FAIL`; at run 2's idle a continuation with 32 `PASS -> FAIL` | Re-issued the denied edit at once; updated types and tests in run 1; ran `test:types` and `check` itself; in run 2 answered the continuation within scope; answer 3 below |
| s3-run | `run`, gpt-6-astra, then `run --continue` | 10.6 (9.6 to 10.6); 7.1 | 1: `chunk` returns `[]` below size 1, "do not edit any test file … reply DONE as soon as the edit is made"; 2: "anything I should know since my last message? List each message after it and who sent it" | run 1: nothing (the regression was known before idle, but no continuation was stored: defect 1); run 2: a new registration header carrying the 2 known failures | Run 1 exited 0.6 s after "DONE"; run 2 named the failures as from "Squeal background checker, attached to your latest message" |
| s3b-run-luna | `run`, gpt-6-luna, `--print-logs` | 5.3 (3.3 to 5.3) | as s3 run 1 | as s3 run 1 | Reproduced defect 1 with OpenCode's log |
| s4-luna-wake | `serve` (Cezar), gpt-6-luna | 4.6 (2.7 to 4.6) | `purry` as s1, but "do not run, wait for or check anything; reply DONE"; then "who sent each message" | `purry.test.ts` ran first, so the `PASS -> FAIL` was known 1 s before idle: a continuation with 1,629 checks still pending; the other 105 files passed, so no wake | "Squeal reports the existing test still expects the old message; I left the test untouched per your scope." |
| s4b-luna-wake | `serve` (Cezar), gpt-6-luna | 3.2 (2.6 to 3.4) | write a test that waits 10 s then fails, "reply DONE as soon as the file is written"; then "who sent each message" | a wake 11.2 s after the turn ended, carrying the new failure | Answered the wake; listed it as Squeal's |
| s5-tui | TUI, gpt-6-luna, 0.1.184 → [`squeal update` to 0.1.190 while open] → `/exit`, `opencode -c` on 0.1.190 | 2.9 (2.7 to 5.1) | `capitalize` lowercases the rest; [update]; revert; the slow failing test; `/compact`; a `task` subagent deletes the test and reports; [restart]; `capitalize` again | registration; reports; a wake; the subagent's own registration header with the known failure | Stayed in scope, reported from Squeal, ran no tests |

## Goals

### Goal 1. A `PASS -> FAIL` in the result of the tool call during which it became known: seen

s1, request 6. The `bash` call the model made after its edit was the primer's `status --wait`. Its result came back with the report appended after a blank line:

```text
- tool result: Returned on quiet: nothing the edits since revision 1 re-keyed is pending (90 test files) at revision 1 after 6.7 s
  [...status...]

SQUEAL · 1 check changed (1 test) at revision 1
Revision 1 (changed packages/remeda/src/purry.ts): 2413 current (2238 tests, 175 test files loaded), 0 pending, [...]
Squeal saw your edit; all 125 test files it re-keyed are current, and passing results stay silent.

FAIL  packages/remeda/src/purry.test.ts > wrong number of arguments
      PASS -> FAIL, seen by Squeal's run at revision 1
      expected [Function] to throw error including 'Wrong number of arguments' but got 'purry: expected 1 or 2 arguments, rec…'
```

It changed what the agent did. Under "only edit src/purry.ts", astra re-edited `purry.ts` so the new message still contains "Wrong number of arguments", and the next report was the `FAIL -> PASS`. In s2, grok-4.7 received 11 reports appended to tool results, its edits' `PASS -> FAIL` among them, and used them to align the case-conversion types and tests. That was in its first run, where the user had said "do whatever else that change needs". In s5, luna answered each "tell me what Squeal reported" from the reports. Per session (`dogfood/logs/stats.txt`): s1 2 after a tool result, s2 11, s5 4. Each session's registration header also arrived in its first user message.

### Goal 3. The next edit after an undelivered regression is blocked once, then can be re-issued: seen

s2, request 16. grok-4.7 answered with nine parallel edits: `words.ts`, `words.test.ts`, three case-conversion sources, three `*.test-d.ts` and `toTitleCase.test.ts`. The edit to `words.test.ts` came back as an error result: the report, then the deny sentence. The other eight were applied:

```text
SQUEAL · 10 checks changed (10 tests) at revision 4
[...10 PASS -> FAIL entries...]
Squeal policy interrupt.onRegression denied this edit call, so the edit was not applied. The same call can be re-issued; this regression does not deny again.
```

The model's next answer, request 16 itself, was the same `edit` of `words.test.ts`, and it applied. Nothing was denied twice. As in Pi (009-20's Observation 2), the deny falls on one call of a parallel batch, so the batch ends half applied until the re-issue.

### Goal 4. One continuation with news, none without, never twice: seen under `serve` and the TUI; not stored under `run`

- s2 run 2 (`serve`). The model ended with "DONE" at 01:30:11.8. The next request, at 01:30:12, was Squeal's continuation: a `user` message with the 32 `PASS -> FAIL` the `_` change caused. The model answered it in one turn ("Those failures are from keeping `_` inside the word. `words.ts` is the only file I changed, as requested.") and the session went idle with no further request.
- s4 (`serve`). The failure was known 1 s before idle (Squeal ran `purry.test.ts` first), so it went out as the continuation, with "1629 pending". The other 105 files then passed: no further request, correctly.
- s1, s5. Turns whose results were already delivered ended with no extra request.
- Under `run`, the continuation is never stored: defect 1.

### Goal 5. The primer in every request, after compaction and in a subagent: seen

Every agent request of s1 to s5 has the primer in a system message: s1 8 of 8, s2 48 of 48, s3 5 of 5, s3b 5 of 5, s4 7 of 7, s4b 4 of 4, s5 26 of 26. s0's two have none, as D4's fast path intends, because remeda had no store yet. In s5 it was in:

- OpenCode's compaction request (request 16, "Here is the conversation so far").
- The first request after `/compact` (request 17).
- All three of the `task` subagent's requests (18 to 20).

The subagent was its own consumer: its first request carried its own `SQUEAL · registered at revision 40` header with the known failure. It deleted the test, waited with the primer's `status --wait`, and reported "0 known failures". The CLI the primer names is the version directory's (`…/squeal/opencode/0.1.184/dist/cli/squeal.mjs`), not `current`. So an open session's primer keeps naming the CLI of the version it loaded across an update, and 0.1.190 after the restart.

### Goal 7. An idle agent woken once with news: seen under `serve` and in the TUI

Squeal runs the tests an edit touches first, so in ordinary edits the news was known before the turn ended and went out as the continuation (s2, s4). To get news after idle, s4b and s5 had the model write a test that waits 10 s and then fails.

- s4b (`serve`, Cezar's runner). The turn ended at 01:54:18.55. Squeal saw the failure at 01:54:27.883 (`squeal why`). The next model request was at 01:54:28, a `user` message with the report, which nobody prompted. The model answered "Squeal reports it failed as expected", and nothing more came until the driver's next prompt 79 s later.
- s5 (TUI, after `squeal update`, still on 0.1.184). After "DONE", the wake came about 10 s later, at 01:59:51. The TUI shows it as a user message headed `SQUEAL · 1 check changed (1 test) at revision 40` (`dogfood/logs/s5-tui.screens.txt`).

In Cezar's runner the woken turn produced `text` events after the last `TURN-END`, with no `turn.started` or `turn-end` of its own (`dogfood/logs/s4b-luna-wake.cezar-events.txt`). This is what research 2 inferred for open question 5.

### Goal 8. OpenCode's own install, no trust step, no Squeal file under OpenCode's config: seen; the status line: misleading

`install.sh` of 0.1.184 unpacked the package and pointed `current` at it. It then ran `opencode plugin file:…/squeal/opencode/current -g`, which wrote the `plugin` line into `xdg/config/opencode/opencode.json` and a `.gitignore` beside it (`dogfood/logs/install-0.1.184.txt`, `tree-*.txt`). After that, it copied the launcher. Every later session loaded the plugin with no trust step.

At the end, OpenCode's config directory held:

- `opencode.json`: written for this task, plus OpenCode's `plugin` line.
- `.gitignore`: written by OpenCode's `opencode plugin`.
- `package.json`, `package-lock.json` and `node_modules`: written by OpenCode at its first session, for `@opencode-ai/plugin` (research 4).

No file there was written by Squeal. Squeal's own files are under `xdg/data/squeal/opencode/` and `xdg/state/squeal/installed`.

In s0, an `opencode run` in remeda before any store existed, the agent ran `squeal status`:

```text
Status unavailable, no Squeal store at /home/squeal-e2e/dogfood-008/remeda/.git/squeal/store.sqlite
OpenCode: this shell runs under OpenCode (OPENCODE=1) without OPENCODE_SESSION_ID, so the Squeal OpenCode plugin did not run in this session. Install it with curl -fsSL https://github.com/hearsay-tools/squeal/releases/latest/download/install.sh | sh, then start OpenCode again.
```

The line appears as D7 says, but the plugin was installed and loaded. It returned no hooks only because the repository was not set up: defect 2.

## Open question 4: does a model read a Squeal continuation or wake, a user message, as Squeal's report?

Yes, for the three models, and for both forms the user-role text took: a continuation at idle (s2, s4), a wake (s4b), and a registration header added to the user's next prompt (s3). Each was asked who said what after the report arrived:

- grok-4.7, s2, after run 2's continuation of 32 failures: "Yes. You asked for both changes. Nobody asked me to revert or fix the later failures. […] Those two, plus this question, are the messages from you. The other message was Squeal reporting 32 test failures. It did not ask me to fix or revert anything."
- gpt-6-astra, s1 (reports after tool results, not a user message): "**Squeal**, automated feedback after my first edit: […] That was a test failure report, not a request from you. I independently changed the message to retain `"Wrong number of arguments"` […] The original request and your current question came from you. The Squeal reports and tool results did not."
- gpt-6-astra, s3 run 2: here the report was a part of the user's own message, so this is the hardest case. It answered: "**Squeal background checker**, attached to your latest message: Reported **two failing tests** […] Both failures are expected because those tests still require throwing. Squeal ran automatically; I did not run, wait for, or check tests. No test files were edited."
- gpt-6-luna, s4, after a continuation: "1. A SQUEAL status message — sent by the SQUEAL system. 2. A SQUEAL test-failure report — sent by the SQUEAL system. No one asked me to change anything after your first message."
- gpt-6-luna, s4b, after a wake: "**Squeal:** Reported the test was queued at revision 36, then reported it failed because `1` did not equal `2`."

No model treated a report as a request to change something outside the user's words. Under "only edit src/purry.ts" (s4) and "only edit src/internal/words.ts" (s2), both continuations were answered by naming the failures and leaving the tests alone. Pi's grok-4.7 had widened such a scope once (009-20 Observation 3); OpenCode's grok-4.7 did not here, with one try each.

## Updating with a session open

All in s5: one TUI process, then a restart (`dogfood/logs/update-184-to-190.txt`, `s5-ps-*.txt`, `tree-after-update.txt`).

1. 0.1.184 loaded. The daemon, the idle waiter (`0.1.184/dist/hooks/wait.mjs`, a child of OpenCode) and the primer's CLI all ran from `…/opencode/0.1.184/`.
2. `squeal update` from another shell (the launcher, with `SQUEAL_INSTALL_SH=file://…/install-0.1.190.sh`) did four things. It ran `install.sh --opencode`, which unpacked 0.1.190 and ran `ln -sfn 0.1.190 …/current`. It did not run `opencode plugin` again, since the config already listed `current`. It said "OpenCode sessions already open keep the Squeal they loaded until they restart". Finally it printed `OpenCode: Squeal 0.1.190, was 0.1.184`. Both directories stayed, the install record lists both, and OpenCode's config was unchanged. The launcher, which picks the newest package, reported 0.1.190.
3. The open TUI kept working on 0.1.184. A revert's result reached the model through the primer's `status --wait` ("Known failures: 0"); the next prompt's waiter was again `0.1.184/dist/hooks/wait.mjs`; the wake of goal 7 came through it, and the primer still named the 0.1.184 CLI (requests 10 to 22, after the update at 01:58:37).
4. After `/exit`, within 5 s nothing of 0.1.184 ran: `dispose` stopped the waiter, and the daemon stopped once no session was registered (`s5-ps-after-exit.txt`).
5. `opencode -c` (the same session) loaded 0.1.190. The daemon and the waiter now ran from `0.1.190/`, the primer named the 0.1.190 CLI (requests 23 on), and the `capitalize` edit's five failures were reported through `status --wait`, the 0.1.190 CLI's.

So the update does what D1 says. Not seen: a second session on 0.1.190 alongside one still on 0.1.184, which would make the newer daemon take over from the running older one, as 009-20 saw in Pi. An update with an older directory beyond the kept one was not seen either. That was the only update, so nothing was removed.

## Defects

1. **Under `opencode run`, news known before idle is never stored as a continuation.** Plugin, D3's idle and D5. Severity: does not block shipping. The news reaches the model at the session's next prompt, inside its registration header, and `squeal status` shows it all along. But goal 4 and D5 say the continuation is stored and read at the next resume, and a user who resumes days later may not resume at all.

   Observed twice:
   - s3, gpt-6-astra. `squeal why` shows `PASS -> FAIL` at 01:35:36.111Z, 1.6 s before the model's "DONE" (request 6, answered at about 01:35:37.7). `run` exited 0.6 s after "DONE". `opencode export` of the session shows the user prompt, Squeal's registration part, and "DONE", with no Squeal message after it.
   - s3b, gpt-6-luna with `--print-logs`. `PASS -> FAIL` at 01:38:25.318Z. OpenCode logged `exiting loop` at 01:38:26.531Z and `disposing instance` at 01:38:26.540Z, 9 ms later. Again no message after "DONE" in the export.

   On `--continue` (s3 run 2) the consumer registered afresh, and its header carried `Known failures: 2` with both entries, without the `PASS -> FAIL` lines. The earlier consumer's undelivered delta ended with its unregistering at `dispose`.

   Likely cause: `run` disposes the instance about 10 ms after the first idle. OpenCode does not await `event` hooks (008-17), so the idle handler's Stop bridge, a Node process started at idle, cannot answer before `dispose`, and after `dispose` "every hook is silent". The research's r1 proved a stored message only for a `promptAsync` called synchronously inside the hook, with no bridge in front of it.

   Proposed row: **008-25 the continuation under `opencode run`**. First reproduce it in the end-to-end suite with the scripted provider: news ready before idle under `run`, then `run --continue` asserts the stored message. Then either have `dispose` finish the in-flight Stop and call `promptAsync` within its 3 s deadline (if OpenCode awaits `dispose` before exit), or amend goal 4 and D5 to what happens: under `run` the news arrives in the next prompt's header.

2. **`squeal status` blames a missing plugin when the repository is not set up.** D7, CLI. Severity: does not block shipping; misleading. In s0 the plugin was installed and loaded, and returned no hooks because remeda had neither `squeal.config.json` nor a store (D4's fast path). `squeal status` said "the Squeal OpenCode plugin did not run in this session. Install it with curl … install.sh | sh". Following that advice reinstalls what is installed, and the next session is silent again.

   Proposed row: **008-26 the status line's causes**. With `OPENCODE=1` and no `OPENCODE_SESSION_ID`, check first whether this worktree passes the plugin's own fast-path test. If not, say the repository is not set up for Squeal (run `squeal setup`), and keep the install advice for when it is set up. A CLI unit test for each cause.

3. **`squeal setup` does not know OpenCode, and with `--no-warmup` it leaves the plugin off.** Setup (005 D3), OpenCode-only home. Severity: does not block shipping. The plan lists only `claude-code: not on the PATH` and `codex: not on the PATH`. It says `AGENTS.md (also CLAUDE.md): read by claude-code and codex`, though OpenCode reads `AGENTS.md` too, and it has no OpenCode line (`dogfood/logs/setup-plan.txt`). This is 009-20's defect 3 for Pi, again.

   Worse for OpenCode: `squeal setup --yes --no-warmup` ended with "Changes: none to tracked files", so the repository had no config and no store, and the plugin's fast path keeps Squeal off in it (s0). Only the warm-up (the default) creates the store.

   Proposed row: widen **009-26 setup knows Pi** and **009-28 Pi in the harness facts** to OpenCode (on the PATH, the install state from `current` and OpenCode's config, among the `AGENTS.md` readers). With OpenCode present, setup always leaves the repository recognisable: a store or a config, warm-up or not. This crosses 005 D3; tell the 005 coordinator.

4. **Two texts written for another harness.** Severity: wording.
   - (a) `squeal update` with only OpenCode ends "A running session keeps the version it loaded until it restarts, or until /reload-plugins in Claude Code."
   - (b) A wake or continuation that carries the result of a newly created test file (s4b, s5) still says "Squeal saw your edit and queued 1 test file; results arrive with later tool calls, and passing ones stay silent", with "0 pending" in the same message. That is the edit acknowledgement's sentence, in the message that is the result.

   Proposed row: **008-27 harness-aware texts**. Name only the harnesses being updated in (a), and drop the queued sentence when nothing is pending in (b). (b) is in the shared report, so it crosses 001.

## Observations

1. **Results usually beat the end of the turn.** Squeal runs the test files an edit touches first, and a remeda run takes 0.6 s (one file) to 7 s (125 files). So in ordinary edits the news was known before the model's last request finished, and went out after a tool result or as the idle continuation. A wake needed a test that is itself slow. Goal 7 holds, but in a fast suite users will mostly see continuations, which are the path under `run` where defect 1 bites.
2. **The Vitest typecheck project.** As in 009-20 Observation 1: remeda's `types` project (142 `*.test-d.ts`) is not run by Squeal. Per edit Squeal says "No result for … Run whatever tests it yourself", and grok-4.7 ran `npm run test:types` and `npm run check` after `status --wait`, three times. That is the primer's instruction, not a defect; the 001 or 005 row 009-20 proposed covers it.
3. **OpenCode itself sometimes started slowly in the sandbox, not because of Squeal.** OpenCode's config-and-plugins phase took about 0.3 s in five sessions, 7 s in s0 and 44 s in s3b. A probe with the plugin removed from a fresh config directory hung in the same phase, at OpenCode's own install of `@opencode-ai/plugin` into the config directory, because `as-user.sh` drops proxy variables. So it is OpenCode's dependency install, not Squeal's init, whose fast path and `node --version` are all it does. Not attributed further; it matters only for timing these sessions.
4. **Cezar and the wake.** Cezar's persistent runner emits a woken turn's text with no turn boundary of its own (goal 7 above). An interactive Cezar step therefore shows the wake's reply in its transcript, but Cezar does not count it as a turn. The non-interactive step's auto-end (250 ms after idle) was not run here, so whether a later wake dies with the server, as research 2 inferred, is still inferred. This is input for open question 5.
5. **The idle waiter runs as OpenCode's child.** In the TUI, `hooks/wait.mjs` was a child of the `opencode` process and was gone within 5 s of `/exit`. The daemon ran detached, with parent 1 (the subreaper), and stopped by itself 3 s after the last session ended (001 D10). Nothing Squeal started outlived a session needlessly. After `opencode run`, the daemon stayed (s3), as D8 says.

## Cleanup

At the end (2026-10-15 04:04, load 4.2) nothing ran as `squeal-e2e`: no OpenCode, no Squeal daemon or waiter, no proxy, no tmux server (`ps -u squeal-e2e` empty). The remeda clone is clean at `8e6e78f`. During this task the 001 coordinator reported that 0.1.185 landed on main (`32e25666`); nothing here depends on it.

Kept in `/home/squeal-e2e`: `dogfood-008/`, which holds everything below it:

- the sandbox `home/` with the launcher;
- `xdg/`, with OpenCode's config, database and logs, and Squeal's 0.1.184 and 0.1.190 packages;
- the remeda clone;
- the raw proxy logs;
- the archives;
- Cezar's copy;
- `scripts/`.

Also kept: the npm prefix `.npm-global` and `.npm`, and the earlier probe directories (`008-plugins`, `008-sessions`, `opencode-isolation`, `opencode-wave0`). Left for their owners and untouched: `dogfood-009`, `runs`, `pee`, `.codex`, `.nvme-check-*`, and the dotdirs `.cache`, `.config` and `.local`, which hold earlier probes' OpenCode files.

## 008-30: defect 1 re-checked on 0.1.186

Task 008-30, 2026-10-15. The same sandbox, OpenCode 1.18.35, remeda and Cezar copy as above, with Squeal 0.1.186 (main `b4067d55`, whose product tree is `f555ac44`'s), gpt-6-luna only. Records: `dogfood/logs/030-*`, `install-0.1.186.txt`, `prep-0.1.186.txt`, `stats.txt`. Times are UTC.

### Verdict

Defect 1 is fixed. In both `opencode run` sessions, news known before idle was stored in the session as one synthetic Squeal user message during `dispose`, before `run` exited, with no model request. The next `opencode run --continue` read it once, and luna named it as Squeal's. Goal 4 holds under `run`.

The Cezar-shaped `serve` session got two continuations in a row: defect 5. The first carried the `PASS -> FAIL`. Luna re-edited during that continued turn. The second followed its idle 0.39 s later and carried the edit's `FAIL -> PASS`. Goal 4 says never twice in a row.

| Question | Holds? | Evidence |
| --- | --- | --- |
| Under `run`, news known before idle is stored as one Squeal message that `run --continue` reads (goal 4, D5) | Yes, 2 of 2 | 030-s3, 030-s3b below |
| Under `run`, a turn with no news stores nothing | Yes, 2 of 2 | Each `--continue` run ended with no news, and nothing was stored after its answer |
| A Cezar-shaped `serve` session gets exactly one continuation | No: two in a row | 030-s4 below; defect 5 |

### Setup

| Item | Value |
| --- | --- |
| Install | `sh make-archive.sh b4067d55` wrote `squeal--v0.1.186.tar.gz`, a `git archive`, and `install-0.1.186.sh`. Then `install.sh` (the full install, not `--opencode`) ran as `squeal-e2e` with `SQUEAL_SOURCE=file://…/src`, at load 8.1. It unpacked 0.1.186, ran `ln -sfn 0.1.186 …/current` and removed 0.1.184. It kept 0.1.190 as the previous version and did not run `opencode plugin` again, since OpenCode's config already listed `current`. It reported the launcher as 0.1.190's, the newest package. The 0.1.190 stand-in was then removed by hand, along with its line in the install record (`install-0.1.186.txt`). Otherwise the launcher, which runs the newest package, would have run 0.1.184's code. After that, `squeal --version` printed 0.1.186 and `current` pointed at 0.1.186. |
| Store | Before any session: 5 known failures from s5's `capitalize`, whose revert no daemon had seen. `squeal start` and `squeal run --all --wait` brought it to revision 43, 0 known failures, and `squeal stop` stopped the daemon (`prep-0.1.186.txt`). Between sessions, the edit was reverted with `git checkout` and settled with `squeal start`, `status --wait` and `stop`. |
| Model, proxy | `cliproxy/gpt-6-luna` through `dogfood/proxy.mjs`. Only the proxy held the key, by name. |
| Load | Each session started after `gate.sh` opened: 5.25, 6.85 and 5.42. The highest seen was 8.32. |

### Sessions

| Id | Mode | Load (start → end) | Prompt | What happened |
| --- | --- | --- | --- | --- |
| 030-s3 | `run --print-logs`, then `run --continue --print-logs` | 5.25 → 5.08; 5.58 → 5.46 | s3's `chunk` prompt; then s3's "Is there anything I should know since my last message? …" | Run 1: the report was stored at `dispose`. Run 2 read it once. |
| 030-s3b | as 030-s3, 15 s later | 7.18 → 8.32; 7.63 → 7.58 | the same | the same |
| 030-s4 | `serve` (Cezar's runner, persistent), scenario `serve-luna-wake.json` (s4's) | 5.42 → 7.70 | s4's `purry` prompt ("Only edit src/purry.ts. Do not run, wait for or check anything; reply DONE"); then "list each message you received and say who sent it" | Two continuations in a row (defect 5). Then quiet until the next prompt, and quiet for 90 s after the last turn. |

### Under `run`: stored, and read once

030-s3, run 1:

| Time | What |
| --- | --- |
| 03:32:05.815 | `PASS -> FAIL` of both `chunk.test.ts > edge-cases` checks, at revision 44 (`squeal why`). The result was reused: it had been seen by the run at revision 30, 008-20's s3, with the same file content. So the news was known as the edit landed. |
| 03:32:05.844 | The assistant's "DONE" message started (request 7, 1,232 ms). |
| 03:32:07.158 | OpenCode logged `exiting loop`. |
| 03:32:07.168 | OpenCode logged `disposing instance`. |
| 03:32:07.612 | Stored: a user message whose only part is a synthetic text, `SQUEAL · 2 checks changed (2 tests) at revision 44`, with both `PASS -> FAIL` entries (`opencode export`). |
| 03:32:07.851 | `run` exited 0, 12.9 s after it started. |

The store came 444 ms after `dispose` began, inside its 3 s. The proxy saw no request between request 7 and the next run's: the stored message cost no model turn. 030-s3b gave the same order: `PASS -> FAIL` at 03:33:46.498, `exiting loop` at 47.860, `disposing instance` at 47.871, stored at 48.364 (493 ms), exit at 48.611.

Run 2, `--continue`, request 8, carried four parts in this order:

- the earlier "DONE";
- the stored report, once;
- the user's question;
- the fresh consumer's registration header. It said `Known failures: 2` and listed both checks without `PASS -> FAIL`. A new process is a first registration (D3), so the header lists the known state.

Luna answered:

- 030-s3: "Since your last message, I received one message from **SQUEAL**. It reported that the existing tests expecting `chunk` to throw for size `0` and negative sizes now fail, which matches the behavior change you requested."
- 030-s3b: "Yes. After your last message, I received one message from **SQUEAL** reporting that the `chunk` change caused two existing tests to fail …"

Each `--continue` run ended with no news, and the export shows nothing stored after its answer. So the run with news stored one message, and the run without news stored none.

The transition reached the model once. The header restated the same two failures as state. Luna counted the two texts as one message, so this is not a second delivery. It is what a resumed process's registration header does.

### Under `serve`: two continuations in a row

030-s4 (`030-s4-serve.timeline.md`, `030-s4-serve.cezar-events.txt`). Times are when each request started.

| Time | What |
| --- | --- |
| 03:34:54.574 | `PASS -> FAIL` of `purry.test.ts > wrong number of arguments`, at revision 48. |
| 03:34:55.818 | Turn 1 ended: "DONE", then Cezar's `TURN-END`. |
| 03:34:56.065 | Request 7, continuation 1: a user message `SQUEAL · 1 check changed (1 test) at revision 48` with the `PASS -> FAIL`. |
| (request 7's answer) | Luna re-edited `purry.ts` (`-  Expected ${fn.length} or … received ${args.length}` / `+  Wrong number of arguments: …`). That is within "only edit src/purry.ts", but it acted on the report. In 008-20's s4, luna left the test failing. |
| 03:35:00.952 | Request 8 (1,270 ms), whose answer was "DONE". |
| 03:35:01.119 | `FAIL -> PASS` of the same check, at revision 49, during request 8 and so before the continued turn's idle (about 03:35:02.22, Cezar's "DONE" text event at 03:35:02.228). |
| 03:35:02.613 | Request 9, continuation 2, 0.39 s after that idle: a user message `SQUEAL · 1 check changed (1 test) at revision 49` with the `FAIL -> PASS` and "1624 pending". Luna answered "DONE". |

Then no request came until the driver's second prompt at 03:36:25.819, 83 s later, and none in the 90 s after its turn-end. Cezar's runner shows the two continued turns as text events with no `TURN-END`, as Observation 4 above says.

Asked who sent each message, luna listed them as "4. **Developer:** Reported Squeal's result for revision 47. 5. **You:** Shared Squeal's failing result for revision 48 … 6. **You:** Shared Squeal's passing result for revision 49." It named the content as Squeal's and the sender as the user; in 008-20's s4, luna had said "sent by the SQUEAL system". On "did anyone ask you to change anything?" it named only the user's request. One try each: a weaker attribution than 008-20's, not a measured change.

## Defects (008-30)

5. **Under `serve`, a continued turn that makes news before its own idle is continued again.** Plugin, D3's idle and D5. Severity: it costs one model request and one turn the user did not start, each time a continued turn's own edit flips a check. It is also exactly the loop goal 4 rules out. A continuation that makes the model edit can make more news, and Claude Code's `stop_hook_active` ends that chain after one.

   Seen once, in 030-s4 above. The second message went out 0.39 s after the continued turn's idle. Its one entry belongs to `purry.test.ts`, which was already current 1.1 s before that idle. That fits neither D3's rule nor D5's:
   - D3: a continued turn's idle ends the turn silent.
   - D5 and 001-85: the wake waits only for entries of the test files pending when the turn ended.

   Which path sent it is not proven from outside. The code (`src/harness/opencode/turns.ts`) gives two candidates:
   - (a) The waiter armed at the continued turn's idle delivered an entry of a file that was not pending at that idle. For instance, the store's turn state was left from the first idle's Stop, since a continuation through `promptAsync` reaches `chat.message` as Squeal's own and `message()` returns before anything starts a new turn there.
   - (b) `continued` was cleared, so the idle ran the Stop path again.

   `--print-logs` is not available under Cezar's runner, so the next row should reproduce it with the scripted provider.

   Proposed row: **008-31 a continued turn is not continued again**. Reproduce it in the real-OpenCode e2e with the scripted provider under `serve`:
   1. turn 1 edits and makes a regression known before idle;
   2. continuation 1's scripted answer makes an edit that flips the check back before its idle;
   3. assert no further Squeal message in the session, and that the `FAIL -> PASS` reaches the model at the next user prompt.

   Then fix whichever path (a) or (b) sends it. A hook test pins it: a continued turn's idle with a ready delta of a file current at that idle ends silent, and its waiter does not fire for that file.

### Cleanup (008-30)

At the end, at 03:41:37 UTC, load 10.1, `ps -u squeal-e2e` was empty:

- no OpenCode, no proxy, no Squeal daemon or waiter, and no tmux server;
- the daemon stopped by itself 3 s after each session's last consumer ended (`status --notes`).

The remeda clone is clean at `8e6e78f`. Squeal's store there is at revision 50 with 0 known failures. The sandbox now holds only 0.1.186: `xdg/data/squeal/opencode/0.1.186` and `current` pointing at it. The 0.1.184 and 0.1.190 archives stay in `src/`.

## 008-37: defect 5 re-checked on 0.1.192

Task 008-37, 2026-10-15. The same sandbox, OpenCode 1.18.35, remeda and Cezar copy as 008-30, with Squeal 0.1.192 (main `a0afa0d8`, whose product tree is `163882d7`'s: 008-31's and 008-33's continued-turn fix), gpt-6-luna only. Records: `dogfood/logs/037-*`, `install-0.1.192.txt`, `prep-0.1.192.txt`, `stats.txt`. Times are UTC.

### Verdict

Defect 5 is fixed with a real model. In the two `serve` sessions that reached its shape, turn 1's `PASS -> FAIL` was continued once, luna's edit in that continued turn flipped the check back before the continued turn's idle, and no second continuation followed: no model request at all for 84 and 85 s, until the next user prompt. That prompt carried the `FAIL -> PASS`, once, and luna reported the test as passing. Goal 4 holds under `serve`: one continuation with news, never twice in a row.

Under `opencode run` the news is still stored once at `dispose` and read once by `run --continue` (defect 1 stays fixed).

030-s4's own scenario no longer reaches the shape with luna: in both exact repeats luna wrote a message that kept "Wrong number of arguments", so the test never failed and nothing was continued, which is goal 4's "none without news". The shape was reached with a scenario that pins the failing message and asks for the repair on Squeal's report (`serve-luna-recheck.json`, Setup).

| Question | Holds? | Evidence |
| --- | --- | --- |
| A continued turn whose own edit flips a check before its idle gets no second continuation (defect 5, goal 4) | Yes, 2 of 2 | 037-s4c, 037-s4d below |
| The `FAIL -> PASS` reaches the model with the next prompt | Yes, 2 of 2, once each | the next prompt's request in 037-s4c and 037-s4d |
| A turn with no news is not continued (goal 4) | Yes, 2 of 2 | 037-s4a, 037-s4b |
| Under `run`, news known before idle is stored once, and `run --continue` reads it once (defect 1, D5) | Yes, 1 of 1 | 037-s3 below |
| The primer in every request | Yes, 31 of 31 | `stats.txt` |

No new defect.

### Setup

| Item | Value |
| --- | --- |
| Install | `sh make-archive.sh a0afa0d8` wrote `squeal--v0.1.192.tar.gz`, a `git archive` of main, and `install-0.1.192.sh`. Then `sh install-version.sh 0.1.192` ran that `install.sh` (the full install) as `squeal-e2e` through `as-user.sh` with `SQUEAL_SOURCE=file://…/src`, at load 27.45 (the install is not a session; the gate holds sessions only). It unpacked 0.1.192, repointed `current` and kept 0.1.186 as the previous version; the launcher is 0.1.192's and `squeal --version` printed 0.1.192. The plugin CLI named in every request's primer is `…/opencode/0.1.192/dist/cli/squeal.mjs`. |
| Store | `sh settle.sh` before each session: `git checkout -- .` in remeda, `squeal start`, `squeal run --all --wait`, `squeal stop`. Before the first session: revision 50, 0 known failures (`prep-0.1.192.txt`); after each, 0 known failures (`037-settle.txt`). |
| Scenarios | `serve-luna-wake.json`, 030-s4's unchanged (037-s4a, 037-s4b). `serve-luna-recheck.json` (037-s4c, 037-s4d): the same `purry` task, but the message is pinned to `` `Expected ${fn.length} or ${fn.length - 1} arguments, received ${args.length}` ``, which the existing test rejects, and "If Squeal later reports that an existing test fails because of this change, change the message so that test passes while it still names both counts, again only in src/purry.ts and without running, waiting for or checking anything, and reply DONE". The second prompt asks who sent each message and what the tests' state is. This makes the continued turn's own edit, which 030-s4 got by chance, the user's instruction; the plugin path it drives is the same. |
| Model, proxy | `cliproxy/gpt-6-luna` through `dogfood/proxy.mjs`. Only the proxy held the key, by name. |
| Load | Each session started after `gate.sh` opened, between 18.15 and 23.93. Other work on the host pushed the load to 29.9 during sessions (below). |

### Sessions

| Id | Mode | Load (gate → end; highest) | Prompt | What happened |
| --- | --- | --- | --- | --- |
| 037-s4a | `serve` (Cezar's runner, persistent), `serve-luna-wake.json` | 22.18 → 18.65; 27.5 | 030-s4's | Luna kept "Wrong number of arguments" in the new message; the test passed (revision 51). No continuation, no wake. |
| 037-s4b | as 037-s4a | 23.22 → 20.80; 29.9 | the same | The same edit, byte for byte (`037-s4b-serve.diff.txt`). No continuation, no wake. |
| 037-s4c | `serve`, `serve-luna-recheck.json` | 21.25 → 24.18; 25.6 | the pinned message, repair on report | One continuation with `PASS -> FAIL`; luna's re-edit flipped it back before the continued idle; no second continuation; `FAIL -> PASS` with the next prompt. |
| 037-s4d | as 037-s4c | 18.15 → 21.92; 28.4 | the same | The same as 037-s4c. |
| 037-s3 | `run --print-logs`, then `run --continue --print-logs` | 19.26 → 20.88; 23.93 → 26.87 | 030-s3's `chunk` prompt; then 030-s3's "Is there anything I should know since my last message? …" | Run 1: the report was stored at `dispose`. Run 2 read it once and stored nothing. |

### Under `serve`: one continuation, then the next prompt

037-s4c (`037-s4c-serve.timeline.md`, `037-s4c-serve.cezar-events.txt`). Times are when each request started (the proxy log).

| Time | What |
| --- | --- |
| 09:35:26.071 | `PASS -> FAIL` of `purry.test.ts > wrong number of arguments`, at revision 55 (`squeal why`). The result was reused from revision 34's run, so it was known as the edit landed. |
| 09:35:28.385 | Turn 1 ended: "DONE", then Cezar's `TURN-END`. |
| 09:35:28.995 | Request 5, continuation 1: `SQUEAL · 1 check changed (1 test) at revision 55` with the `PASS -> FAIL`. |
| (request 5's answer) | Luna re-edited `purry.ts` to `` `Wrong number of arguments (expected ${fn.length} or ${fn.length - 1}, received ${args.length})` ``. |
| 09:35:32.559 | Request 6 (1,762 ms), whose answer was "DONE". |
| 09:35:32.785 | `FAIL -> PASS` of the same check, at revision 56, during request 6 and so about 1.5 s before the continued turn's idle (Cezar's "DONE" text at 09:35:34.327). This is the moment that sent 030-s4's continuation 2. |
| — | No request for 84 s. |
| 09:36:58.578 | Request 7, the driver's second prompt (sent 09:36:58.385). After the user's text, its header: `SQUEAL · 1 check changed (1 test) at revision 56`, `0 pending`, then `PASS  packages/remeda/src/purry.test.ts > wrong number of arguments` / `FAIL -> PASS`. |
| after 09:37:03.455 | The last turn-end; no request in the 90 s the driver held the server open. |

037-s4d gave the same order: `PASS -> FAIL` at 09:39:24.810 (revision 58), turn 1's end at 09:39:26.392, continuation 1 at 09:39:26.662, luna's re-edit, `FAIL -> PASS` at 09:39:30.219 (revision 59), the continued turn's "DONE" at 09:39:31.859, then no request until the second prompt at 09:40:56.831 (85 s), which carried the `FAIL -> PASS` once; 90 s quiet after the last turn. Here the `FAIL -> PASS` was known 147 ms before request 7, the request that answered the re-edit's tool result, and was not appended to that result: it became known after the `apply_patch` call ended, so it is the turn's news, and a continued turn leaves its news for the next prompt (008-31).

In each, what reached the model held three Squeal texts and no more (`stats.txt`): the first prompt's registration header, continuation 1, and the second prompt's header. Asked about the tests' state, luna answered from the header:

- 037-s4c: "4. **Squeal:** Reported that `purry.test.ts > wrong number of arguments` now passes. As far as I know, that test is passing."
- 037-s4d: "6. **Squeal:** Reported the previously failing test now passes. **Test status as reported:** `packages/remeda/src/purry.test.ts > wrong number of arguments` passed at revision 59."

Attribution: in 037-s4c luna named both Squeal texts as Squeal's. In 037-s4d it listed continuation 1 twice, as "2. **Squeal:** Reported that the test … failed" and "3. **You:** Shared that Squeal failure report", the same blur as 030-s4. One try each; it is open question 4's weaker luna reading, not a new defect.

### Under `serve`: no news, no continuation

037-s4a and 037-s4b: luna's edit was `` `Wrong number of arguments: expected ${fn.length} or ${fn.length - 1}, received ${args.length}` `` both times, which 030-s4's continued turn had also arrived at. `purry.test.ts` passed (`squeal why`: no transition after revision 49), turn 1 ended with no request after it, and the second prompt's header said only `SQUEAL · revision 51` (`53`) with "all 125 test files it re-keyed are current". Luna named each header as Squeal's (037-s4a: "2. **SQUEAL:** Reported revision 50's test status … 4. **SQUEAL:** Reported revision 51's test status").

### Under `run`: stored, and read once

037-s3, run 1 (`037-s3-run.run.err`, `opencode export` of `ses_ec10afd18ffeD1NLRsde9BhBxB`):

| Time | What |
| --- | --- |
| 09:47:01.107 | `PASS -> FAIL` of both `chunk.test.ts > edge-cases` checks, at revision 61, reused from revision 30. |
| 09:47:01.535 | Request 7 (1,287 ms), answered "DONE". |
| 09:47:03.056 | OpenCode logged `exiting loop`. |
| 09:47:03.095 | OpenCode logged `disposing instance`. |
| 09:47:04.186 | Stored: a user message whose only part is a synthetic text, `SQUEAL · 2 checks changed (2 tests) at revision 61`. |
| 09:47:04.760 | `run` exited 0, 20.1 s after it started. |

The store came 1,091 ms after `dispose` began, inside its 3 s; 008-30's took 444 and 493 ms at load 5 to 8, this one ran at load 20.9. The proxy saw no request between request 7 and run 2's request 8.

Run 2, `--continue`, request 8 at 09:47:41.175, carried the earlier "DONE", the stored report once, the user's question, and the fresh consumer's registration header (`Known failures: 2`, the state, without `PASS -> FAIL`), as in 008-30. Luna: "Yes. After your previous message, I received one message from the SQUEAL system. It reported that the two existing `chunk` tests expecting size `0` and negative sizes to throw now fail, which is consistent with the requested behavior change." Run 2 made no news; OpenCode logged `disposing instance` at 09:47:43.836 and the export shows nothing after its answer.

### Observations (008-37)

1. **030-s4 reproduced defect 5 by chance.** Its prompt asks for a message naming the counts and leaves the wording free; luna's first wording in 030-s4 failed the test, its two wordings here did not. A real-model check of a continued turn's own news needs the user to ask for the failing edit and its repair, as `serve-luna-recheck.json` does; the scripted-provider e2e (008-31) remains the deterministic proof.
2. **The `dispose` store's margin narrows with load.** 444 and 493 ms at load 5 to 8 (008-30), 1,091 ms at load 21 (037-s3), against a 3 s deadline. One sample; not a defect, but the next `run` check on a loaded host should record it again.

### Cleanup (008-37)

At the end, at 09:49:28 UTC, load 22.6, `ps -u squeal-e2e` was empty: no OpenCode, no proxy, no Squeal daemon or waiter, no tmux server. The remeda clone is clean at `8e6e78f`; Squeal's store there is at revision 62 with 0 known failures. The sandbox holds 0.1.192 (`current`) and 0.1.186 (kept by `install.sh` as the previous version); the 0.1.192 archive and its `install.sh` are in `src/`.
