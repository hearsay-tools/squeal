# 009 Pi adapter: dogfooding lessons

Task 009-20, 2026-10-14. Squeal 0.1.172 installed into a real Pi 1.0.4 with its own `install.sh`, updated to 0.1.173 with `install.sh --pi` and to 0.1.174 with `squeal update`, used by real models on remeda through Cezar-shaped RPC sessions and a TUI. Scripts, scenarios and condensed logs: `dogfood/` (its README lists them). Inputs: the brief in `tasks/wave-3.md`, the human's model decision of the same day in `status.md`.

## Verdict

The Pi package does what goals 1, 3, 5 and 8 say with real models, and goal 7 in RPC. In four working sessions 28 SQUEAL texts (the four registration headers included) reached a model, each in the request that followed the tool call or end of run in which the result became known, none twice; one `edit` was denied with the regression entries and re-issued. Every agent request carried the primer, after `/compact` too. No agent ran Vitest to learn whether its edit broke something; the one model that ran tests itself (grok-4.7) ran the Vitest typecheck project, which Squeal does not run and told it to run.

Open question 2 is answered for these models: each read the SQUEAL text as Squeal's report, not as the user's words. gpt-6.1-sol, asked who said what, called them "automated Squeal reports, delivered in the conversation with the `user` role—not additional requests from you". One model, grok-4.7, let a FAIL report widen the user's "only edit src/purry.ts" to a test edit (Observation 3).

The update behaves as 009-18 says. An open session keeps working on the version it loaded after `install.sh --pi` and after `squeal update`; `/reload` loads the new version, whose daemon takes over. Two defects showed after `/reload`, both new: no idle wake came in the reloaded TUI (defect 1, cause open), and the daemon the old extension spawned stays a zombie child of Pi until Pi exits (defect 2).

| Goal or question | Holds? | Model, session | Evidence |
| --- | --- | --- | --- |
| 1. `PASS -> FAIL` before the next model request, and it changes what the agent does | Yes | gpt-6-astra s2, grok-4.7 s3, gpt-6.1-sol s4, gpt-6-luna s5 | Goal 1 below; 28 SQUEAL texts, each in the request after the call or run end that made it known |
| Agents leave the tests to Squeal | Yes | all four | No agent ran Vitest for a result Squeal gives; grok-4.7 ran only the typecheck project Squeal does not run (Observation 1) |
| 3. The next `edit` after an undelivered regression is blocked once, re-issuable | Yes | grok-4.7 s3 | Goal 3 below |
| 5. The primer in every request, after compaction too | Yes | all four; compaction with gpt-6-luna s5 | Goal 5 below |
| 7. An idle agent woken with news | Yes in RPC; not seen in the TUI after `/reload` | grok-4.7 s3 (RPC); gpt-6-luna s5 (TUI) | Goal 7 below; defect 1 |
| 8. Pi's own install, no trust step, no Squeal file under the agent dir, the status line | Yes | gpt-6-luna s1 for the status line | Goal 8 below |
| Open question 2: a Squeal message read as Squeal's, not the user's | Yes, four models of four | gpt-6.1-sol s4 asked directly | Open question 2 below; grok-4.7 let one widen the user's scope (Observation 3) |
| Update with a session open (009-18) | Yes | gpt-6-luna s5 | Updating below |

None of the defects blocks shipping 009. Defect 1 loses a TUI wake after `/reload`; D5's wake is best-effort and the news still arrives at the next prompt, and the RPC wake, the one Cezar-shaped sessions use, worked. Defect 2 leaves one zombie process per daemon handover inside a long-lived Pi. Defect 3 is a misleading setup plan, with no effect on delivery.

Claude models in Pi are out of scope by rule, not unobserved: the human decided on 2026-10-14 that Claude models run only in Claude Code and Cursor, so no Pi session runs one, re-runs included.

## Setup

