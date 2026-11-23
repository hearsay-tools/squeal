# 024 Antigravity adapter: live proof and dogfooding lessons

Row 024-08, 2026-11-23. Squeal 0.1.605, installed with its own `install.sh --antigravity` into a temporary `HOME`, then updated in place to a synthetic 0.1.606 and uninstalled. Real Antigravity CLI 1.5.14 sessions on Gemini models only: `-p`, `--input-format stream-json --output-format stream-json`, the interactive TUI, and `antigravity acp` (the mode the installed Squawk runner uses). Part A used a scratch TypeScript and Vitest repository. Part B used a detached clone of this repository. Inputs: `tasks/wave-4.md`, `spec.md`, `status.md`, `research/wave-0-checks.md`, `reviews/0.1.605.md`. Raw transcripts, hook logs and scratch repositories stayed under `/tmp` and were deleted. This file quotes sanitized parts only: `~` is the temporary `HOME` and `<w>` is the scratch directory.

## Verdict

Goals 1 to 8 hold live, and nothing blocks moving spec 024 to `shipped`. In 13 sessions (15 conversations, counting one subagent and one input-format probe), every SQUEAL text arrived in the tool batch after the result became known, with `PreInvocation` before the next model call. No text arrived twice. The one regression edit was denied once, with the regression entries as the reason, and the model re-issued the same call. `stop-slow` held a turn once for a failing slow test, and the continued turn ended cleanly. A subagent was its own consumer. After the CLI exited, the consumers were dropped without a `SessionEnd` hook. A running 0.1.605 daemon survived an in-place `plugin install` of 0.1.606. It validated an outside edit and then handed over to 0.1.606 at the open session's next hook. No session ran Vitest: the 15 conversations made 30 `run_command` calls, and none of them was a test runner. Both dogfooding models (gemini-4-argon, gemini-4-neon) verified with `squeal status --wait`. Each one listed the SQUEAL texts as Squeal's hook messages, apart from the user's two messages.

The open `stream-json` env note is closed. Hooks get the same three variables under `-p`, `stream-json`, ACP and the TUI: `ANTIGRAVITY_CONVERSATION_ID`, `PLUGIN_DATA` and `PLUGIN_ROOT`. `run_command` shells get ten `ANTIGRAVITY_*` variables and no `PLUGIN_*` variable, under `-p` and `stream-json` alike. Wave 0 and the earlier research each measured a different process, so both were right.

There are two defects, both non-blocking and both in text the user reads (defects 1 and 2). The largest open point is outside this row: the installed Squawk starts Antigravity through ACP. For a non-default Squawk account it also passes a separate gemini dir, and that dir does not link `config/plugins` (observation 2). That was read in source code, not run.

| Goal or note | Holds? | Sessions, model | Evidence |
| --- | --- | --- | --- |
| 1. `PASS -> FAIL` in the same turn through `PreInvocation`, no test run by the agent | Yes | s1 argon, s6 and s8 flash, b2 neon, acp1 flash, tui flash | Goal 1 below; in b2 it arrived 12 s after the edit, and the model ran `squeal why` on it |
| 2. `FAIL -> PASS` the same way; silence on `PASS -> PASS` and on unchanged failures | Yes | s1, s6, s8, acp1, tui | Goal 2 below; passes with no earlier failure stayed silent (s2) |
| 3. Next edit after an undelivered regression denied once, re-issuable | Yes | s3 argon | Goal 3 below; 25 edit calls, 1 deny |
| 4. Silent `stop` hands off to `stop-slow`, which continues once; no loop | Yes | s4 flash | Goal 4 below; `executionNum` 0, then 1, then the turn stopped |
| 5. Subagent is its own consumer with its own primer; `fullyIdle: false` stays silent | Yes | s5 flash | Goal 5 below |
| 6. Harness exit drops main and subagent consumers; the daemon outlives the CLI | Yes | s1, s5, s6, s8, acp1, tui | Goal 6 below; dropped 0.8 to 4.5 s after exit |
| 7. No fail-closed `PreToolUse`; hook budgets | Yes | all; timing on the installed copy | Goal 7 below; fast path p95 3.7 ms; Node allow path p95 64.9 ms |
| 8. `install.sh --antigravity` install, update and uninstall; `$PLUGIN_DATA` retention; `squeal status` diagnostic | Yes | s0 flash, s8 flash | Goal 8 below |
| `stream-json`: two turns, `invocationNum` resets, hook and shell env | Yes | s6, s8 flash | `stream-json` below |
| Interactive TUI (review 0.1.605, input 2) | Yes for Goals 1, 2 and 6 | tui flash | TUI below; Esc fires no `Stop` |

