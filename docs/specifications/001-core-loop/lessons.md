# 001 Core validation loop: dogfooding lessons

Task 001-41, 2026-10-04. Squeal at commit `e8abd21` (wave 3.5 landed), run on a clone of this repository and on a small fixture project with the real Claude Code CLI. Inputs: the "Inputs for wave 4" section of `reviews/wave-3.md`.

## Verdict

The loop works on a real codebase. Across 25 `-p` sessions and 6 attended sessions, 38 entries were delivered at tool boundaries (37 transitions and one retired check), and 3 more woke an idle agent. None was delivered twice. Every one arrived at the first hook that may carry it. Agents read every delivery, and in no session did a delivery or a denial stall the agent or start a loop. The marketplace entry that `squeal init` writes installs, and the installed copy starts a daemon from SessionStart.

Three things limit it on this repository. First, a source edit here re-runs 35 to 80 test files, in tiers ordered by path, and the first tier holds a 47 s test file, so a `-p` session usually ends before the edited module's own test runs. Second, a revision can lag the workspace by a whole tier (defect 1). Third, one test reads build output at runtime, which the static closure cannot see, so Squeal kept a false "FAIL, current" for it until `inputs` was declared.

Goals 1, 2, 4, 5, 6 and 7 held within what was measured. Goal 3 did not hold in full: defect 1 lets the header and status present a revision that the workspace has already moved past, for up to 45 s here. The 001 row in `../README.md` stays `in-progress`.

## Setup

| Item | Value |
| --- | --- |
| Claude Code | 2.1.288, `DISABLE_AUTOUPDATER=1`, `--setting-sources project --strict-mcp-config`, model `claude-sonnet-5-5` in every session |
| Permissions | `-p` with `--permission-mode acceptEdits` and an allow-list: `Bash(git:*)`, `Bash(grep:*)`, `Bash(ls:*)`, `Bash(cat:*)`, `Bash(npx vitest:*)`, `Bash(npm test:*)`, `Bash(npm run:*)`, `Bash(squeal:*)`, `Bash(sleep:*)`, Read, Edit, Write, Glob, Grep. Agents could run tests themselves. |
| Environment | The parent session's `CLAUDE*` variables removed from every probe after the first four (they carried `CLAUDE_CODE_SESSION_ATTENDED=0` and `CLAUDE_CODE_ENTRYPOINT=sdk-cli`). Real `HOME` for authentication. Built-in plugins still load: `cc-plugin-sec-default`, `cc-plugin-agents-md`, `cc-plugin-telemetry`, `cc-plugin-plugin-authoring`. |
| Machine | Linux 6.8, 24 cores, Node 24.21.0, load average 2.6 to 12 (other wave 4 workers ran at the same time) |
| This repository | A local clone of `e8abd21` at `/tmp/squeal-dogfood/repo`, `npm ci`, `bin/squeal init` from the clone's plugin, committed. Plugin loaded with `--plugin-dir <clone>/plugins/claude-code`. 86 test files, 756 checks after the baseline. |
| Fixture | `/tmp/squeal-dogfood/fix`: `git init`, three modules (`money`, `invoice`, `format`), four test files with 15 tests, one of them a 2.5 s stand-in for an integration test, `npm install -D vitest@5.0.3`. Plugin from the marketplace install (below), loaded with `--plugin-dir <install path>`. |
| Interactive | `tmux` session, same flags without `-p`, plus `--debug hooks --debug-file` for the `/exit` probes |
| Policy | Defaults, then `stop.waitMs: 1500` for the Stop probes, and `inputs: ["plugins/claude-code/dist/**"]` in the clone from P3 on (see surprise 2) |
| Drivers | A Node driver that timestamps every `stream-json` line (`--verbose --include-hook-events`), store queries over `node:sqlite` for revisions, runs and transitions, and transcripts under `~/.claude/projects/` for the attended sessions. All scratch lived under `/tmp/squeal-dogfood`, outside every checkout. |
| Cost | $1.56 for the 25 `-p` sessions; the attended sessions are not metered here |

## Sessions

| Id | Where | Prompt (shortened) | Squeal said | Agent did |
| --- | --- | --- | --- | --- |
| P0 | repo, no store yet | "Reply with the single word OK." | nothing; SessionStart started the daemon and the baseline | Replied. |
| C1 | repo, no plugin (a relative `--plugin-dir` path that Claude Code ignored silently) | change the fingerprint separator `' @ '` to `' at '` | nothing (not loaded) | Updated 3 assertions, said the other `' @ '` strings were fixtures. 8 tests in 5 files broke; the daemon found all 8 within 102 s of the edit. |
| P1 | repo | file-level checks print `' [file]'` instead of `' (file-level)'` | registration only | Grepped, updated 3 test files, ran those 3 files itself, ended at 24.5 s. Squeal's first result came 80 s after the edit: the committed bundles were stale. |
| P2 | repo, `--resume` of P1 | "Anything left to do before I commit this?" | registration header with 1 known failure (stale bundles) | "Yes. Squeal reports one failing test", rebuilt the bundles, re-ran that test. |
| P3 | repo | add `parseCheck` edge-case tests | registration only | Added 4 tests, ran the file itself. Squeal knew the result 502 ms after the edit. Silence (first-seen passes). |
| P4 | repo | rename a vague test | registration only | Renamed it. Retired and new check, both silent. Result known 279 ms after the edit. |
| P5 | repo | move socket-path helpers to a new module, update imports under `src/` only, leave `test/` alone | 3 PreToolUse denials, 2 PostToolBatch deltas, 22 entries | Re-issued each denied edit, said the failures were expected because tests still import the old module, listed the bundle test as needing a rebuild. |
| F1 | fixture | integer math in `percentOf`, add `subtract` and `credit` | PostToolBatch delta, Stop delta | Loaded the Squeal skill on its own, read the failing test, pulled `squeal status`, then reported 3 failures and offered two fixes. |
| F2 | fixture | Polish number format, then a README | registration only | Updated the tests with the code, ran `npm test`. Nothing to report. |
| F3 | fixture | rename `unitPrice` to `price`, add `discount` and `lineCount` | registration only | Updated the tests with the code, loaded the skill, ran `sleep 20; squeal status` to wait for 8 running checks. |
| F4 | fixture | `toCents` truncates, then JSDoc everywhere | 1 PreToolUse denial, 1 RESOLVED | Did another edit first, then re-issued the denied edit in the same batch as reading the failing test, then replaced the test. |
| S1 to S8 | both | one small change each, `stop.waitMs: 1500` | see the Stop table | Summarised Stop deltas and asked before touching tests. |
| Q9a | fixture, `toCents` broken from outside | add header comments to two test files | `FAIL -> FAIL, failure changed` (line 6 to 7) | Called it a line shift and left it. |
| Q9b | fixture, `vitest.config.ts` broken from outside | "vitest.config.ts has a syntax error. Fix it." | header `19 unknown`, then `UNKNOWN -> FAIL` | Fixed the config, loaded the skill, pulled status, traced the failure to the outside change. |
| D1 | fixture, daemon `SIGSTOP`ped | currency before the amount | header with the liveness line | Read the liveness line and status, said Squeal's "0 failures" did not cover its change, ran Vitest itself. |
| SUB1 | repo | one general-purpose subagent | SubagentStart registration | Subagent got its own consumer; SubagentStop unregistered it. |
| WT2 | second worktree of the clone | "Reply OK" | registration at revision 0 | Baseline was a lookup (see measurements). |
| W1 to W3 | fixture, attended `tmux` | read-only question, then idle | 3 waiter wakes | See the waiter section. |

## Measurements

### Delivery

| Measure | Value |
| --- | --- |
| Entries delivered in `-p` sessions | 38 (37 transitions plus 1 retired check), in 13 sessions |
| Duplicate deliveries | 0 within any session (one consumer); 0 between the waiter and PostToolBatch |
| Deliveries that skipped an eligible hook | 0 of 37. Six recoveries or changed failures passed one or two PreToolUse calls, which carry regressions only by design (D9). |
| Edit to result known (transition recorded) | n=37, min 187 ms, p50 2,384 ms, p95 4,052 ms, max 5,579 ms (fixture tiers hold a 2.5 s test; repository tiers in P5 ran 0.5 to 2.4 s because the broken imports failed fast) |
| Result known to delivered | p50 471 ms, p95 6,158 ms, max 6,158 ms. The long ones are a model writing its final message before Stop. |
| Edit to delivered, the vision's "transition-to-delivery latency" | p50 2,718 ms, p95 10,210 ms |
| Edit to first result on this repository, source edit that reaches `test/cli/*` | P1: 80.2 s to the first transition; the edited module's direct test ran 47 s after the edit in C1 and 58 s in P1. The first tier, `test/cli/*` plus `test/daemon/lifecycle.test.ts`, took 45.7 to 47.6 s each time. |
| Repository sessions that ended before their first result | P1 and S4. In S7 and S8 the Stop wait reached the first results; in P5 the broken imports failed within a second. |
| Revision lag behind a running tier (defect 1) | P1: edits at 11.4 to 17.3 s became revisions at 57.2 s. Lag probe: third edit at +6.0 s, revision at +10.5 s. |

Silence held where it should: P3 (four first-seen passes), P4 (a rename), F2 and F3 (tests updated with the code), Q9b (18 recoveries from `unknown`).

### Baseline and inheritance

| Measure | Value |
| --- | --- |
| `npx vitest run` on the clone | 49.7 s wall, 86 files, 663 passed, 7 skipped |
| Squeal baseline, first worktree | 138.5 s from SessionStart to a completed checkpoint, 22 tiers of up to 4 files, one run at a time; longest tier 46.8 s |
| Squeal baseline, second worktree (`git worktree add`, `npm ci`) | 1.1 s to a completed checkpoint, 0 runs, 760 of 760 results inherited (737, 12 and 11 from three commits of the first worktree) |
| Restoring files to stored content (`git checkout .`) | All transitions within 79 ms of each other; no run |
| Full re-run after declaring `inputs` (policy reload) | 117 s, 22 tiers |
| Store after 40 minutes, 34 revisions, 95 runs, 3,235 results | 13.6 MB plus 4.3 MB WAL. The size includes 30,400 view rows my latency harness leaked and then removed (SQLite keeps the pages). |
| Daemon busy time in those 40 minutes | 728 s of test runs, for 9 coding sessions and the probes around them |