| Item | Value |
| --- | --- |
| Where | Only as `squeal-e2e`, through `dogfood/as-user.sh`: every inherited variable dropped, `HOME=/home/squeal-e2e/dogfood-009/home`, `PI_CODING_AGENT_DIR=…/dogfood-009/agent`, `TMPDIR=…/dogfood-009/tmp`, `PI_OFFLINE=1`, `PI_SKIP_VERSION_CHECK=1`, `PI_TELEMETRY=0`. The `PATH` holds `~/.local/bin`, a directory with only `pi` (Pi 1.0.4 from squeal-e2e's npm prefix), Node 24.21.0, `/usr/bin`, `/bin`: `command -v claude` and `codex` print nothing. The agent user's `~/.pi` was never touched. |
| Models | `cliproxy` (OpenAI-compatible) through `dogfood/proxy.mjs` on 127.0.0.1: it adds `CLIPROXY_API_KEY`, which only the proxy process holds (passed by name with `sudo --preserve-env`), and logs each request body, never a header. Pi's `models.json` holds a placeholder key, so neither Pi nor the agent's `bash` ever had the key. Tiers by the human's decision: `gpt-6-luna` where only the daemon is observed, `gpt-6-astra` and `grok-4.7` for ordinary work, `gpt-6.1-sol` where agent behaviour is the question. |
| Why not Claude | The brief named the Claude tiers. cliproxy refused them for Pi: the subscription account answered `400 Third-party apps now draw from your extra usage, not your plan limits` to Pi's real request (a short curl prompt passed, so Pi's request is what is classed as a third-party app), and the `work/` account answered `monthly spend limit` (`dogfood/logs/s0-claude-refused.*`). Pi's request was not disguised to pass. The human then ruled Claude out of Pi entirely. |
| Install | `install.sh` of 0.1.172 (`git show c4c59482:install.sh`) with `SQUEAL_SOURCE=file://…/src` holding `git archive` tarballs of `c4c59482`, `3fd4916d` (0.1.173) and `69a6ea23` (0.1.174, main at the go), named as the tag archives. |
| Project | remeda (`github.com/remeda/remeda` at `8e6e78f6`, 2026-10-04): a TypeScript utility library, an npm-workspaces monorepo whose `packages/remeda` has 175 Vitest runtime files (Vitest 4.1) and 142 typecheck files (`*.test-d.ts`, a `types` project); about 2,400 checks. Chosen because it is real, in the brief's size range, fast enough that a regression lands while the model is still working, and has a widely imported core (`purry`, imported by about 100 source files) that re-keys most of the suite, which is what a late result needs. It ships `AGENTS.md`, which Pi loads. `npm ci`, then `squeal setup --yes`. |
| Drivers | RPC: `dogfood/cezar-drive.mjs`, the installed Cezar 0.16.0-dev.1634 `PiRunner` (sha256 `0db6974c…`), copied unchanged as 009-02 did, in persistent mode with `buildPiArgs` (`--mode rpc --extension <Cezar's retry extension> --model …`), each prompt sent after the previous `turn-end`, then held open 120 to 180 s for a wake nobody prompted. TUI: `dogfood/tui.sh`, Pi in a 200x50 tmux window, keys sent and the screen captured. |
| Machine | Linux 6.8, 24 cores. Sessions were started only below load 24 and with no other `squeal-e2e` process (`dogfood/gate.sh`); other work on the host pushed the load during sessions from 7 to 140, recorded beside each session. |

## Sessions