## Setup

| Item | Value |
| --- | --- |
| CLI | `antigravity` 1.5.14, Squawk's managed copy, put on the `PATH` as `antigravity` and passed as `SQUEAL_ANTIGRAVITY_BIN` |
| Squeal | 0.1.605: `git archive --prefix=squeal-0.1.605/` of `5b30ee04d` (0.1.605 bundles, built in `1e5f4c22`, plus docs). The synthetic 0.1.606 was the same archive with the version string changed in `plugins/antigravity/dist/*.mjs`, `dist/cli/squeal.mjs`, `plugin.json`, `package.json` and `install.sh` |
| Isolation | Each run used `env -i` with a temporary `HOME` and its own `XDG_*` and `TMPDIR`. The `PATH` held the temporary `~/.local/bin`, a directory with only `node` (24.22.1), `npm`, `npx`, `antigravity` and later `pnpm`, then `/usr/bin` and `/bin`. Only the CLI's OAuth token file was linked in, as `research/probes/wave-0-checks/q2-installed-plugin.sh` does, and it was never read. The real `~/.gemini/config/` had the same `sha256sum` before and after (4 files). The TUI's first-run data-collection box was unchecked |
| Hook logger | `research/probes/wave-0-checks/logger-plugin` was installed beside Squeal. It records each hook's event, env names and stdin, and prints nothing. Squeal's output was read from the conversation transcript, where Antigravity records every injected `systemMessage`, deny and continuation |
| Models | `gemini-3.8-flash-medium` (`-low` for env checks) for mechanics; `gemini-4-argon-medium` for s1, s2, s3 and b1; `gemini-4-neon-medium` for b2. No Claude model ran inside Antigravity |
| Part A repository | `src/math.ts`, `src/strings.ts`, `src/answer.ts`, 2 fast test files and one 15 s slow test file (`slow.include`), Vitest 5.0.3. Policy: `interrupt.onRegression: true`, `baseline.onStart: "lookup-then-run-missing"`, `slow.maxLoadPerCpu: 20`, and `stop.requireSlowSuite: true` for s4 only |
| Part B repository | `git clone --no-local` of this branch at `5b30ee04d`, with no remote, then `pnpm install --frozen-lockfile`. It kept its own `squeal.config.json` (baseline `lookup-only`), so its own `AGENTS.md` and inputs map applied |
| Machine | Linux 6.8, 16 vCPUs. Load at each session is in the next table |

## Sessions