### Hooks

Cold runs of each bundle with recorded hook JSON against the clone's store (761 checks, daemon alive, one consumer registered), 40 runs per round, best of 3 rounds as `test/harness/latency.test.ts` does. Load average 2.8 to 3.9 on 24 cores. `node -e 0` alone: p50 49, p95 54 ms.

| Hook | p50 ms | p95 ms | Fixture store (19 checks), p95 ms |
| --- | --- | --- | --- |
| session-start, new session, registers | 84 | 93 | 74 |
| subagent-start, new agent, registers | 82 | 98 | 86 |
| post-tool-batch, quiet | 71 | 76 | 85 |
| pre-tool-use, quiet | 74 | 89 | 83 |
| stop, quiet | 82 | 86 | 88 |
| session-end | 63 | 74 | 83 |
| waiter, `-p` guard | 54 | 58 | 63 |

PostToolBatch met its 80 ms p95 budget in the best round and missed it in the other two (98 and 87 ms). PreToolUse, Stop and the registering hooks were over 80 ms in every round. On the fixture store (one round) the quiet hooks measured the same, so on this machine the margin is Node start-up plus load; registration p95 was 74 ms there against 93 ms here. Registration seeds one view row per check: SessionStart and SubagentStart cost about 12 ms more than a quiet PostToolBatch at 761 checks. Seen from inside Claude Code (from `hook_started` to `hook_response`, Claude Code's own spawn included), over all sessions: PostToolBatch quiet p50 79, p95 128 ms (n=47), with a delivery p95 89 ms (n=5); PreToolUse quiet p50 85, p95 129 ms (n=40), denying p95 117 ms (n=4); SubagentStart with registration 134 ms (n=1). The largest synchronous hook duration observed was 1,616 ms (Stop with `waitMs: 1500`). No hook reached its 2 s timeout.

### Stop with `stop.waitMs: 1500`

| Session | Checks pending at Stop | Stop hook ms | Outcome |
| --- | --- | --- | --- |
| S1 fixture | yes | 1,388 | Caught: 4 failures recorded 1,372 ms into the wait, delivered |
| S2 fixture | no (result known before Stop) | 86 | Nothing to say (first-seen pass) |
| S3 fixture | no (the agent had polled with `sleep 2; squeal status`) | 84 | Nothing to say |
| S4 repo | yes, the 47 s tier | 1,616 | Missed; the change broke nothing, so nothing was ever due |
| S5 repo | no (test-only edit, result in 0.4 s) | 115 | Nothing to say |
| S7 repo | yes | 1,590 | Caught: 2 failures recorded 1,471 ms into the wait. The second Stop of the turn waited 1,576 ms and said nothing (96 checks still pending). |
| S8 repo | yes | 1,603 | Results known 131 ms before Stop, delivered only at the cap, because the wait ends when nothing is pending, not when there is news |
| F1 fixture, `waitMs: 0` | no | 109 | Delivered 2 failures known 6.2 s earlier |
| P1 repo, `waitMs: 0` | yes | 86 | Nothing; the first result came 65 s later |

Of 5 Stops with checks pending, the wait caught a result in 2 (S1, S7). It held a known result back for 1.5 s in 1 (S8). It cost 1.5 s for nothing in 2 (S4, second Stop of S7). Each Stop delta started another model turn, as wave 3 probe G found. In every case the model summarised the failures. In S1, S7 and S8 the task said "just that change", so the model asked before editing tests. It never edited without being asked.

### Interactive waiter

Attended `tmux` session on the fixture. The session was idle; `src/money.ts` was edited from outside with fresh content each time.

| Probe | Result known (from edit) | Waiter consumed | Visible in the session | Note |
| --- | --- | --- | --- | --- |
| W1 idle, `PASS -> FAIL` | +2,756 ms | +181 ms after known | pane changed +264 ms after known | Agent investigated: read the test, `git status`, ran Vitest (after a permission prompt), `git diff`. Said the change was not its own and left it. |
| W2 idle after `/clear`, `FAIL -> PASS` | +2,796 ms | +39 ms | +93 ms | New session id, new consumer and new waiter after `/clear`; the old consumer was unregistered by SessionEnd (`reason: clear`). The agent summarised and asked for a task. |
| W3 during `sleep 15`, `PASS -> FAIL` | +2,766 ms | +246 ms (queued as a task notification) | +8,517 ms, when the Bash call returned | The waiter took the delta before PostToolBatch; PostToolBatch then had nothing. The model saw it only after the tool ended. |

Claude Code frames the waiter's text as "Stop hook feedback" in the UI and as `Stop hook blocking error from command "Stop": SQUEAL · ...` in the transcript. Agents still read it as a report ("A stop hook reports that ...", "The squeal Stop hook also reports a regression"). At exit Claude Code kills the armed waiter and logs `[ERROR] Hook SessionStart:clear (SessionStart) error: status code 137` (or `Hook Stop (Stop)`), which is noise in debug logs. One of six `/exit`s left the consumer registered (defect 5). Not tested: compaction and interactive `--resume` (`-p --resume` re-registers, P2).

### Daemon liveness

| Measure | Value |
| --- | --- |
| Sessions that started with no daemon | 3 (P0, WT2, the marketplace session), each started one from SessionStart |
| Sessions that ran while no daemon validated | 0 of 30 without forcing it |
| Forced: daemon `SIGSTOP`ped 11 s before D1 | Registration header carried `No daemon has validated since 2026-10-04T14:44:08.168Z; results are as of revision 30.` The agent loaded the skill, ran `squeal status`, and said: "Squeal's status is still at revision 30, which is the revision before my edits, and no daemon is running. Its "0 failures" doesn't cover my change, so I'll run the tests directly." After `SIGCONT` the daemon caught up in 5 s. |

## What agents did with deliveries

| Delivery | Count | Reaction |
| --- | --- | --- |
| Registration header with known failures or unknowns | 3 (P2 and Q9a with a known failure, Q9b with 19 unknown) | Fixed them when the task allowed it (P2), otherwise named them as pre-existing and traced the cause (Q9a, Q9b). |
| PostToolBatch new failure mid-task | 3 sessions (F1, S7, Q9b) | Read the failing test, pulled `squeal status` (F1, Q9b) or grepped the expected strings (S7), reported the cause. |
| PreToolUse denial | 4 in 2 sessions | Re-issued the denied edit every time; see open question 3. |
| Stop delta | 4 sessions (F1, S1, S7, S8) | Another turn: a summary, a cause, and a question before touching tests. In S7 it ran `sed` and `grep` on the failing tests first. |
| `FAIL -> PASS`, `RESOLVED` | 4 | No action needed and none taken. F4: "The Squeal hook flagged it as a regression and blocked my first JSDoc edit, so I replaced it". |
| `FAIL -> FAIL, failure changed` | 3 | Q9a: named the line shift. P5: no comment on the lifecycle file's random-path change (defect 2) or on the bundle test's new message. |
| Waiter wake while idle | 3 | Investigated a break it had not caused (W1); acknowledged a recovery with no task (W2); folded the news into its answer (W3). |

How agents validated, over the 18 sessions with edits under the plugin: 5 ran tests themselves (P1, P3, F2, F4, and D1, which had a reason), 5 pulled `squeal status` or loaded the skill (F1, F3, S3, Q9b, D1), and 9 did neither. Agents loaded the Squeal skill unprompted 5 times after seeing the registration header ("The repo uses Squeal, so I'll load the skill before verifying."). Twice an agent waited for pending checks with `sleep` (F3: `sleep 20; squeal status`, 20 s while the result came after about 2.5 s; S3: `sleep 2; squeal status`). In S4 the agent read the header's "Full suite: not completed at revision 21, last completed at revision 0" as "the state before the change is not confirmed".

## Transcript excerpts

Sanitized: session ids and tool-use ids removed, long lines shortened with `...`. Scratch paths kept.

P2, resumed session, registration header and the first reply:

```text
SessionStart: SQUEAL · registered at revision 9
Revision 9: 756 current, 0 pending, 0 stale, 0 unknown. Full suite: not completed at revision 9, last completed at revision 0.
Known failures: 1

FAIL  test/harness/plugin.test.ts > bundles > are committed exactly as `npm run build` produces them
      cli/squeal.mjs: expected '#!/usr/bin/env node\nvar __defProp = …' to be ...
ASSISTANT: Yes. Squeal reports one failing test: `test/harness/plugin.test.ts` checks that the committed
  bundles match what `npm run build` produces, and they're stale. I'll regenerate them.
```

P5, first PreToolUse denial, 839 ms after the edit that caused it, and the reaction:

```text
+16494 PreToolUse deny: SQUEAL · 2 checks changed at revision 15
  Revision 15: 632 current, 128 pending, 0 stale, 0 unknown. Full suite: not completed at revision 15, ...
  FAIL  test/cli/daemon-commands.test.ts > daemon commands: usage and no-daemon answers > stop and run --all ...
        PASS -> FAIL
        socketPathFor is not a function
        at src/cli/daemon-access.ts:44:10
  FAIL  test/daemon/hardening.test.ts [file]
        PASS -> FAIL
        Command failed: .../node node_modules/typescript/bin/tsc -p tsconfig.build.json --outDir
        node_modules/.cache/squeal-test/d80d9776-.../dist ... (1 more error
  Squeal policy interrupt.onRegression denied this Edit call, so the edit was not applied. The same call
  can be re-issued; this regression does not deny again.
+16501 TOOL_RESULT ERROR PreToolUse:Edit hook error: SQUEAL · 2 checks changed at revision 15 ...
+17291 PreToolUse deny: SQUEAL · 11 checks changed at revision 15 ...       (the next edit, other file)
+20779 ASSISTANT: The failures are the expected ones. The old tests still import the moved helpers from
  `paths.js`, and the teammate is fixing that. I'll re-issue the two denied edits.
+21699 PreToolUse deny: SQUEAL · 4 checks changed at revision 17 ...        (the re-issued edit, new regressions)
+22255 PostToolBatch: SQUEAL · 1 check changed at revision 17 ... PASS ... FAIL -> PASS
+24894 PostToolBatch: SQUEAL · 4 checks changed at revision 18 ... FAIL -> FAIL, failure changed ...
```

F4, a natural denial and what followed:

```text
+6769  Edit src/money.ts (toCents truncates)                       ok
+9498  Edit src/invoice.ts (JSDoc on lineTotal)                    ok
+11543 PreToolUse deny on Edit src/invoice.ts (JSDoc on totals):
       FAIL  test/money.test.ts > money > rounds half cents / PASS -> FAIL / expected 12 to be 13 ...
+13171 Edit src/format.ts (JSDoc)                                  ok
+16242 Edit src/invoice.ts (JSDoc on totals, re-issued)  +  Read test/money.test.ts   (one batch)
+19042 Edit test/money.test.ts: "rounds half cents" replaced by three truncation tests
+22970 PostToolBatch: RESOLVED  test/money.test.ts > money > rounds half cents
                              FAIL -> no longer reported by the runner
```

S1, Stop delta caught by the wait, and the extra turn it started:

```text
+5681 Stop started (waitMs 1500)
+7069 Stop: SQUEAL · 4 checks changed at revision 20 ... FAIL  test/format.test.ts > formatCents > formats euros
      PASS -> FAIL / expected '1234.56 PLN' to be '1234.56 EUR' ...
ASSISTANT: The change is made, but 4 tests now fail. Each one hard-codes the old EUR default ...
  You asked for just the one change, so I haven't touched the tests. Do you want me to update those
  expectations to `PLN`?
```

W1, attended session, idle, test broken from outside:

```text
● Stop hook feedback
● A stop hook reports that test/money.test.ts > rounds half cents flipped from PASS to FAIL. I haven't
  edited anything, so I'll read the test to see what it expects.
...
● The failing test is real, but I didn't cause it, and I haven't edited anything.
  - Cause: src/money.ts has an uncommitted change in toCents. Math.round(amount * 100) became
    Math.floor(amount * 100); // w1. ...
```

S4, translated from Polish (one session answered in Polish; probably user-level memory, which `--setting-sources project` does not exclude):

```text
I changed SUMMARY_MAX_CHARS from 300 to 400 in src/core/state/fingerprint.ts:4. Nothing else. I did not run
the tests or Squeal. The start hook showed the full suite as not completed since revision 0, so the state
before the change is not confirmed. If any tests assume the 300-character limit, they may now fail.
```

## Surprises

1. **Barrel imports make every source edit wide, and the first tier slow.** Closures here are transitive through `index.ts` barrels: `src/core/state/fingerprint.ts` is in 35 closures, `src/core/fs/compare.ts` in 80 of 86. The scheduler's `direct` priority means "the test file itself changed" (`src/core/scheduler/queue.ts`), so the edited module's own unit test ranks with every other affected file, by queue order and path. `test/cli/*` and `test/daemon/lifecycle.test.ts` come first and take 47 s. The direct test of the edited module ran 47 s after the edit in C1 and 58 s after it in P1 (defect 3).
2. **Runtime reads escape the closure, and `inputs` is all-or-nothing.** `test/harness/plugin.test.ts` reads `plugins/claude-code/dist/` at runtime. After P2 rebuilt the bundles, `squeal why` said "Known state: FAIL, current" while `npx vitest run` passed it. This is the only stale-result escape observed. The fix, `inputs: ["plugins/claude-code/dist/**"]`, puts the bundles into every test file's closure: 117 s to re-run all 86 files, and every later bundle change re-runs the suite. Per-test-file inputs would cost one file.
3. **Agents still run tests themselves, and wait with `sleep`.** See "What agents did". Nothing in the header tells an agent how long pending checks will take, and there is no blocking way to wait for them.
4. **The waiter is idle wake-up, and only that.** A delta found during a long tool call is queued 246 ms after the result and shown when the tool returns (W3).
5. **A recovery wakes an idle agent.** W2 cost a model turn whose answer was "I haven't received a task since the /clear". Correct by the vision ("closure when a failing check passes again"), but it is a paid turn with nothing to do.
6. **Claude Code calls Squeal's text an error.** "PreToolUse:Edit hook error: SQUEAL ..." and "Stop hook blocking error from command "Stop": SQUEAL ...". No agent was confused by it.
7. **"Full suite" reads as a caveat on everything.** A revision fully satisfied by lookups (P1's restore, revision 4) says "has not completed a full-suite run", while a second worktree whose baseline was the same lookups says "completed". Both follow D7 (a checkpoint is a request, not a coverage state). One agent read the clause as "the state before the change is not confirmed" (S4).
8. **Mid-refactor states are real regressions for a few seconds.** In P5, `daemon-commands` failed at revision 15 (`socketPathFor is not a function`) and passed at revision 17, as the agent finished moving the imports. It cost one denial and two deliveries.
9. **Claude Code does not use `GH_TOKEN` for a private marketplace; git credentials do.** In this sandbox the egress proxy authenticates GitHub, so `claude plugin marketplace add hearsay-tools/squeal` worked with `GH_TOKEN` unset and the user git config disabled (`GIT_CONFIG_GLOBAL=/dev/null`). With the proxy variables removed and `GH_TOKEN` set, it failed: `HTTPS authentication failed. Please ensure your credential helper is configured (e.g., gh auth login)`, with git's own `fatal: could not read Username for 'https://github.com': terminal prompts disabled`, then the SSH fallback `Permission denied (publickey)`. Git got no credentials at all, so Claude Code did not pass the token on. (The token here is also not valid against GitHub directly; it works only through the proxy.) `claude plugin marketplace add` has no token option. For collaborators on the private repository, the README should say that `gh auth login` (or any git credential helper, or SSH keys) is the prerequisite.
10. **Claude Code ignores a `--plugin-dir` that does not exist, silently.** C1 ran without Squeal because of a relative path; `init.plugins` was the only sign.

### Marketplace install transcript

Run in the fixture with a scratch `CLAUDE_CONFIG_DIR`, so the user's plugin state was not touched:

```text
$ CLAUDE_CONFIG_DIR=$S/cfgA claude plugin marketplace add hearsay-tools/squeal
Adding marketplace…SSH not configured, cloning via HTTPS: https://github.com/hearsay-tools/squeal.git
Cloning repository (timeout: 120s): https://github.com/hearsay-tools/squeal.git
Clone complete, validating marketplace…
✔ Successfully added marketplace: squeal (declared in user settings)

$ CLAUDE_CONFIG_DIR=$S/cfgA claude plugin install squeal@squeal --scope project
Installing plugin "squeal@squeal"...✔ Successfully installed plugin: squeal@squeal (scope: project)

installed_plugins.json: installPath $S/cfgA/plugins/cache/squeal/squeal/0.0.0, gitCommitSha e8abd21..., scope project
diff -r <installPath> <git archive HEAD plugins/claude-code>: only .in_use differs
<installPath>/bin/squeal --version: 0.0.0

$ CLAUDE_CONFIG_DIR=$S/cfgA claude -p "Reply OK" --setting-sources project ...   (no plugin flag)
init.plugins: squeal@squeal  $S/cfgA/plugins/cache/squeal/squeal/0.0.0
SessionStart x2: exit 0          -> daemon: node <installPath>/dist/cli/squeal.mjs daemon /tmp/squeal-dogfood/fix
result: "Not logged in · Please run /login"   (the scratch config has no credentials, by design)
```

`claude plugin install` rewrote `.claude/settings.json` with the keys reordered, nothing else. The plugin loaded from the `enabledPlugins` entry `squeal init` wrote, and its SessionStart started a daemon from the installed copy. The model call is the only step not shown on that path; every fixture session after it ran the same installed copy through `--plugin-dir`.

## Open questions: evidence

**1. Inherited passes: current at once, or stale until confirmed?** A second worktree inherited 760 of 760 results with 0 runs: baseline 1.1 s instead of 138 s. The one stale-result escape observed (surprise 2) was the first worktree's own result, under a closure that cannot see runtime reads. Inheritance would copy it, but did not cause it. Re-verifying inherited passes would have cost 138 s of runs per new worktree on this repository and would not have caught that escape any sooner than an own re-run. Proposed: keep inherited results current. Spend the effort on closure completeness instead (per-test-file `inputs`).

**3. PreToolUse wording, and whether default-on survives.** 4 denials in 2 of 18 editing sessions. The model re-issued the denied edit in all 4 cases and never stalled or looped. P5 decided from the denial text alone: "The failures are the expected ones ... I'll re-issue the two denied edits." F4 first made a different edit, then re-issued the denied edit in the same batch as reading the failing test, then fixed the test. So without scripted instructions the model reads the failure; it looks at the test file in the same step as the re-issue, not before it. The cost was one extra tool call per denial. 2 of the 4 denials were for transient mid-refactor failures (surprise 8). Natural denials are rare: Sonnet 5.5 usually updated the tests together with the code, and tiers often finished after the agent's last edit. Proposed: keep it on by default and keep the wording. Claude Code's "hook error" prefix did not mislead the model.

**6. Long tool calls delay delivery. Ship a plugin `monitor`?** The waiter took a delta 246 ms after the result while `sleep 15` ran, and Claude Code queued it as a task notification until the tool returned, 8.5 s later (W3). A monitor's output would wait in the same queue for the same tool boundary; this was inferred from the waiter, not tested with a monitor. In the `-p` sessions the long tool calls were the agents' own: `sleep 20; squeal status` (20 s) and test runs (1.5 to 3 s). Proposed: no monitor in v1. A blocking pull (`squeal status --wait <ms>`, returning when nothing is pending at the current revision or when news arrives) would replace the `sleep` polling, which was the longest tool call seen.

**9. Silent recovery from `unknown`, and line and column in the fingerprint.** Q9b: a broken `vitest.config.ts` made 19 checks `unknown`. After the fix, 18 recoveries arrived silently and 1 `UNKNOWN -> FAIL` was delivered. The header's "19 current, 0 unknown" carried the recovery, and the agent pulled status anyway. Q9a: a header comment moved a failing assertion from line 6 to line 7 and was delivered as `FAIL -> FAIL, failure changed`; the agent said "the only change is that it now reports line 7 instead of line 6" and did nothing. Real noise came from somewhere else: a first error line with a random temp path changes the fingerprint on every re-run (defect 2). Proposed: keep both behaviours, and normalize UUIDs and temp paths in the fingerprint.

## Goals 1 to 7

| Goal | Held? | Evidence |
| --- | --- | --- |
| 1 `PASS -> FAIL` within one tool call, same turn | Yes, when the result came within the turn | 37 of 37 at the first eligible hook. On this repository many results come after a `-p` session ends (P1, S4), because of surprise 1. |
| 2 `FAIL -> PASS` the same way; silence otherwise | Yes | Recoveries at the next PostToolBatch; silence in P3, P4, F2, F3, Q9b. Spurious "failure changed" from defect 2. |
| 3 Everything told is true when told | No, not in full | Defect 1: the revision the header names can lag the files by a whole tier (45 s in P1). Surprise 2: a false "FAIL, current" from a runtime read, a non-goal by construction. |
| 4 Inheritance by lookup | Yes | 760 of 760, 0 runs, 1.1 s |
| 5 `squeal status` answers | Yes, with gaps | Defects 4, 6 and 7 |
| 6 No hook blocks past its timeout; dead daemon degrades | Yes | Max 1,616 ms; a `SIGSTOP`ped daemon gave a liveness line, not a stall |
| 7 One store, several worktrees and agents | Yes, as far as exercised | Two worktrees, main agents and a subagent on one store; no lost write seen. Not stress-tested here. |

## Defects

Product defects hit while dogfooding. No product code was changed.

1. **A revision can lag the workspace by a whole tier.** `src/core/scheduler/scheduler.ts` `handleBatch` holds the scheduler lock across `applyRevision`, which awaits `runner.invalidate`. `src/runners/vitest/adapter.ts` serializes `invalidate` behind the running tier (`#serial`). So the first batch during a tier gets its revision row at once, and every later batch waits for the tier to end. Scenario: three edits 3 s apart while a tier runs; the third becomes a revision 4.5 s late (lag probe), or 45 s late when the tier holds `test/daemon/lifecycle.test.ts` (P1, C1). Meanwhile status and headers present the older revision, with checks "current" whose inputs have changed. D2 promises a revision within 500 ms of quiet.
2. **The fingerprint keeps random paths.** `src/core/state/fingerprint.ts` `VOLATILE` normalizes times, durations and addresses, not UUIDs or temp directories. Scenario: `test/daemon/lifecycle.test.ts` fails at load with `Command failed: ... --outDir node_modules/.cache/squeal-test/<uuid>/dist`, and every re-run is delivered as `FAIL -> FAIL, failure changed` (P5).
3. **The edited module's own test is not run first.** `src/core/scheduler/queue.ts` `priorityOf`: `direct` is "the test file itself changed", so tests that import the module through a barrel are `affected`, ordered by queue order and path. Scenario: an edit to `src/core/state/check-name.ts` runs `test/cli/*` and `test/daemon/lifecycle.test.ts` (47 s) before `test/status/why.test.ts` (P1). D5 step 4 asks for direct importers first. Vitest's module graph has the direct edges; ordering by last duration would also help.
4. **A fresh worktree registers with counts that read as complete.** SessionStart in a new worktree, right after spawning its daemon, injected `Revision 0: 0 current, 0 pending, 0 stale, 0 unknown. Full suite: not completed at any revision. Known failures: 0` with 86 test files not yet listed (WT2). The header reader (`src/core/state/header.ts`) has no class for "not listed yet", so nothing says the daemon has not looked.
5. **One interactive `/exit` left its consumer registered.** 1 of 6 `/exit`s (the attended session with three waiter wakes and a `/clear`); the next five, with and without turns, `/clear` and a wake, were clean, and the debug log of a clean one shows `SessionEnd:prompt_input_exit ... completed with status 0`. Not reproduced, cause unknown; `src/harness/claude-code/hooks/session-end.ts` and Claude Code's exit handling are the candidates. Consequence: the daemon cannot idle-exit for 12 h.
6. **Daemon notes keep ANSI colour codes.** `squeal status` printed `[31m[PARSE_ERROR] [0mExpected ...` from a runner note (Q9b). The note text comes from Vitest's error message unstripped (`src/core/scheduler/notes.ts` or the runner failure path).
7. **Status shows the worktree as clean when no daemon has looked.** With the daemon stopped and three files modified, `squeal status` printed `Worktree: /tmp/squeal-dogfood/fix (HEAD 1de13c7, clean)` (D1). At revision 0 on a clean tree it printed `dirty state unknown` (every session start). The dirty flag is the last revision's, without saying so.

## Not measured

- The cost of the full transform invalidation on add or delete (D4): no per-step timing is recorded.
- Compaction and interactive `--resume` with the waiter.
- macOS.
- Store concurrency beyond two worktrees, one subagent and the hooks.

## Re-run after waves 4.5 and 4.6

Task 001-46, 2026-10-06. Squeal at commit `6da5224` (waves 4.5 and 4.6 landed), run with the method of the Setup section above. Inputs: items 2 and 3 of "Spec 001 readiness" in `reviews/wave-4.5.md`.

### Verdict

The two limits this file named are gone. On this repository the edited module's own test finished 0.4 to 9.5 s after the edit, not 47 to 58 s, and a revision during a 47 s tier was recorded in 126 ms, with status at the new revision and its checks pending 183 ms after the edit. Across 21 `-p` sessions, 61 transitions were delivered, each at the first hook that may carry it, none twice. While a test file added during a tier was unlisted, no status read said nothing was pending: 496 of 501 reads said the runner part was pending, and the other 5 came after the listing. Agents never polled with `sleep`; two waited with `squeal status --wait`.

Goals 1 to 7 held. Three new defects, none a blocker (Defects, below). The worst is Claude Code's: after a typed prompt, an interactive `/exit` never runs SessionEnd, so 7 of 12 attended exits left their consumer registered. That is probably the cause of defect 5 above.

### Setup

Same as the Setup table above, with these differences.

| Item | Value |
| --- | --- |
| Claude Code | 2.1.288, same flags, model `claude-sonnet-5-5` in every session; `CLAUDE*` and `CEZ_*` variables removed from every session |
| This repository | `git clone` of `6da5224` at `/tmp/sq46/repo`, `npm ci`, `bin/squeal init`, `inputs: {"test/harness/plugin.test.ts": ["plugins/claude-code/dist/**"]}`, committed. 98 test files, 885 checks after the baseline. |
| Plugin | The clone's `plugins/claude-code` for P0, F0 to F7, R1 to R6 and A1. R2 and R6 ran `npm run build` in the clone, which rewrote the bundles under test (the `[file]` label of R1, the module move of R5). From S1 on, a `git archive 6da5224 plugins/claude-code` copy. The repository daemon was P0's, started from the unmodified bundle, for the whole run. A8 to A12 used a copy whose only change wraps the SessionEnd command in a script that logs its start and end. |
| Fixture | The fixture of the first run, rebuilt: 4 modules (`money`, `cents`, `invoice`, `format`), 4 test files, 24 checks, the 2.5 s integration test. `stop.waitMs: 1500` throughout; `stop.blockOnKnownFailures: true` from F7 on. |
| Repository policy | Defaults until R6; `stop.waitMs: 1500` from S1; `stop.blockOnKnownFailures: true` from S4. |
| Machine | Same 24-core host. Load average 18 to 56 for P0 and F0 to F6 (other workers), 20 for R1, 3 to 12 from R2 on. The hook latency round ran at 3.6 to 4.3. |
| Drivers | The stream-json timestamp driver, store queries, a tmux driver for attended sessions, and two probes that call no model: a status poller for item 8 and a Stop caller. Scratch under `/tmp/sq46`, outside every checkout. |
| Cost | $1.51 for 21 `-p` sessions, $0.79 for the attended sessions (from their transcripts' cost records), $2.30 in total |

### Sessions

| Id | Where | Prompt (shortened) | Squeal said | Agent did |
| --- | --- | --- | --- | --- |
| P0, F0 | repo, fixture | "Reply OK" | nothing; SessionStart started each daemon | Replied. Repository baseline: 446.7 s at load 18 to 55, 25 runs, longest 69.3 s. |
| F1 | fixture | default currency EUR to PLN, just that | Stop: 4 failures caught 3.4 s after the edit, inside the wait | Listed the 4 tests and asked before touching them. |
| F2 | fixture | bring tests in line with PLN | registration with 4 known failures; PostToolBatch 4 recoveries | Edited the tests, loaded the skill, then ran `npx vitest run` itself. |
| F3 | fixture | add a `subtract` test | registration only | The test already existed; ran the file, changed nothing. |
| F4 | fixture | rename a test, add one | silence | Ran the file itself. |
| F5 | fixture | move `toCents` to `src/cents.ts`, `src/` only | PostToolBatch 2 failures | Loaded the skill, ran `squeal status --wait 60000` (returned on quiet after 1.1 s with both failures), reported them as the move not yet reflected in `test/`. |
| F6 | fixture | update `test/` for the move | PostToolBatch 2 recoveries | Loaded the skill, ran `squeal status`, reported "no known failures", no full-suite run. |
| F7 | fixture, 6 failures from outside | add a JSDoc line, only that | Stop block: 6 failures exist at revision 14 | Traced them to the uncommitted change it had not made, asked which fix to apply. |
| R1 | repo | file-level checks print `[file]`, `src/` only | 3 PreToolUse denials, 5 failures | Re-issued the denied edit each time, said the failures were the tests a teammate was updating. |
| R2 | repo | bring `test/` in line with `[file]` | registration with 5 failures; 2 PostToolBatch deltas, 5 recoveries | Edited 3 tests, ran `npm run build`, ran the bundle test itself. |
| R3 | repo | add `parseCheck` edge cases | silence; known 534 ms after the edit | Ran the file itself. |
| R4 | repo | rename the vaguest fingerprint test | silence; known 333 ms after the edit | Renamed it. |
| R5 | repo | move socket-path helpers to a new module, `src/` only | 2 PostToolBatch deltas, 23 failures | Could not typecheck (not in the allow-list), reported the failures as `test/` still importing the old module. |
| R6 | repo | update `test/` for the move | registration with 23 failures, then nothing for 135 s | Edited 6 files, ran `npm run build`, `typecheck`, `lint` and two Vitest runs of 26 files (47 s each). See surprise 2. |
| S1 | repo | reword the RESOLVED line, just that | Stop: 2 failures, known before Stop, delivered at the 1.5 s cap | Updated the test, rebuilt the bundles, ran 2 files itself. |
| S2 | repo | `SUMMARY_MAX_CHARS` 300 to 400 | PostToolBatch: bundle test fails | Loaded the skill, ran `squeal status --wait 30000` (timed out, 66 pending), reported the bundle failure and the pending checks. |
| S3 | repo | status label "Known failing checks", just that | Stop: 1 failure caught in the wait; second Stop: 5 failures held to the cap | Explained each and asked. |
| S4 | repo, block on | update `test/` for the label | Stop block: 7 failures exist; 2 PostToolBatch deltas | Found a missing space in the source, fixed it, ran 10 test files itself. |
| S5 | repo | shorten user-facing wording in `liveness.ts` | registration only | Found none, changed nothing. |
| S6 | repo | reword "Returned on quiet", just that | nothing; the Stop wait missed the 9.5 s result | Made the change, said it ran no tests. |
| A1 to A12 | fixture, attended `tmux` | see Interactive | 3 waiter wakes | See Interactive. |

### Comparison

| Measure | First run (`e8abd21`) | Re-run (`6da5224`) |
| --- | --- | --- |
| `-p` sessions; with edits | 25; 18 | 21; 17 |
| Transitions delivered in `-p` sessions | 37 plus 1 retired check, in 13 sessions | 61, in 11 sessions (44 PostToolBatch, 12 Stop, 5 PreToolUse) |
| Duplicate deliveries | 0 | 0 |
| Deliveries that skipped an eligible hook | 0 of 37 | 0 of 61 |
| Edit to result known, per transition | n=37, min 187, p50 2,384, p95 4,052, max 5,579 ms | n=60, min 208, p50 1,555, p95 11,566, max 11,570 ms |
| Result known to delivered | p50 471, p95 6,158 ms | p50 1,417, p95 3,889, max 4,215 ms |
| Edit to delivered | p50 2,718, p95 10,210 ms | p50 3,133, p95 12,541 ms; per delivery message (n=16) p50 3,228, p95 12,541 ms |
| Edited module's own test finished, after the edit, on this repository | 47 s (C1), 58 s (P1) | 412, 414, 2,180, 2,960, 5,880 and 9,471 ms (S2, S1, R1, R5, S3, S6) |
| Whole affected set of a barrel edit | 80 s to the first transition (P1) | 175 s to quiet (R1, 75 files), first failure at 1.7 s |
| Repository sessions that ended before their first result | P1, S4 | S6 (result 5.9 s after the session ended). R6's 11 recoveries came 34 s after it ended. |
| Revision while a tier runs | 4.5 to 45 s late | row in 126 ms; status at the new revision, 462 pending, returned 183 ms after the edit (probe 8) |
| Test file added while a tier runs | not counted until the tier ended (wave 4.5, S1) | 496 of 501 reads said the runner part was pending, 0 read "nothing pending" with the file unlisted; listed and failed 42.4 and 42.7 s later, right after the 47 s tier |
| `status --wait` with no daemon | not available | `Returned without a daemon: no daemon has validated since ...`, outcome `no-daemon`, 1.1 s |
| Sessions with edits where the agent ran tests itself | 5 of 18 | 7 of 17 (F2, F4, R2, R3, R6, S1, S4) |
| Sessions that pulled Squeal state | 5 of 18 | 4 of 17: `status --wait` twice (F5, S2), `status` twice (F6, F7). The skill was loaded unprompted 5 times. |
| Waits with `sleep` | 2 | 0 |
| PreToolUse denials | 4 in 2 of 18 sessions | 3 in 1 of 17 (R1) |
| Stops with checks pending, `waitMs: 1500` | 5: caught 2, held a known result 1, nothing 2 | 10: caught 2 (F1, S3), waited to quiet so a block named only current failures 1 (F7), held a known result 2 (S1, S3), nothing 5 (S1, S2, S3, S4, S6) |
| Attended exits that left a consumer | 1 of 6 | 7 of 12 |
| Second worktree baseline | 760 of 760 inherited, 0 runs, 1.1 s | 885 of 885 inherited, 0 runs, 1.2 s |
| Store after about 40 minutes | 13.6 MB plus 4.3 MB WAL | 3.3 MB plus 4.4 MB WAL; 45 revisions, 104 runs, 3,503 results |
| Longest hook seen inside Claude Code | 1,616 ms | 1,728 ms (F1's Stop with `waitMs`, load 55). No hook reached its 2 s timeout. |
| Cost | $1.56 (`-p` only) | $1.51 `-p`, $0.79 attended |

Why the p95 of edit to result known grew while the median fell: results are stored when their tier ends (D5's post-tier stability check), so a fast file waits for the slowest file of its tier. In S4 the failing class put `test/cli/status-wait.test.ts` (9 s) in the first tier, beside the two edited tests, while the agent's own Vitest run of 10 files competed for the CPU: 11.5 s. Without S4 the p95 is 5,893 ms. The first run's repository results were mostly fast import failures (P5).

### Hooks at calm load

Cold runs of each bundle against this repository's store (885 checks, daemon alive, one consumer registered), 40 runs per round, best of 3 rounds, as in the first run. Load average 3.6 to 4.3 on 24 cores (4.28 during the Stop round). `node -e 0`: p50 49, p95 54 ms. The repository policy had `stop.waitMs: 1500` and `blockOnKnownFailures: true`; nothing was pending, so Stop did not wait.

| Hook | First run p50 / p95 ms | Re-run p50 / p95 ms | Re-run p95 of each round |
| --- | --- | --- | --- |
| session-start, new session, registers | 84 / 93 | 91 / 99 | 99, 114, 100 |
| subagent-start, new agent, registers | 82 / 98 | 86 / 94 | 95, 98, 94 |
| post-tool-batch, quiet | 71 / 76 | 73 / 80 | 85, 81, 80 |
| pre-tool-use, quiet | 74 / 89 | 75 / 80 | 101, 83, 80 |
| stop, quiet | 82 / 86 | 87 / 96 | 97, 96, 99 |
| session-end | 63 / 74 | 63 / 71 | 76, 71, 72 |
| waiter, `-p` guard | 54 / 58 | 55 / 57 | 59, 80, 57 |

PostToolBatch met its 80 ms p95 budget in its best round, exactly, and missed it by 1 and 5 ms in the other two. Registration costs 18 ms more than a quiet PostToolBatch at the median (885 checks; the first run measured 12 ms at 761). Inside Claude Code, from `hook_started` to `hook_response` over the sessions at load 3 to 12 (R2 to S6, F7): PostToolBatch quiet p50 87, p95 107 ms (n=47), delivering p95 165 ms (n=7); PreToolUse quiet p50 87, p95 113 ms (n=29); SessionStart with registration p50 127, p95 430 ms (n=12). At load 48 to 56 (F0 to F6) quiet PostToolBatch and PreToolUse reached p95 442 and 463 ms, and one registration took 1,250 ms, because it waited up to 750 ms for the heartbeat of the daemon it had just spawned.

### Stop with `stop.waitMs: 1500`

| Session | Pending at Stop | Stop ms | Outcome |
| --- | --- | --- | --- |
| F1 fixture | yes | 1,728 | Caught: 4 failures recorded inside the wait |
| F7 fixture, block on | yes | 1,095 | Waited until quiet (about 1.0 s), then blocked on 6 failures current at revision 14 |
| S1 repo | yes, 195 | 1,605 | Held: 2 failures known 1.2 and 0.7 s before Stop, delivered at the cap |
| S1 repo, second Stop | yes | 1,587 | Nothing |
| S2 repo | yes | 1,622 | Nothing |
| S3 repo | yes, 148 | 1,634 | Caught: the bundle failure |
| S3 repo, second Stop | yes, 91 | 1,638 | Held: 5 failures known before Stop, delivered at the cap |
| S3 repo, third Stop | yes | 1,668 | Nothing |
| S4 repo, block on | no | 117 | Blocked on 7 failures current at revision 37 |
| S4 repo, second Stop | yes | 1,594 | Nothing (the turn had already been blocked once) |
| S6 repo | yes | 1,594 | Nothing; the only affected result came 9.5 s after the edit |
| 8 other Stops | no | 72 to 479 | Nothing to say |

The wait still ends when nothing is pending, not when there is news, so it held known results for up to 1.5 s twice, as S8 did in the first run. On this repository a source edit leaves checks pending for tens of seconds, so all 8 repository Stops with pending checks ran to the cap. Each delivery or block started another model turn, and in every case the model summarised and asked before touching tests.

"Exist" was used only for failures current at the named revision: the two natural blocks (F7, S4) and the SubagentStop blocks of defect 9. The Stop probe, a Stop called 200 ms after an edit that re-queued 7 known failures while 7 others stayed current, returned: "7 known failures exist at revision 17: ... 7 checks last failed at an earlier revision and their re-runs at revision 17 are pending: test/format.test.ts > formatCents > formats amount in default PLN (failed at revision 15), ...". With only pending failures it blocked nothing and said nothing.

### PreToolUse

3 denials, all in R1, 1 of 17 editing sessions. Each denied the same edit to `check-name.ts`, each time for regressions that the earlier edits of that file had caused, at revision 2: two tests, then two more, then the bundle test. The agent read the first denial and re-issued the edit each time: "The two failures are tests that still expect the old `(file-level)` text. You said a teammate is updating `test/`, so I'm leaving them alone and re-issuing the last edit." Its final message listed all three causes. Cost: 3 extra tool calls, 7.6 s. No stall, no loop. Denying hooks took 95 to 212 ms.

### Interactive

Fixture, attended `tmux`, same flags without `-p`, `--debug hooks`. The pane was polled every 250 ms.

| Session | What | Waiter | `/exit` |
| --- | --- | --- | --- |
| A1 | no turn | armed | clean |
| A2 | one typed question | armed | consumer left |
| A3 | idle; `percentOf` broken from outside | woke the agent: result known +2,768 ms after the edit; the waiter took it 157 ms after the result, and the pane changed 313 ms after the result. The agent investigated; I interrupted its Bash call with Esc. | clean |
| A4 | one typed question, `/clear`, then the break undone from outside | after `/clear`: a new session id, a new consumer and a new waiter; the old consumer, and a leftover subagent consumer (defect 9), unregistered by SessionEnd `clear`. The restore was a lookup: known +122 ms after the edit, taken 57 ms and visible 146 ms after the result. The agent summarised the recovery and asked for a task. | clean |
| A5 | one typed question, `/compact`, then `formatCents` broken from outside | the session-start waiter kept running across `/compact`; the waiters started by Stop and by SessionStart `compact` exited on the lock. The consumer stayed. The wake after compaction: known +2,784 ms after the edit, taken 179 ms and visible 300 ms after the result. | consumer left |
| A6 | one typed edit | armed | consumer left |
| A7 | no turn | armed | clean |
| A8, A9 | one typed question each | armed | consumer left, both |
| A10 | no turn | armed | clean |
| A11 | one typed question, then Ctrl-C twice | armed | consumer left |
| A12 | one typed question, `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false` | armed | consumer left |

Every exit after a typed prompt left its consumer (7 of 7); every exit from a session without one ran SessionEnd (5 of 5, including A3 and A4's second session, which had only waiter-woken turns). In A8 to A12 the logging wrapper around the SessionEnd command never ran, so Claude Code did not spawn the hook (defect 8). All 21 `-p` sessions unregistered. At every exit Claude Code killed the armed waiter (`status code 137`), as before.

After the interrupted turn in A3, no waiter was armed until the session ended: the waiter that woke the agent had exited, and Claude Code runs no Stop for an interrupted turn (defect 10).

### What agents did

Over the 17 `-p` sessions with edits: 7 ran tests themselves, 4 pulled Squeal state, 6 did neither. No agent waited with `sleep`. Both `status --wait` calls followed loading the skill, which now teaches it. One returned on quiet with the two failures (F5); the other timed out after 30 s with 66 checks pending, and the agent reported them as pending (S2). Agents that ran tests did so after a fix they wanted to confirm (F2, R2, S1, S4) or with broad runs while Squeal had nothing to say (R6). F2 did both in one breath: "Now let me run the tests, and check the squeal skill since the repo uses it", then `npx vitest run`. The prompts never mentioned Squeal.

Agents read every delivery. They named failures they had not caused as pre-existing and traced them to the uncommitted change (F7, A3, A4), named failures from "just that change" tasks and asked before editing tests (F1, S1, S3), and called failures in a half-done refactor expected (R1, R5, F5). Agents tried `sed`, `cd ... && git` and other compound commands 11 times in 7 sessions; the allow-list refused them and the agents switched to Edit or to simpler commands.

### Transcript excerpts

Sanitized: session ids and tool-use ids removed, long lines shortened with `...`. Scratch paths kept.

F5, the first `status --wait` an agent chose on its own:

```text
+10593 ASSISTANT: The SQUEAL hook is active in this repo, so I'll load its skill before I call this done.
+12282 Bash: squeal status --wait 60000
+14865 RESULT: Returned on quiet: nothing pending at revision 11 after 1.1 s
       Revision: 11  Known failures: 2
       FAIL test/money.test.ts > money > converts to cents  toCents is not a function ...
+15171 PostToolBatch: SQUEAL · 2 checks changed at revision 11 ... PASS -> FAIL ...
+22158 ASSISTANT: `toCents` now lives in `src/cents.ts`, but two tests in `test/money.test.ts` fail.
       ... I left `test/` alone, as you asked, so those two failures are the move not yet reflected there.
```

Probe 8, a source edit 2 s into a 47 s tier, then a new failing test file 3 s later:

```text
tier with lifecycle started +140 ms after the trigger: test/daemon/lifecycle.test.ts
source edit: first read at the new revision 43 returned +183 ms; pending 462, runnerPartPending true
revision 43 row created +126 ms after the edit
added test/zz/new.test.ts: first read at revision 44 returned +162 ms: pending 462, runnerPartPending true
reads after the add: 501; reads that showed the new revision with nothing pending and the file unlisted: 0
file listed in status +42408 ms; its failure known in status +42683 ms
lifecycle tier ended +41692 ms after the add (47058 ms long)
```

A4, Claude Code's prompt-suggestion fork blocked by Squeal (debug log):

```text
11:32:45.463 "Hook Stop (Stop) success: {"decision":"block","reason":"Squeal policy stop.blockOnKnownFailures is on
             and 2 known failures exist at revision 20: ...
11:32:46.606 "Hook SubagentStop (SubagentStop) success: {"decision":"block","reason":"Squeal policy ...
11:32:46.606 Forked agent [prompt_suggestion] received message: type=user
11:32:46.631 [API REQUEST] /v1/messages source=prompt_suggestion
```

A12, `/exit` after one typed question, SessionEnd wrapped in a logging script:

```text
waiters before exit: 1
waiters after exit: 0
consumers: ... 4407f9ae-...  main   (the session that just exited)
debug log: [ERROR] Hook SessionStart:startup (SessionStart) error: status code 137   (the waiter)
se.log: no line for this session (A10, no turn: "spawned", "start ... prompt_input_exit", "end status 0")
```

### Surprises

1. **The barrel no longer decides the order, duration does.** No test imports `check-name.ts` or `format-status.ts` in one hop, so the direct class was empty for R1 and S3, as in wave 4.5's probe A. Shortest-duration-first still put the edited module's test in the first, second or third tier. The cost moved to the tail: R1's 75 affected files took 175 s to finish.
2. **One tier of test timeouts held the queue for three minutes.** In R5's broken state, `test/e2e/transitions.test.ts` and `test/e2e/worktrees.test.ts` waited 45 s per test for a daemon the broken build could not start: one tier took 182 s. R6 fixed everything during that tier and got no delivery in its 135 s; it ran two 47 s Vitest runs itself. The 11 recoveries came 34 s after it ended. D5 never cancels a tier in flight, so this follows the spec.
3. **Agents rebuild the plugin under test.** The bundle test fails after any source edit, and agents ran `npm run build` in R2, R6 and S1, which rewrote the hooks that the next sessions loaded. From S1 on the plugin came from a `git archive` copy. The same will happen to anyone dogfooding Squeal on itself.
4. **A Stop wait that holds news is common on a large repository.** See the Stop section. It is the first run's S8 again, 2 times in 10.
5. **Under heavy load the first header calls a fresh daemon dead.** F1 at load 55: SessionStart spawned the daemon and its header said `No daemon has validated since ...; results are as of revision 0`, because the heartbeat took longer than the 750 ms registration wait. The first PostToolBatch said `a daemon is validating again at revision 0`. Both were true when told.
6. **Claude Code runs a forked agent after every interactive turn.** The `prompt_suggestion` fork fires SubagentStart and SubagentStop, so every attended turn registers and unregisters one more consumer, and a SubagentStop block reaches it (defect 9).

### Goals 1 to 7

| Goal | Held? | Evidence |
| --- | --- | --- |
| 1 `PASS -> FAIL` within one tool call, same turn | Yes | 61 of 61 at the first eligible hook. The edited module's test now finishes within 0.4 to 9.5 s, so most results land inside the session; S6's came 5.9 s after it. |
| 2 `FAIL -> PASS` the same way; silence otherwise | Yes | Recoveries in F2, F6, R2, S4 and at A4's waiter; silence for R3, R4 and F4; 0 duplicates; one `FAIL -> FAIL, failure changed`, for a real new message (S4). |
| 3 Everything told is true when told | Yes | Probe 8: the new revision in 126 ms during a tier, a new test file pending in every read. `status --wait` without a daemon says so. A fresh worktree's header says its counts are not complete. Stop said "exist" only for current failures. |
| 4 Inheritance by lookup | Yes | 885 of 885 inherited, 0 runs, settled 1.2 s after SessionStart in a second worktree. |
| 5 `squeal status` answers | Yes | Every field read in this run; `--wait` outcomes quiet, news, timeout and no-daemon seen. |
| 6 No hook blocks past its timeout; dead daemon degrades | Yes | Longest hook 1,728 ms at load 55. Calm-load p95 80 to 99 ms (table above). |
| 7 One store, several worktrees and agents | Yes, as far as exercised | Two worktrees on one store; up to 7 consumers on the fixture store, live, leaked and prompt-suggestion subagents; no lost write seen. Not stress-tested here. |

### Defects

New product defects hit in this run. No product code was changed.

8. **After a typed prompt, an interactive exit never runs SessionEnd, so the consumer stays.** Claude Code 2.1.288 behaviour, and probably the cause of defect 5. Scenario: attended session, type one prompt, let the turn end, `/exit` (or Ctrl-C twice). 7 of 7 such exits left the consumer registered; a wrapper around the hook command logged nothing, so the hook was not spawned. Prompt suggestions off did not change it (A12). Exits from sessions without a typed prompt ran SessionEnd 5 of 5; `-p` sessions 21 of 21. `src/harness/claude-code/hooks/session-end.ts` is not at fault. What remains is the SessionStart sweep for the same session id and the 12 h consumer expiry, so a worktree's daemon cannot idle-exit for 12 hours after a normal interactive session (the repository daemon held 358 MB RSS here). An interactive consumer needs a liveness signal that does not depend on SessionEnd.
9. **`stop.blockOnKnownFailures` blocks Claude Code's internal forked agents.** `src/harness/claude-code/hooks/stop.ts` treats the SubagentStop of the `prompt_suggestion` fork like a subagent's. Scenario: attended session, policy on, one failure current at the revision, any turn: the fork's SubagentStop is blocked (A4 twice, A5 once), the fork makes another API request (`source=prompt_suggestion`), and because a block keeps a subagent going its consumer is not unregistered until SessionEnd (A4: `aa4f734adea6466a2` still registered after the turn). The policy is off by default.
10. **No waiter after an interrupted turn.** The waiter is armed by SessionStart and Stop only (`plugins/claude-code/hooks/hooks.json`), and Claude Code runs no Stop when the user interrupts a turn with Esc. Scenario: A3, a waiter wake started a turn, Esc interrupted it, and the session had no waiter (`waiters before exit: 0`) until it ended. An idle agent is not woken again until another turn completes.

### Not measured

- macOS, as before.
- Interactive `--resume` with the waiter.
- Store concurrency beyond two worktrees, the fixture's seven consumers and one `-p` session at a time.
- A repository baseline at calm load: the only one ran at load 18 to 55 (446.7 s).

## Attended re-run after wave 6

Task 001-49, 2026-10-06, part of `reviews/wave-6.md`. Squeal at commit `1f1a372` (waves 6 landed: 001-47, 001-48). The question: are defects 8, 9 and 10 of the re-run above gone with a real attended Claude Code session?

### Setup

| Item | Value |
| --- | --- |
| Claude Code | 2.1.291, `DISABLE_AUTOUPDATER=1`, `--setting-sources project --strict-mcp-config --permission-mode acceptEdits`, the allow-list of the first run, `--debug hooks --debug-file`, model `claude-sonnet-5-5`; `CLAUDE*` and `CEZ_*` variables removed |
| Plugin | `git archive 1f1a372 plugins/claude-code`, loaded with `--plugin-dir`. `squeal init`'s `.claude/settings.json` was deleted, so the marketplace copy could not load beside it. |
| Fixture | `/tmp/sq6/fix`: the fixture of the runs above (4 modules, 4 test files, 24 checks), fresh `git init`, `squeal init`. Policy `stop.blockOnKnownFailures: true`, `stop.waitMs: 1500`, `daemon.idleExitMinutes: 5`: the idle period was shortened in policy, never in product code, so the idle exit fitted the task. `fix2` (the Esc probe) and `fix3` (latency, `-p`, `--agent`) are copies with their own store and daemon. |
| Drivers | `tmux`, a 30 s logger of consumers, lock files (held or free, by one lock attempt) and waiter processes, debug logs and transcripts. Scratch under `/tmp/sq6`. |
| Machine | Same host, load average 2.2 to 5.9 |
| Cost | $0.59 attended (turn-end cost records of the debug logs), $0.09 for one `-p` session |

### Sessions

| Id | Fixture | Steps (UTC) | SessionEnd | Waiter | Consumer gone after last heard from | Lock file | Squeal said |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A8 | `fix`, no store before it | one typed question at 15:14:14, `/exit` at 15:16:31 | none | armed by UserPromptSubmit, killed at exit (137) | yes: 10 min 47 s after 15:14:18 | removed with the row | nothing: no `SQUEAL` header (finding 4) |
| A6 | `fix` | one typed edit (`double` in `src/money.ts`), `/exit` at 15:17:10 | none | SessionStart's, killed at exit (137) | yes: 10 min 4 s after 15:17:01 | removed with the row | the SessionStart header |
| A11 | `fix` | one typed question, Ctrl-C twice at 15:17:10 | none | SessionStart's, killed at exit (137) | yes: 10 min 4 s after 15:17:01 | removed with the row | the SessionStart header |
| E1 | `fix2` | one typed question; `src/money.ts` broken from outside (wake 1, 5 `PASS -> FAIL` at 15:17:52), then restored (wake 2, 5 `FAIL -> PASS` at 15:18:18); Esc 1.5 s into the woken turn; `/exit` at 15:18:44 | none | armed after the Esc: the woken turn's UserPromptSubmit started one 39 ms after wake 2; it ran until the exit killed it (137) | yes: 10 min 19 s after 15:18:18 | removed with the row | both wakes, as UserPromptSubmit blocking errors |
| G1 | `fix3`, `claude --agent helper`, 5 failures current | one typed question, `/exit` at 15:23:42 | none | SessionStart's, killed at exit (137) | not sampled; at 15:38:15 the store had no consumer and no waiter lock file | gone | the header; main Stop blocked once; both forks' SubagentStop blocked (finding 3) |

The logger sampled every 30 s, which bounds each expiry to a 30 s window (A8 10 min 17 s to 10 min 56 s, A6 and A11 10 min 0 s to 10 min 13 s, E1 10 min 0 s to 10 min 31 s). The exact figures come from the daemon's idle exit: it checks every 5 s, its expiry pass runs in the same tick, and it stops 5 minutes after the last tick that saw a consumer. Each store's last write is that stop (`fix` 15:32:00.7, `fix2` 15:33:32.0, `fix3` 15:38:14.6), so the last expiry of each fixture ran about 4 min 55 s earlier. The expiry pass runs every 60 s, so A8's was the pass 2 minutes before A6's, the first after 15:24:18.

### Findings

1. **Defect 8 holds in Claude Code, and Squeal now absorbs it.** 2.1.291 still runs no SessionEnd after a typed prompt: 5 of 5 here (A6, A8, A11, E1, G1; none logged a SessionEnd hook, and every sampled main consumer was still registered after exit). Claude Code killed the armed waiter at every exit (`status code 137`), and the lock file stayed, free, in every sampled session. The daemon expired each consumer between 10 min 4 s and 10 min 47 s (A8, A6, A11, E1; G1 was not sampled) after it was last heard from, and removed its lock file. The fixture daemons idled out 5 minutes after their last consumer expired, at 15:32:01 (`fix`), 15:33:32 (`fix2`) and 15:38:15 (`fix3`), each with no consumer and no waiter lock file left.
2. **Defect 10 is gone, for a reason the brief did not expect.** Claude Code runs UserPromptSubmit for the turn a waiter wakes. In E1 a new waiter started 25 ms and 39 ms after the two wakes and before any Stop, and the waiter killed at exit was logged as `Hook UserPromptSubmit (UserPromptSubmit) error: status code 137`. The queued wake message in the transcript carries a `promptId`. So the woken turn re-arms its own waiter, and an Esc during it leaves one armed. Claude Code labels the wake `Stop hook blocking error from command "UserPromptSubmit"`, after the event that armed the waiter.
3. **Defect 9 is gone without `--agent`, and back under it.** In A6, A8, A11 and E1 no fork was ever registered. In G1 (`claude --agent helper`, 5 failures current, policy on), both forks' SubagentStop calls were blocked, and each made a second `source=prompt_suggestion` request. Neither fork had a consumer row before its SubagentStop, and both rows were gone after a second, silent SubagentStop (review S2).
4. **A first attended session on a new store never sees the header.** A8 started on a repository with no store, so SessionStart only spawned the daemon. UserPromptSubmit then registered the consumer silently because no failure was known. The transcript has no `SQUEAL` header, and every later PostToolBatch had an empty delta. A6 and A11, started once the store existed, got it from SessionStart (2 `SQUEAL ·` lines each). Review S1.
5. **Hook cost.** UserPromptSubmit p50 64 / p95 70 ms registered, 66 / 76 ms re-registering; a quiet PostToolBatch 62 / 67 ms in the same round (fixture store, load 2.2 to 2.9). In `-p` both UserPromptSubmit hooks returned silently and the session ended normally in 4.2 s.

### Not measured

- UserPromptSubmit on this repository's 885-check store.
- A user idle for more than 69 minutes: the 59-minute waiter timeout followed by the 10-minute expiry and a re-registration at the next prompt. Only unit tests cover it.
- Whether Claude Code feeds SubagentStop `additionalContext` to a fork. That is the default-policy path of review S2.

### Attended check after wave 6.5

Task 001-51, 2026-10-06. Squeal at commit `df193d4` (wave 6.5 landed: 001-50). The question: do S1 and S2 of `reviews/wave-6.md` hold in a real attended session? Setup as above, with these differences: plugin `git archive df193d4 plugins/claude-code`; fresh fixtures `/tmp/sq65/fix` and `/tmp/sq65/fix3` built from the same sources, each with its own store and daemon; tmux on its own socket; same policy (`stop.blockOnKnownFailures: true`, `stop.waitMs: 1500`, `daemon.idleExitMinutes: 5`). In `fix3`, `src/money.ts` divides by 1000 (the change of the wave 6 `fix3`), uncommitted, and the 5 failures were current before each session (`squeal start`, `squeal status --wait`). Load average 3.6 to 4.0. Cost $0.48 (turn-end cost records of the debug logs).

| Id | Fixture | Steps (UTC) | Squeal said | Fork SubagentStop blocked | `source=prompt_suggestion` requests | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| A8 | `fix`, no store before it | SessionStart 17:57:55, one typed question at 17:58:02, `/exit` at 17:58:22 | the `SQUEAL · registered at revision 0` header from UserPromptSubmit at 17:58:02.651 | 0 of 1 | 1 (1 fork) | S1 holds: header after the first prompt |
| G1a | `fix3`, `claude --agent helper`, the allow-list of the first run | one typed question at 17:58:51, `/exit` at 17:59:33 | the SessionStart header; the main Stop blocked once; a waiter wake inside the turn (below) | 0 of 2 | 2 (2 forks, 1 each) | discarded for G1: the agent fixed the failures in turn 1, so no second turn was typed |
| G1 | `fix3`, `claude --agent helper`, `--allowedTools Read,Glob,Grep --disallowedTools Edit,Write,NotebookEdit,Bash`, 5 failures current at revision 2 | typed turns at 17:59:53 and 18:00:17, `/exit` at 18:00:28 | the SessionStart header; the main Stop blocked once per turn (17:59:58, 18:00:20) | 0 of 4 | turn 1: 2 (2 forks, 1 each); turn 2: 2 (2 forks, 1 each) | S2 holds: no fork blocked, no second fork request |

Evidence:

1. **A8 shows the header.** The `fix` store did not exist when SessionStart ran, so SessionStart only spawned the daemon. The baseline finished in the 7 s before the prompt. The transcript (`533babaf`) has one `hook_additional_context` attachment from UserPromptSubmit at 17:58:02.651: `SQUEAL · registered at revision 0` / `Revision 0: 24 current, 0 pending, 0 stale, 0 unknown. Full-suite checkpoint: completed at revision 0.` / `Known failures: 0`. The store held one consumer, `main`, registered at 17:58:02; the turn's `prompt_suggestion` fork got no row and its SubagentStop printed nothing. As in the runs above, no SessionEnd ran and Claude Code killed the UserPromptSubmit waiter at exit (`status code 137`).
2. **G1 blocks no fork.** The debug log holds 4 `source=prompt_suggestion` requests over the 2 turns, one per fork. Each fork finished with `4 messages, types=[assistant, progress, attachment, system]`, and its SubagentStop output was empty (`Hook output does not start with {`). The wave 6 run logged `Hook SubagentStop (SubagentStop) success: {"decision":"block", ...}` for each fork and a second request after it. The only `"decision":"block"` lines are the main agent's Stop, once per turn, as the policy says. The store never had a fork row: its consumers were `90562945 main` (G1a) and `39abc89b main` (G1). A probe of the shipped `stop.mjs` with G1's session, `agent_type: "helper"`, an agent id never registered and the policy on: exit 0, empty stdout and stderr, no row.
3. **G1a, kept as evidence, no defect.** With Edit allowed, the main Stop block led the agent to fix `src/money.ts` in answer to a read-only question. It said it went beyond the request because of the block and gave the revert command. That is what `stop.blockOnKnownFailures` asks for. Its own edit and test run then made 5 `FAIL -> PASS` transitions at revision 1. The SessionStart waiter delivered them at 17:59:03.3 while the turn was still running (labelled `Hook SessionStart:startup (SessionStart) error: status code 2`). Claude Code queued the message and fed it into the same turn at 17:59:04.6, so the wake started no extra turn. No PostToolBatch carried the same entries.
4. **G1 turn 2 was blocked again on the same 5 failures.** The agent had said in turn 1 that it could not fix them with Edit and Bash disabled, and said so again. This is the policy as specified: Stop blocks while failures are current, once per turn.

Not measured: consumer expiry after these exits (both daemons were stopped by hand at 18:01, not by idle exit); A8 with the baseline still running at the first prompt; G1 with the default policy (S2 sends a fork to the same silent path under either policy; only policy on was run).

## Structural changes on a large repository

2026-10-06, reported by the human from Squeal on `cezar` (516 test files, projects `server` and `web`), measured by the coordinator. Answers the measurement D4 left open: the cost of the full transform invalidation on add or delete.

The human saw an added or removed test take about 10 s to surface, against 1 to 2 s for an edit. The `cezar` store agrees. Editing `agent-model-policy.test.ts` (revision 9) started its run 1.3 s after the revision. Adding `artifacts/squeal-probe.test.ts` (revisions 12 and 14) started the run after 8.9 s and 11.3 s and delivered at 10.1 s and 12.3 s.

The time goes into the runner phase of the refinement. Adapter calls timed on a copy of `cezar` at `82dfae5` with Squeal at `6185990`:

| Step | Edit | Add test file | Delete test file |
| --- | --- | --- | --- |
| `invalidate` | 1 ms | 25 ms (`invalidateAll`) | 29 ms (`invalidateAll`) |
| `affected` | 528 ms | 5,301 ms | 6,191 ms |
| `affected` again, transforms warm | | 503 ms | |

On this repository (102 test files) the same steps cost 11 ms and 410 ms, and every case surfaced within 2 s in a daemon probe. So the cost grows with the module graph. Each add or delete in any file, test or source, drops every cached transform in every project. The next walk re-transforms the whole graph, and so does every closure re-resolved after it. A test case added or removed inside an existing file is a plain edit and is not affected (0.3 to 0.6 s here).

### Defects

11. **An add or delete re-transforms the whole module graph before anything runs.** `src/runners/vitest/adapter.ts` `invalidate` calls `invalidateAll` on any structural path (D4). On a 516-file repository the following `affected` walk takes 5 to 6 s instead of 0.5 s, and the new test file's first result arrives 9 to 12 s after the save. Agents create and delete files often, so this lag hits them on most turns that add a test.

### Re-run after 001-56

2026-10-07, task 001-54. Same probe on a fresh clone of `cezar` at `82dfae5` (536 test files on disk, projects `server`, `contract`, `api-client` and `web`, Vitest 4.1.10) with Squeal at `8119c64`, built with `tsc`. One adapter instance, warmed by one cold `affected` (6.8 s), then three rounds of: append a comment to `packages/cezar/src/core/agent-model-policy.test.ts`; add `packages/cezar/src/artifacts/squeal-probe.test.ts`, which imports `./store.js`; delete it. Each step is `invalidate` with the path's kind, then `affected` with the path. The machine had 24 cores at load average 9 to 12.

| Step | Edit | Add test file | Delete test file |
| --- | --- | --- | --- |
| `invalidate` | 0 to 1 ms | 50 ms, then 8 and 10 ms | 6 to 7 ms |
| `affected` | 462 to 560 ms | 492 to 603 ms | 779 to 943 ms |
| `affected` again, transforms warm | | 483 to 593 ms | |

A warm `affected` with nothing changed took 487 ms. The add's first `invalidate` is the one that scans the source of every cached module (D4). An add now costs what an edit costs: the walk after it no longer re-transforms the graph, against 5.3 s at `6185990`. A delete costs about 300 ms more than a warm walk, against 6.2 s before; the probe file had no importers, so the extra is not re-transformed importers. Defect 11 does not reproduce at this step.

Daemon probe on the same copy: the plugin's `squeal.mjs start`, `baseline.onStart: "lookup-only"` in an untracked `squeal.config.json` so no baseline competes with the probe, then a warm-up round and three rounds of the same edit and add. The delete ran between rounds and was not timed. Times come from the copy's store: `revisions.created_at`, `runs.started_at` of the first run naming the file, and `results.recorded_at` of its checks, which is the tier's end and the earliest a hook can deliver. Save to revision was 136 to 200 ms throughout.

| Round | Edit: run start | Edit: result | Add: run start | Add: result |
| --- | --- | --- | --- | --- |
| 1 | 1,027 ms | 1,457 ms | 1,399 ms | 1,905 ms |
| 2 | 735 ms | 1,007 ms | 1,289 ms | 1,776 ms |
| 3 | 974 ms | 1,324 ms | 1,472 ms | 2,137 ms |
| `6185990` | 1.3 s | | 8.9 s, 11.3 s | 10.1 s, 12.3 s |

Add-to-run-start is 1.3 to 1.5 s, under the 2 s of 001-53, and the add's result arrives in 1.8 to 2.1 s. Each run held only the changed file, and no run started between the revision and it. An add still costs 0.4 to 0.5 s more than an edit before its run starts. The adapter table puts the `affected` walk at about the same cost for both. A structural revision also re-lists the test files and resolves the new file's closure (`fetchRunnerPart`); this probe did not time those steps separately.

The warm-up round is not in the table. Its add started the probe file's run in 932 ms, in a tier with three never-run `artifacts` files, and delivered at 2.5 s. It then queued every `server` test file that had no closure yet: 42 more tiers over about 10 minutes. On a structural revision `fetchRunnerPart` re-resolves every listed file without a closure. Under `lookup-only` that is every file never resolved, so the first add in a fresh store runs a deferred baseline of that project. Under the default baseline every file is resolved at start, and the human's `cezar` store had run its baseline. This is not counted as a defect here; it is the cost of the probe's setup. The daemon on the copy was stopped with `squeal stop`, and no process holds the copy.

## A dependency install under a running daemon

2026-10-07, found by the coordinator in `cezar` session `bbe5c9d9` (Squeal plugin at `cfb8e9e`), from `cezar/.git/squeal/store.sqlite` and the run logs under `cezar/.git/squeal/runs/`. Nothing since `cfb8e9e` touches this path.

Worktree `c257b736` was registered before its dependencies were installed. Its tests resolved modules from the parent checkout's `node_modules`, because the worktree sits inside `cezar/.ai/cezar/worktrees/`. At 21:30:05 its baseline reported 1,282 failing checks. Four seconds later the agent ran `git checkout -b … origin/main && npm ci`, apparently to clear them. The daemon kept its Vitest instance, loaded from the parent's `node_modules`, across the install.

From 21:32:48 to 21:34:40 every run in that worktree failed while loading the setup file, with `ENOENT … .ai/cezar/tmp/c257b736…/Yfp1fJ4OTMNiwKGwCRyDJ/ssr/<sha1>`. That directory is the Vitest instance's own temp directory, the place where the forks pool copies transformed modules (Vitest 4.1.10 `_tmpDir`). The instance remembers each copy's path (`_vitest_tmp`) and which directories it has already created, so it never writes them again after the directory disappears. What deleted the directory is not established. A second temp directory, `zcZHvgW_…`, alternated with the first in the logs. In 2 minutes, 122 runs ended `completed` and stored 3,929 `fail` results. Failing checks are re-run first, so the loop walked the whole suite.

Those results were stored under keys computed after the install, so they matched the keys of installed worktrees. Other worktrees inherited them as ordinary failures: `bbe5c9d9` 7,754 checks, `86bc25a4` 7,657 and `aee1234c` 234. The main checkout was not affected. `bbe5c9d9` changed no code and ended with `Known failures: 8096`, delivered as `PASS -> FAIL … inherited from c257b736`. Its agent correctly called them unrelated. Each worktree clears them only by re-running the files itself.

### Defects

12. **A broken runner environment is stored as test failures and inherited by every worktree with the same keys.** A file-level error raised by the runner's own module loading (here, a missing transform copy in Vitest's temp directory) is recorded as a file-level `fail` under the check's key. D5 and D8 keep crashes out of the store because an `unknown` under a key would be inherited as a hit; this is the same harm through `fail`. Related: the daemon keeps a Vitest instance loaded from another `node_modules` across a dependency install in the worktree; and a baseline taken before the install reports failures that read as the agent's to fix.

## A daemon that pins its worktree

2026-10-07, found by the coordinator while retiring Cezar workers on this repository. `worker destroy` came back `incomplete` four times, naming the worktree's Squeal daemon as a process that still held the worktree or its scratch directory. Each time it took a `squeal stop` before the destroy went through.

`/proc/<pid>` for every running daemon shows the cause. Each one's working directory is its worktree root, because `src/core/daemon/ensure.ts` spawns it with `cwd: root`. Its open files are all under `<common-dir>/squeal/`, so the working directory is the only thing it holds inside the root. It also inherits the environment of the hook that spawned it, `TMPDIR` included. For a Cezar worker that is the task's scratch directory, `.ai/cezar/tmp/<id>/`, so Vitest's temp directory lives in a directory another tool owns and removes. Defect 12's missing temp directory had exactly that shape (`.ai/cezar/tmp/c257b736…/…/ssr/<sha1>`). This is likely what deleted it, though not proven.

D10 ends a daemon when its root is deleted. A harness that will not delete a directory a live process sits in never gets to delete it, so the daemon stays until its 60-minute idle exit.

### Defects

13. **A daemon pins its worktree and runs Vitest out of its spawner's temp directory.** The daemon's working directory is the worktree root, and its `TMPDIR` is whatever the spawning hook had. A harness that refuses to remove a directory held by a live process can therefore not retire the worktree until the idle exit, and a harness that cleans its own scratch directory deletes Vitest's temp directory under a live instance (defect 12).