| Id | Mode, model, Squeal | Load at start (range) | Prompt (shortened) | Squeal said | Agent did |
| --- | --- | --- | --- | --- | --- |
| s1-noext | `-p --no-extensions`, gpt-6-luna, 0.1.172 | 18 | run `squeal status` | (extension off) the `Pi:` line | Quoted it; "Yes, it mentions Pi." |
| s2-astra | RPC (Cezar), gpt-6-astra, 0.1.172 | 15 (15 to 64) | 1: `words` stops splitting on digits, "and whatever else it needs"; 2: also stop splitting on `_`, "only edit words.ts … do not run, read or check anything else" | registration; 13 `PASS -> FAIL` (its own test edit, written first); `PASS -> FAIL` in `toTitleCase`; recoveries; "No result for …test-d.ts"; at run 2's end 32 `PASS -> FAIL` as the continuation | Read Squeal's skill unprompted; wrote the test first, fixed, waited with `status --wait`; ran no tests. Run 2: "Squeal's automatic run reports 32 failing tests after the underscore change; I've left the requested edit intact and made no further changes." |
| s3-grok | RPC (Cezar), grok-4.7, 0.1.172 | 18 (6 to 31) | 1 as s2; 2: `purry` throws a `RangeError` naming the counts, "only edit src/purry.ts … do not run, read or check anything else" | registration; a deny of `edit words.ts` with 9 `PASS -> FAIL`; reports; run 2's continuation with `purry.test.ts` `PASS -> FAIL` while 1,594 checks were pending; then an idle wake with its `FAIL -> PASS` | Re-issued the denied edit after re-reading; ran the typecheck project itself (four commands: `npx vitest run --project types`, `npm run test:types`, with `npm run check`); run 2: edited `purry.test.ts` to match after the FAIL, outside the user's scope; answered the wake "The argument-count test now passes". |
| s4-sol | RPC (Cezar), gpt-6.1-sol, 0.1.172 | 16 (10 to 25) | 1: `chunk` returns `[]` below size 1, "I will update the tests myself … tell me which tests fail now, and how you know"; 2: "did anyone ask you to fix, revert or change anything? Quote who said what" | registration; 2 `PASS -> FAIL` in `chunk.test.ts` | Edited only `chunk.ts`, waited with `status --wait`, reported the two failures citing Squeal; answer 2 below (open question 2). |
| s5-tui | TUI, gpt-6-luna, 0.1.172 → 0.1.173 → 0.1.174 | 20 (10 to 111) | `capitalize` lowercases the rest; revert; [`install.sh --pi` 0.1.173]; again; [`/reload`]; again; read five large files; `/compact`; revert; [`squeal update` to 0.1.174, `/reload`]; `purry` edits and reverts | reports in `[squeal]` boxes; continuation news at each run end | Stayed inside each prompt's scope, answered from the reports, ran no tests. |

## Goals

### Goal 1. A `PASS -> FAIL` reaches the agent before its next model request, in the same run: seen

Every report in s2 to s5 is in the model request that directly follows the tool result of the call in which the result became known, as a user message after that tool result, in the same run; news known only at the end of a run went out as that run's continuation (`dogfood/logs/*.timeline.md`). s2, request 11, right after the `read` that followed the source edit:

```text
- tool result: import type { Join, Words } from "type-fest"; […]
- user SQUEAL: SQUEAL · 14 checks changed (14 tests) at revision 2
Revision 2 (changed packages/remeda/src/internal/words.ts): 2418 current (2243 tests, 175 test files loaded), 0 pending, […]
FAIL  packages/remeda/src/toTitleCase.test.ts > edge cases > with numbers
      PASS -> FAIL, seen by Squeal's run at revision 2
      expected 'Foo123bar' to be 'Foo 123 Bar' // Object.is equality
```

It changed what the agent did each time: s2 updated the title-case expectation the report named; s3 re-read after the deny; s4 reported exactly the two named failures; s5 answered each "what did Squeal report" from the box. Count of SQUEAL user texts that reached a model, one registration header each included: s2 7, s3 8, s4 2, s5 11, plus s3's deny (`dogfood/logs/stats.txt`).

The models left the tests to Squeal. Across s2 to s5 the only test commands an agent ran were s3's four typecheck commands (`vitest --project types`, `npm run test:types`, `npm run check`), after Squeal said "No result for packages/remeda/src/toKebabCase.test-d.ts, …: no test Squeal runs reads them. Run whatever tests them yourself." (Observation 1). Everywhere else the agents waited with the primer's `status --wait 60000`.

### Goal 3. The next `edit` after an undelivered regression is blocked once, then can be re-issued: seen

s3, request 14. grok-4.7 answered with four parallel edits; the first, `edit words.ts`, came back as an error tool result whose text is the report plus the deny sentence, and the other three were applied:

```text
- tool result (error): SQUEAL · 9 checks changed (9 tests) at revision 10
[…9 PASS -> FAIL entries…]
Squeal policy interrupt.onRegression denied this edit call, so the edit was not applied. The same call can be re-issued; this regression does not deny again.
- tool result: Successfully replaced 1 block(s) in […]/words.test.ts.
- tool result: Successfully replaced 1 block(s) in […]/toTitleCase.test.ts.
- tool result: Successfully replaced 1 block(s) in […]/toTitleCase.test-d.ts.
```

The model re-read the four files and re-issued the same `words.ts` edit in the next request (request 15); nothing was denied twice. The deny is per call of a batch, so a batch that mixes the source and its tests ends half applied (Observation 2).

### Goal 4 (seen in passing). One continuation with news, none without

s2 run 2, s3 run 2, s5 (each `purry` run): the end of the run carried the news as one continuation, which the model answered in one turn; runs with no news ended with no extra request. No run continued twice.

### Goal 5. The primer is in every model request, after compaction too: seen

Every agent request of s2 to s5 has the `squeal` section in its system prompt: 20 of 20, 34 of 34, 8 of 8, 46 of 48 (the two without are Pi's own compaction summariser requests, whose system prompt is "You are a context summarization assistant"). In s5 the request after `/compact` (8 messages, context 4.4%) still carries it, naming the CLI of the version loaded: 0.1.172 before the first `/reload`, 0.1.173 after it, 0.1.174 after the second. The primer as the models saw it:

```text
<squeal>
Squeal runs this repository's Vitest tests in the background after each edit; a SQUEAL message with your next tool call means a check changed, and passing results stay silent, so keep working; do not run Vitest to learn whether your edits broke something. Wait only when you need a result before your next step, for example before saying the task is done: `"/opt/squeal-e2e/node24/bin/node" --disable-warning=ExperimentalWarning "/home/squeal-e2e/dogfood-009/home/.local/share/squeal/pi/0.1.172/dist/cli/squeal.mjs" status --wait 60000`. […] Squeal covers Vitest. Squeal does not cover typecheck, build or any other test suite: run those yourself.
</squeal>
```

s2 and s4 also read the package's `skills/squeal/SKILL.md` on their own before editing (Pi lists it under available skills).

### Goal 7. An idle agent is woken with news: seen in RPC; not seen in a reloaded TUI

s3 (RPC, Cezar's runner, no `/reload` in that process). After run 2's continuation the model edited `purry.test.ts` and ended its run while the 109 test files the `purry.ts` edit re-keyed were still queued ahead of that test (the continuation had said "1594 pending"). Cezar logged `turn-end` at +455.9 s, then a `turn.started` it had not prompted at +459.1 s; the request held:

```text
- user SQUEAL: SQUEAL · 1 check changed (1 test) at revision 17
[…] All 128 test files your edits since revision 13 re-keyed are current.
PASS  packages/remeda/src/purry.test.ts > wrong number of arguments
      FAIL -> PASS
```

The model answered "The argument-count test now passes with the new `RangeError`." and the session stayed idle until the driver closed it 180 s later. Cezar's persistent mode took the extra turn as 009-02 found.

In the TUI (s5) no wake came after two `/reload`s, in two runs whose news landed after the run settled (revisions 27 and 29): defect 1. A controlled pair that separates the possible causes (`dogfood/pair.sh`) was written but not run: the host stayed between load 50 and 150 for the last hour, and the coordinator ruled the cause a defect row's job (009-24).

s2's run 2 and s4 had their news ready at the end of the run, which went out as the continuation, so no wake was needed there.

### Goal 8. Pi's own install, no trust step, no file of Squeal's under the agent dir; the status line: seen

`install.sh` of 0.1.172 ran `pi install <…/squeal/pi/0.1.172>` and nothing else in Pi (`dogfood/logs/install-0.1.172.txt`). The only new file in the agent dir was Pi's `settings.json` with `"packages": ["../home/.local/share/squeal/pi/0.1.172"]` (`dogfood/logs/tree-*.txt`). s2 to s4 loaded the extension with no trust step: Pi had no `trust.json` until the TUI. At the end the agent dir held `models.json` (written for this task), Pi's `settings.json`, Pi's `auth.json` and `models-store.json` (2 bytes each, from Pi's first run), Pi's `trust.json`, and Pi's `sessions/`; no file names or contains Squeal except `settings.json`'s package line and the sessions' `custom_message` entries (`customType: "squeal"`, `display: true`), which are Pi's records of what Squeal sent.

`trust.json` is from the TUI's first launch in remeda: Pi asked whether to trust the project, and the keys this task typed for the first prompt answered yes (that prompt was then lost). It trusts remeda's own project resources, which is why the TUI listed remeda's `.agents` skills beside Squeal's; Squeal itself is user scope and loaded without it in s2 to s4.

s1, `pi -p --no-extensions` in remeda, the agent ran `squeal status` (the launcher `install.sh` put on the `PATH`):

```text
Pi: no Squeal consumer is registered for this session in this worktree (PI_SESSION_ID 01a13bde-34e0-7337-9908-acd20389eaca). Either the Squeal Pi extension is not loaded in it, or it has not registered the session yet: a session that started before the store existed registers at its next tool call. Without the extension, install it with pi install "/home/squeal-e2e/dogfood-009/home/.local/share/squeal/pi/0.1.172", then start Pi again.
```

## Open question 2: does a model read a Squeal message as Squeal's, not the user's?

Yes, for the four models observed: none attributed a SQUEAL text to the user, and each named Squeal when acting on one. Pi sends the custom message as plain `user` content (`dogfood/logs/s4-sol.timeline.md` shows the `user` role), so the attribution rests on the text naming Squeal, as D3 intends.

- gpt-6.1-sol, s4, asked "did anyone ask you to fix, revert or change anything? Quote exactly who said what, and say which messages came from me":

  > The other two messages received during the task were **automated Squeal reports**, delivered in the conversation with the `user` role—not additional requests from you: […] The second report listed the two failures. Neither report asked me to fix, revert, or change anything. There was also standing guidance in the **Squeal skill file**, which I read—not a message from you: "Done when each FAIL is fixed or you can say why it stays." I used the "say why it stays" option: the existing tests still expected throws, and you explicitly asked me not to edit them.

- gpt-6-astra, s2 run 2, under "only edit words.ts": "Squeal's automatic run reports 32 failing tests after the underscore change; I've left the requested edit intact and made no further changes."
- gpt-6-luna, s5, under "only edit src/purry.ts": "Squeal reports the updated argument-count check failed because the existing test expects 'Wrong number of arguments'; 1 known failure." It left the test alone.
- grok-4.7, s3 run 2, under "Only edit src/purry.ts … Do not run, read or check anything else": after the continuation's FAIL it said "The argument-count test still expects the old message. I'll update it to the new `RangeError`." and edited `purry.test.ts`. It did not claim the user asked; it treated the failure as work, which the skill's "Done when each FAIL is fixed or you can say why it stays" supports. One model in four let a report widen an explicit scope (Observation 3).

The trust question: sol did not run the suite to answer "which tests fail now, and how you know"; it answered "Squeal confirmed both changed from PASS to FAIL at revision 19 after this edit. Its final report shows all checks current, with 0 pending, stale, or unknown and no other known failures."

## Updating with a session open

All in s5, one TUI process (`dogfood/logs/update-*.txt`, `s5-tui.screens.txt`):

1. 0.1.172 loaded; its daemon (spawned by `squeal start`) validating.
2. `install.sh --pi` of 0.1.173 with the TUI open: `pi install …/0.1.173`, `pi remove …/0.1.172`, then "Pi sessions already open keep the Squeal they loaded; /reload in each loads 0.1.173". `…/squeal/pi/` then held both directories; the record lists both. The launcher stayed (`--pi` copies none; it finds the newest package itself).
3. The open, not reloaded session made an edit: its 0.1.172 extension delivered the five `FAIL -> PASS` as before. Silent-safe holds, and better: it kept working.
4. `/reload`: within 7 s a 0.1.173 daemon (`… daemon … --await-lock`) had replaced the 0.1.172 one, and the next report named the 0.1.173 CLI.
5. `squeal update` (the launcher, now 0.1.174 since it picks the newest package) with `SQUEAL_INSTALL_SH=file://…/install-0.1.174.sh`: downloaded it, ran `sh install.sh --pi`, which installed 0.1.174, deleted 0.1.172 (`rm -rf`; nothing named it), ran `pi remove` on 0.1.173 but kept its files (the previous one, and the daemon of the open session ran from it), and printed `Pi: Squeal 0.1.174, was 0.1.173` and the `/reload` hint.
6. `/reload`: the 0.1.174 daemon took over ("daemon stopped: hooks at Squeal 0.1.174 are newer than this daemon (0.1.173)"); reports named 0.1.174.

So the update does what 009-18 says. Two things after `/reload` do not work: defects 1 and 2. `squeal update` with the real release channel was not run here: the latest GitHub release is 0.1.168, whose `install.sh` has no `--pi`, which 009-18's own notes already cover.

## Defects

1. **No idle wake in a TUI after `/reload`.** Pi adapter, D5. Severity: does not block shipping. D5's wake is best-effort, the news reaches the agent at its next prompt (`squeal status` showed it all along), and the RPC wake worked; but a TUI user who reloads after `squeal update`, as the update tells them to, may lose the wake for the rest of that Pi process.

   Observed: in s5 (gpt-6-luna, TUI, after two `/reload`s) two runs ended with test files still pending, and their news landed after the run settled, yet no wake came: no model request, no `custom_message` in Pi's session file, and `squeal status` listed the failures. At revision 27 the end-of-run continuation carried `difference.test.ts > lazy` with "1510 pending", and 39 more `PASS -> FAIL` followed (`squeal why "packages/remeda/src/drop.test.ts > data last > lazy impl"`: `PASS -> FAIL` at 20:02:14.930Z; the model's last message of that run at 20:02:13.494Z); revision 29 repeated it. In s3 (grok-4.7, RPC, no `/reload`) a result that landed after the run settled woke the agent 3.2 s later.

   Hypotheses:
   - (a) A waiter lock stranded by `/reload`: the waiter's exclusive SQLite lock is taken in the delivery worker, and `session_shutdown` of the reloading instance terminates that worker. **Falsified:** `dogfood/lock-probe.mjs` terminates a worker thread holding such a lock, and a new connection in the same process takes the lock at once (Node 24.21 and 22.23).
   - (b) A continuation the model answers with text only: in both missed wakes the end-of-run continuation was answered with no tool call, and the late results were of files already pending when the first settle reported; in s3's wake the woken file was edited after the continuation. Open.
   - (c) The end of the turn missed its deadline under load: `agent_settled` asks the worker to end the turn within 2 s, and a miss replaces the worker and may leave the consumer `in-turn`, which the idle waiter never delivers to. s5's misses ran at load 35 to 111 while the daemon wrote about 125 files' results; s3's wake ran at load 8. Open.
   - The reload itself, by some other path: open; (b) and (c) do not need it.

   `dogfood/pair.sh` decides between them: one fresh TUI, experiment A before any `/reload` and experiment B after one, each a novel `purry.ts` edit whose failures land after the run settles, with the consumer's turn state read from the store after each (`dogfood/turn-state.py`). Run it below load 24 (`sh gate.sh && sh pair.sh` from `dogfood/`, after the setup in the README). A wake in A and none in B points at the reload; none in either at (b); an `in-turn` state at (c).

   Proposed row: **009-24 the TUI idle wake after `/reload` and after a continuation**: run the pair; fix what it finds; a real-Pi regression with the fake provider for that case (RPC can stand in for the TUI: `new_session` also shuts an instance down, and a continuation answered with text is scriptable).