| Id | Mode, model | Load start -> end | Prompt (shortened) | Squeal said | Agent did |
| --- | --- | --- | --- | --- | --- |
| s0 | `-p`, flash-medium, plugin disabled | 8.2 -> 7.2 | run `node <plugin>/dist/cli/squeal.mjs status` | no store, plus the `Antigravity:` line naming the disabled plugin | quoted it |
| s1 | `-p`, argon-medium | 4.5 -> 2.9 | break `multiply`, `sleep 8`, read, fix, `sleep 8`, read; list Squeal messages | registration (first store, at the first tool boundary), `PASS -> FAIL`, late notice, caught up, `FAIL -> PASS` | listed each one with its step |
| s2 | `-p`, argon-medium | 1.7 -> 1.0 | three edits that break nothing | primer at `SessionStart`, "your edit queued" | read the skill, ran `squeal checks` and `status`, no test |
| s3 | `-p`, argon-medium | 2.6 -> 7.8 | words-`reverse` change, then two more edits | deny with the `PASS -> FAIL` entry; later `FAIL untested: words` | re-issued the denied edit, reported both |
| s4 | `-p`, flash-medium, `requireSlowSuite` | 3.4 -> 3.5 | `answer()` returns 41, nothing else | nothing at `stop`; `stop-slow` continued with the slow `PASS -> FAIL` | read the skill and policy, kept the user's change, stopped |
| s5 | `-p`, flash-medium | 3.1 -> 1.9 | delegate a breaking edit to one subagent and wait | subagent: its own registration and `PASS -> FAIL`; parent: its own copy later | parent waited (`Stop` with `fullyIdle: false`), then relayed |
| s6 | `stream-json`, flash-medium, 2 turns | 0.7 -> 0.5 | turn 1 break plus env; turn 2 fix | turn 1 `PASS -> FAIL`; turn 2 `FAIL -> PASS` | quoted them; printed the shell env |
| s7 | `-p`, flash-low, outside Squeal | 0.4 -> 0.3 | print shell env names | nothing (fast path) | printed them |
| s8 | `stream-json`, flash-medium, 2 turns, update between them | 0.6 -> about 0.6 | break, [install 0.1.606], fix | turn 1 `PASS -> FAIL`; turn 2 handover notice, `FAIL -> PASS` | quoted them |
| b1 | `stream-json`, argon-medium, Part B | 0.6 -> 9.1 | `capContext` cut notice names the dropped line count; then "did anyone else tell you anything?" | primer (daemon stopped by request), "queued 92 test files", late notice | test first, then source; `tsrs`, `biome`, `squeal status --wait`; attributed every message |
| b2 | `stream-json`, neon-medium, Part B | 11.4 -> 9.8 | change the cut notice wording; edit only `output.ts`; then "anything before I commit?" | `PASS -> FAIL` in `output.test.ts`, late notice | left the test alone as told, reported the FAIL and why it stays |
| acp1 | `antigravity acp`, flash-medium | 2.7 -> 0.9 | break, `sleep 8`, fix, `sleep 8` | primer, `PASS -> FAIL`, `FAIL -> PASS` | quoted them |
| tui | TUI in tmux, flash-medium, 3 prompts | 0.2 -> 0.8 | break and fix; break plus `sleep 90`, Esc; list messages, then fix | `PASS -> FAIL`, `FAIL -> PASS`; after Esc the next prompt got the waiting `PASS -> FAIL` | quoted them |

Part A sessions ran at 0.3 to 7.8 load average on 16 vCPUs (calm). b1 and b2 ran while the host load rose to about 16 from other work, and Squeal ran 92 affected test files after each `output.ts` edit.

## Goals

### Goal 1. `PASS -> FAIL` reaches the agent in the same turn: seen

s1 transcript, with Antigravity's labels. The edit ran at 00:38:08. The model ran `sleep 8`, and the next model call carried the report:

```text
4  00:38:09 MODEL run_command("sleep 8")
6  00:38:24 SYSTEM_MESSAGE  The following system message was injected by a PreInvocation hook:
   SQUEAL · 1 check changed (1 test) at revision 1
   Revision 1 (changed src/math.ts): 1 of the 2 test files your edits affect has not run.
   FAIL  test/math.test.ts > math > multiplies
         PASS -> FAIL, seen by Squeal's run at revision 1
         expected 21 to be 20 // Object.is equality; diff (- Expected, + Received): - 20 | + 21
```

It changed what the agent did. In b2 (neon, Part B, "only edit `src/harness/antigravity/output.ts`"), the report arrived at the first model call 12 s after the edit, while `squeal status --wait` was still running in the background. The model then ran `squeal why` on the named test, as the FAIL line says. It stayed out of the test file and reported:

> **1 failed**: `test/harness/antigravity/output.test.ts > capContext > cuts a long text at a line, says so, and keeps the kept line and the primer whole` … It remains failing because it still asserts the old `"cut"` wording and I did not edit output.test.ts.

At its next prompt ("anything before I commit?") it put "Update the failing test" first. It also noted that `pnpm run build` was not run because the user limited the edit.

The daemon ran from the retained copy, not from the plugin root. `ps` during s8 showed `squeal fixture daemon … ~/.gemini/antigravity-cli/plugin_data/squeal/versions/0.1.605/dist/cli/squeal.mjs daemon <w>/fixture`. Every primer and FAIL line named `~/.gemini/antigravity-cli/plugin_data/squeal/bin/squeal`.

### Goal 2. `FAIL -> PASS` arrives the same way; silence otherwise: seen

s1, s6 turn 2, s8 turn 2, acp1 and the TUI each delivered `FAIL -> PASS` at the first `PreInvocation` after the fix and a `sleep`. Passes with no earlier failure stayed silent: s2's three edits got only "Squeal saw your edit; passes stay silent unless they follow a failure". No text came twice. In s3 the regression reached the model inside the deny, and the next `PreInvocation` was silent. With parallel calls in one batch (s2, s3 and b1 read 2 to 4 files at once), one `PreInvocation` followed the batch.

