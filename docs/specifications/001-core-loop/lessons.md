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