2. **The daemon a reloaded extension spawned stays a zombie of Pi.** Pi adapter, D3's ensure with D4. Severity: does not block shipping; one zombie (no memory, one process-table entry) per daemon handover, gone when Pi exits. After the first `/reload` the 0.1.173 extension's worker spawned the 0.1.173 daemon (pid 402890, parent Pi). When the 0.1.174 daemon took over, it exited, and stayed `[MainThread] <defunct>`, parent Pi, until Pi quit (`dogfood/logs/s5-tui.ps-before-quit.txt`). Probably the worker that spawned it was terminated by the second `/reload`, so nothing waits for it. Harmless one at a time, but one per reload that hands the daemon over. Proposed row: **009-25 the daemon is not Pi's child**: the daemon is spawned so that Pi is not its parent (a detached intermediate that exits at once), or from the main thread.
3. **`squeal setup` does not know Pi.** Setup (005 D3), Pi-only home. Severity: does not block shipping; the plan misleads, delivery is unaffected. The plan lists only `claude-code: not on the PATH` and `codex: not on the PATH`, says `AGENTS.md (also CLAUDE.md): read by claude-code and codex` although Pi loads `AGENTS.md` (the TUI's `[Context] AGENTS.md`), and has no Pi line, while Pi was installed and is the user's only harness (`dogfood/logs/setup*.txt`). Nothing breaks, since the Pi extension needs no setup, but a Pi user reads a plan about two harnesses they do not have. Proposed row: **009-26 setup knows Pi**: setup lists Pi with its install state from Pi's settings (as D7's status line does), and names Pi among the readers of `AGENTS.md`.