### Goal 3. The next edit after an undelivered regression is denied once: seen

s3 (argon). The `reverse` edit ran at 00:41:33. Its `PASS -> FAIL` became known while the model was thinking. The model's next call, an `edit_file` adding `words`, came back as an error result:

```text
8  00:41:41 GENERIC  Encountered error in step execution: tool call denied by pre-tool hook: SQUEAL · 1 check changed (1 test) at revision 7
   FAIL  test/strings.test.ts > strings > reverses
         PASS -> FAIL, seen by Squeal's run at revision 7
         expected 'abc' to be 'cba' // Object.is equality
   Squeal policy interrupt.onRegression denied this edit_file call, so the edit was not applied. The same call can be re-issued; this regression does not deny again.
10 00:41:41 MODEL edit_file(...)   (the same call, applied)
```

Its summary: "Squeal's pre-tool hook blocked the first attempt at Step 2's `edit_file` call to surface the failure. Re-issuing the `edit_file` call succeeded as expected." Across all sessions, 25 edit calls ran and 1 was denied. `run_command` was never denied.

### Goal 4. Silent `stop`, then `stop-slow` holds and continues once: seen

s4 (`stop.requireSlowSuite: true`, slow test of `answer()`). The model made its one edit and ended the turn. The logger's `Stop` record shows `executionNum: 0`, `fullyIdle: true`, `terminationReason: "NO_TOOL_CALL"` at 00:43:19. Nothing came from `stop`. `stop-slow` waited for the 15 s slow file, and at 00:43:35 the turn went on with:

```text
Stop hook blocked termination: Squeal policy stop.requireSlowSuite is on and the slow tier ran at revision 11: 1 check fails: test/slow.slow.test.ts > slow integration of answer.
SQUEAL · 1 check changed (1 test) at revision 11
FAIL  test/slow.slow.test.ts > slow integration of answer
      PASS -> FAIL, seen by Squeal's run at revision 11
      expected 41 to be 42 // Object.is equality; diff (- Expected, + Received): - 42 | + 41
```

The model read the skill and the policy reference, kept the change the user asked for, and ended again. The second `Stop` had `executionNum: 1` and ended the turn with no further continuation (`-p` exit 0, `num_turns: 1`).

### Goal 5. A subagent is its own consumer: seen

s5. The parent called `invoke_subagent`. The subagent got its own `SessionStart` (`lastUserInput: ""`) and its own registration and primer ("registered at revision 12"). The store then held two consumers, `2014bb5e/main` and `af7db813/main`. The subagent's edit gave it its own `PASS -> FAIL` at its next `PreInvocation`. The parent's view was separate: it got the same failure at its own next turn, after the subagent reported back. The parent's `Stop` at 00:45:38 came with `fullyIdle: false`. It was silent and did not hold. The parent's next hook was `PreInvocation` `invocationNum: 0` at 00:46:10, when the subagent's `send_message` woke it.

### Goal 6. Harness exit drops the consumers; the daemon outlives the CLI: seen

A poller read the store every 500 ms. With no `SessionEnd` hook, consumers were dropped after the CLI exited by these margins: s5 (main and subagent together) 2.3 s, s6 0.8 s, acp1 4.5 s, TUI 1 s. The daemon kept running past the exit and stopped itself 3 to 5 s later: "daemon stopped: no session registered for 3 s after its last one ended" (spec 001 D10). The recorded harness was the CLI process itself: the `antigravity` pid under `-p`, `stream-json` and the TUI, and `antigravity acp` under ACP.

### Goal 7. No fail-closed `PreToolUse`; hook budgets: seen

No hook timed out. The CLI logs have no hook error, and every edit and `run_command` call ran except the one regression deny. On the installed copy at load 6.6 on 16 vCPUs, `sh -c "<PreInvocation command>"` was run from the plugin root, as Antigravity runs it, with a recorded 714-byte payload whose `cwd` has no Squeal (50 runs, `dash`): min 3.0 / p50 3.3 / p95 3.7 / max 4.2 ms, empty stdout. The Node path, with a recorded `PreToolUse` `edit_file` payload in the Part A repository (store present, consumer not registered, 30 runs, load 6.2): p50 58.7 / p95 64.9 ms, empty stdout. Both are within the 10 ms and 80 ms targets. That allow path is not the slowest one. Delivering and denying latency stays covered by `test/harness/antigravity/latency.test.ts`.

### Goal 8. Install, update, uninstall and the status diagnostic: seen

- **Install.** `install.sh --antigravity` downloaded the `file://` archive, unpacked `plugins/antigravity` and ran `<cli> plugin install <stage>/squeal` ("Installed to ~/.gemini/config/plugins/squeal"). It recorded `antigravity` in `~/.local/state/squeal/installed`. It wrote nothing under `~/.gemini/config/` itself and put no launcher in `~/.local/bin`. `PLUGIN_DATA` did not exist until the first `SessionStart`, which created `versions/0.1.605/` and `bin/squeal`.
- **Diagnostic.** In s0 the plugin was disabled with `plugin disable squeal`, and the model ran the CLI in its shell:

  ```text
  Status unavailable, no Squeal store at <w>/fixture/.git/squeal/store.sqlite
  Antigravity: no Squeal consumer is registered for this conversation in this worktree (ANTIGRAVITY_CONVERSATION_ID 11b6d4f4-…). Either Squeal's hooks do not run in it, or none has registered it yet: … Its hooks do not run: the Squeal plugin is disabled in ~/.gemini/config/config.json (agy plugin enable squeal enables it); to reinstall, run curl -fsSL …/install.sh | sh -s -- --antigravity.
  ```

- **Update with a session open (s8).** Between the two `stream-json` turns, the 0.1.606 `install.sh --antigravity` replaced the plugin "(replaced existing installation)". `plugin.json` and the bundles then said 0.1.606. The 0.1.605 daemon, running from `versions/0.1.605`, kept its pid. An edit made from outside (`reverse` returns `… + "!"`) got a current FAIL in 1.3 s through `~/.gemini/antigravity-cli/plugin_data/squeal/bin/squeal status --wait`. At turn 2's first hook (now 0.1.606), the daemon handed over: the log said "daemon stopped: hooks at Squeal 0.1.606 are newer than this daemon (0.1.605); their daemon starts once this one exits", and a 0.1.606 daemon served 0.6 s later. The model got "SQUEAL · the daemon is handing over at revision 19 … from 0.1.605 to 0.1.606", then `FAIL -> PASS` from the new daemon. The consumer stayed registered throughout, and `versions/` then held 0.1.605 and 0.1.606.
- **Uninstall.** The first `install.sh --uninstall` ran `plugin uninstall squeal` and forgot the record. It kept `PLUGIN_DATA`: "Kept ~/.gemini/antigravity-cli/plugin_data/squeal: a running process uses it; once it ends, rm -rf … removes it". The process was the repository's store process, started from `versions/0.1.605` (observation 6). It exited "idle" 5 min after its last client. The second `--uninstall` then ran `rm -rf ~/.gemini/antigravity-cli/plugin_data/squeal`. `config.json` lost the `squeal` entry and nothing else.

## `stream-json` and the env note

In s6 and s8, `PreInvocation` restarted at `invocationNum: 0` for turn 2 of one conversation. Turn 2 delivered (s6: `FAIL -> PASS`) or stayed silent as it should (s8 step 3). Env names, values not read:

| Process | `-p` | `stream-json` | ACP | TUI |
| --- | --- | --- | --- | --- |
| Hooks, every event | `ANTIGRAVITY_CONVERSATION_ID`, `PLUGIN_DATA`, `PLUGIN_ROOT` | same | same | same |
| `run_command` shell | `ANTIGRAVITY_AGENT`, `_AGENTAPI_EXE`, `_APP_DATA_DIR`, `_CONVERSATION_ID`, `_CSRF_TOKEN`, `_LS_ADDRESS`, `_LS_VERSION`, `_PROJECT_ID`, `_SOURCE_METADATA`, `_TRAJECTORY_ID` | same | not checked | not checked |

So D6 keys correctly on `ANTIGRAVITY_CONVERSATION_ID`, which a shell has. The shell has no `PLUGIN_DATA`, so the CLI names `~/.gemini/antigravity-cli/plugin_data/squeal/bin/squeal` by path, as the primer does. The models used that path every time.

The input line `stream-json` takes is `{"event":"user","message":{"content":"<prompt>"}}`. The prompt flag must be attached (`-p=`), or `-p` takes `--input-format` as its prompt.