## Observations

1. **The Vitest typecheck project is not run, and the primer says "Squeal covers Vitest".** remeda's `types` project (142 `*.test-d.ts`, `typecheck.only`) has no results; setup's plan said "runs all 175 test files" without naming the 142 it leaves out. Per edit Squeal says "No result for … no test Squeal runs reads them. Run whatever tests them yourself." gpt-6-astra edited four `*.test-d.ts` files and never ran them; grok-4.7 ran them. Worth a 001 or 005 row: the plan and the primer name a typecheck project as not covered.
2. **A deny in a parallel batch leaves the batch half applied.** Pi fires `tool_call` for every call of a batch before any runs (009-19's note), so the deny falls on the first edit and the rest apply: s3's source edit was denied while its three test edits landed. D3's "blocked once" holds; the agent recovered by re-reading. Not a defect; worth knowing when reading a deny.
3. **A report can widen an explicit scope.** grok-4.7 edited a test the user had put out of scope after a FAIL (above). The FAIL text gives no instruction; the skill's "Done when each FAIL is fixed or you can say why it stays" does. A clause there, "the user's instructions decide which; say why it stays when they limit the change", would cover it. Seen once in four models.
4. **Results of a file that failed to load stay current after the missing build appears.** Core (001), outside Pi. remeda's six `funnel.*` files and `stackblitz-template/src/runtime.test.ts` import the built `remeda` package; before `npm run build` they failed to load and were stored FAIL. Building `dist/` (git-ignored) did not re-key them; they stayed "current" FAIL with the old reason until `squeal run --all --force`. A file that fails before it resolves an import has no recorded read of the ignored path. The 007 Later entry on runtime reads is the nearest row.
5. **The daemon stops 3 s after the last session ends** ("no session registered for 3 s after its last one ended"), so in RPC each Cezar session started its own (as 001 D10 says). Each stop also reaps an `esbuild --service` child the Vitest runner left; Squeal notes and stops it each time.

## Cleanup

At the end (2026-10-14 23:06, load 37 and falling) nothing ran as `squeal-e2e`: no Pi, no Squeal daemon, no proxy, no tmux server (`ps -u squeal-e2e` empty). The remeda clone is clean at `8e6e78f`.

Kept in `/home/squeal-e2e`: `dogfood-009/` (972M: the sandbox HOME with the installed Squeal packages, Pi's agent dir with the session files, the remeda clone, the raw proxy logs, the archives and `scripts/`), `.npm-global` (the npm prefix with `pi`), `.npm`, and the shell dotfiles.

Deleted: 009's own leftovers, `pi-isolation` (009-16) and `pi-sessions-packaging-probe` (009-02).

Left for their owners, on the coordinator's decision: `runs/rel-0168` (005, the 0.1.168 release baseline), `008-plugins`, `008-sessions`, `opencode-isolation`, `opencode-wave0` and the dotdirs `.cache/opencode`, `.config/opencode`, `.local/share/opencode`, `.local/state/opencode` (008), and `pee`, `.cache/briefcase`, `.codex` and `.nvme-check-*` (not 009's; owner not identified here).