## TUI

In the TUI (tmux, flash-medium), the first prompt got the primer at `SessionStart`, `PASS -> FAIL` after `sleep 8`, and `FAIL -> PASS` after the second. For the second prompt (break `add`, then `sleep 90`), Esc during the `sleep` showed "Interrupted · What should Antigravity CLI do instead?". **No `Stop` hook fired**, as with SIGINT and `--print-timeout` under `-p` (`research/wave-0-checks.md` 4). The next prompt's `PreInvocation` `invocationNum: 0` delivered the waiting `PASS -> FAIL` of `math > adds`. After the fix, `FAIL -> PASS` followed. Every `Stop` in this row had `continuationActive: false` and `terminationReason: "NO_TOOL_CALL"`. The spec's abort guard and `continuationActive` branch stay covered by synthetic fixtures only, and that is enough for D3.

## Part B: dogfooding on this repository

- **The primer and Vitest.** Both models read the Squeal skill before editing. b1 also read `docs/styleguide.md`, `vision.md`, the Codex `output.ts` and the spec, as the repository's `AGENTS.md` says. Neither model ran Vitest. b1 ran `tsrs --fast --noEmit`, `biome check` and `squeal status --wait 60000 <changed files>`, which answered "92 test files, each with a current result, after 43.9 s". b2 ran `pnpm run typecheck`, `biome check`, `squeal checks`, `squeal why` and `squeal status --wait`. That is the split the primer gives: Squeal for Vitest, the agent for typecheck and lint. Antigravity adds its own reminder every turn ("verify in one command after your last edit"). Both models answered it with `squeal status --wait`, not with a test run.
- **`PASS -> FAIL` mid-turn changed what the model did.** b2: see Goal 1. b1 got no FAIL: it edited the test before the source, and a daemon stopped on purpose before the session (setup, observation 8) restarted only at the first edit. By the time results came, both edits were in, and the 92 files passed.
- **Squeal's messages read as Squeal's.** Asked "did anyone other than me tell you anything?", b1 split the messages into "Messages from you (the user)" (exactly the two prompts) and "Messages from Squeal hooks (`<SYSTEM_MESSAGE>`)", with `SessionStart` and each `PreInvocation` quoted, plus Antigravity's reminders and background-task messages. b2: "Only **two** messages came from you". It named each Squeal report by its hook. Antigravity labels every hook text as "not actually sent by the user … injected by a PreInvocation hook", which helps.
- **Hooks.** None timed out, failed closed or misbehaved. Both models put `squeal status --wait` into Antigravity background tasks. Their `Stop` came with `fullyIdle: false` and stayed silent. When the task finished, Antigravity woke the agent (`invocationNum: 0`), and the next `Stop` (`fullyIdle: true`) was silent because there was no news.

## Defects

1. **The launcher says open Antigravity sessions keep their version until restart; they move at their next hook.** Launcher (`plugins/claude-code/bin/squeal-launcher`, spec 024 D1). Severity: non-blocking; the text misleads, behaviour is right. After the in-place update to 0.1.606 (s8), `~/.gemini/antigravity-cli/plugin_data/squeal/bin/squeal status` printed "squeal: this command runs squeal 0.1.606; plugins: Antigravity 0.1.606; Antigravity sessions started on 0.1.605 keep 0.1.605 until they restart". But Antigravity reads `hooks.json` and the bundles from the plugin root at every call. At the open session's next hook, 0.1.606 hooks ran and handed the daemon over. That sentence fits Codex, whose plugin a session keeps. Reproduction: s8's steps (Goal 8). Proposed row: **024-09 launcher wording for Antigravity updates**: in another data directory than Codex's, say that open Antigravity sessions move to the new version at their next hook, and that the running daemon hands over then.
2. **`install.sh --uninstall` names Claude Code and Codex marketplace commands in a home that has neither.** Install. Severity: non-blocking, cosmetic. Both uninstall runs in the Antigravity-only `HOME` ended with "The hearsay marketplace stays added; claude plugin marketplace remove hearsay and codex plugin marketplace remove hearsay remove it.", though no `claude` or `codex` was on the `PATH` and no marketplace was ever added. Proposed: fold into 024-09: print the line only for a harness that is on the `PATH` or recorded.

## Observations

1. **The first session in a repository with no store gets the primer at its first tool boundary.** Shared core, by design (`src/harness/shared/session.ts`: "Without a usable store nothing validates yet, so there is no primer either: the first registration … carries it"). In s1 Squeal's store directory appeared 0.25 s after `SessionStart`. `PreInvocation` `invocationNum: 0` had already run (0.1 s after `SessionStart`), so the model's first call, an edit, came before the primer. Every later session in that repository had the primer at `SessionStart`. This happens once per repository and could matter if an agent's first action is to run tests. Possible row (core, any harness): `SessionStart` that spawned the daemon waits up to a short bound for the store, so `invocationNum: 0` registers.
2. **The installed Squawk runner uses ACP, not `stream-json`, and a non-default account may not load Squeal.** `@hearsay-tools/squawk` `0.18.0-dev.7836` starts `antigravity acp --gemini-dir <account> --app-data-dir antigravity-cli` (`dist/runners/antigravity/launch-args.js`). The spec's Problem names Squawk's `--input-format stream-json` runner. acp1 shows Goals 1, 2 and 6 hold under ACP with the default gemini dir, `~/.gemini`. For a non-default account, `prepareAntigravityAccount` (`account-home.js`) links only `AGENTS.md`, `GEMINI.md` and the skills folders into the account's gemini dir, not `config/plugins`. So the plugin `install.sh` puts in `~/.gemini/config/plugins/squeal` would not load there (`read in source code`, not run). Proposed row: **024-10 Squeal under a non-default Squawk Antigravity account**: run one to confirm. Then decide between a Squawk change (link `config/plugins`, or install there) and Squeal install or status wording.
3. **A deny from Squeal stopped another plugin's `PreToolUse` for that call.** In s3 the logger plugin has a `PreToolUse` record for every call except the denied one. It has no `PostToolUse` record for that call either. So a deny ends the `PreToolUse` chain, or Squeal's entry ran first. Worth knowing when Squeal shares a host with other plugins. It did not affect Squeal.
4. **Slow-tier coverage lost its first record in s1.** Core, not Antigravity. The daemon log said "coverage: test/slow.slow.test.ts: Error: ENOENT … coverage-….json", then "1 map-error (its payload did not map)" and "no result of run … for test/slow.slow.test.ts". The test results themselves were reported correctly. Worth a coverage row if it recurs.
5. **Each daemon stop is logged twice.** Each daemon log in this row ends with the same "daemon stopped: …" line written twice, 30 to 45 ms apart, for every stop reason seen ("no session registered", "hooks at Squeal 0.1.606 are newer"). Cosmetic. Other harnesses were not checked.
6. **The store process of an older version serves the newer daemon after a handover.** After s8's handover, the repository's store process (started at s4 from `versions/0.1.605`) went on serving the 0.1.606 daemon. That kept the 0.1.605 copy "in use" until it exited 5 min after its last client (`STORE_PROCESS_GRACE_MS`). Copy pruning and `--uninstall` both handled it correctly (Goal 8). An uninstall in that window needs a second run.
7. **Models working in this repository need `pnpm`.** b1 found no `pnpm` on the minimal `PATH`. It ran `find / -name pnpm`, then tried a corepack shim that stopped at a download prompt, and fell back to `./node_modules/.bin/tsrs` and `biome`. That cost about 2.5 min. b2 had `pnpm` and used `pnpm run typecheck` directly. This is a setup gap, not a Squeal one.
8. **Setup notes for whoever runs this next.**
   - A plain `squeal stop` before a session leaves the daemon stopped until the next edit. That `SessionStart` says "The daemon is stopped by request"; b1's first, test-only edit was never validated alone.
   - The temporary `HOME` isolates config, not the file system. b1's `find /` listed file names under the real home, though it read no file there and no token. A container or the `squeal-e2e` user would be stricter.
   - The TUI's first run asks for a color scheme, data-collection consent (on by default) and folder trust. Answer them before the first prompt.

## Cleanup

At the end: no Antigravity process, Squeal daemon, store process, poller or tmux server ran whose working directory or arguments named the scratch directory. The scratch directory (temporary `HOME`, archives, both repositories, raw logs) was deleted. The real `~/.gemini/config/` matched its earlier `sha256sum` (4 files). Nothing under the real `~/.gemini/antigravity-cli/` was written by this row: every run had the temporary `HOME`.
