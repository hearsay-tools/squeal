# 015 The code squeals: dogfooding lessons

## Round 1, live sessions (015-10)

Task 015-10 Part C, 2026-10-24, worker 4ddd4e37. Twelve real `claude -p` sessions on Sonnet, six in a clone of this repository and six in a clone of cezar, with the released Squeal 0.1.284 and complexity on. The brief is `tasks/wave-1.md`, "015-10 Part C". The setup, the scripts and what went wrong in the runs are in `tasks/015-10/part-c.md`. Every SQUEAL line quoted here is copied from a session's stream. Every count was checked against `squeal code` in the clone after the session.

### Verdict

When the agent's own edit makes the change, complexity tells it the right thing at the right time.

- **Counts.** The sessions got 19 complexity lines: 11 `STILL FAIL`, 5 `PASS`, 2 `FAIL` and 1 too-big line. Each count equalled `squeal code`.
- **Delivery time.** 11 of the 13 deliveries came 0.5 to 2.3 s after the edit's tool call ended (median 0.8 s). The other two waited for the agent's next tool call: 8.5 s and 21.4 s.
- **Agent behaviour.** Agents read the lines and used them sensibly. Three agents acted on a line: sq1 brought `stopCommand` from 21 to 20, sq3 tried to fix `retryCommand`, and cz1 offered the user a split. No agent treated a complexity line as a test failure. No agent stopped its task for one.

Four defects make a line wrong, or lose it:

- **P1. A pull inside a session reads as the agent's edit.** In sq6 a `git merge --ff-only` gave four `STILL FAIL … after the edit` lines for functions the session never touched. This reproduces the case in `tasks/015-10/window.md`.
- **P2. A change made while no daemon ran reads as the next session's change.** In sq2 a `git reset --hard` made between sessions came in as `FAIL complexity: stopCommand … is 21, over 20`. The session never touched `stopCommand`. Its registration also said 80 functions over 20 when 81 were.
- **P5. A delivery can be lost.** In cz6 the agent took `statusFor` from 20 to 21. The PostToolBatch hook that should have said `FAIL` hit its 2 s timeout, and the session ended before another hook ran, so the agent never heard of it. In cezar, the hooks that carried a code line took 0.68 to 1.17 s (median 1.05 s), against a median of 0.57 s for other hooks. Every session's view holds a row for every function, about 16,250 in cezar, and ended sessions keep theirs.
- **P4. `squeal code` gives a stale count with no mark.** Twice, `squeal code` run right after an edit printed the count from before the edit. Both agents noticed and lost a step.

One gap in the design shows too (P3). After a `FAIL`, an agent that tries a fix but stays over hears nothing. sq3 ended with "I haven't confirmed the function is back under 20", and `retryCommand` was still 22.

What these sessions say on the open questions:

- **Open question 1 (`?.`, `??` and defaults).** Keep counting them. 5 of the 19 lines, and the lost cz6 `FAIL`, exist only because of `?.` and defaults: four for `stopCommand` (21; 18 without them) and one for `recordFocusedTier.<map>` (25; 20 without). `squeal code` counts `??` inside `logical`, so the counts without all three kinds can be lower still. None of the five read as noise because of these kinds, and no agent questioned a count. The noise came from who made the change (P1, P2), not from what was counted.
- **Open question 2 (`STILL FAIL`, the first edit to a standing failure).** Keep it, with P1 fixed. The 11 lines: 2 useful (sq1 acted on one; cz1 told the user), 2 redundant but harmless (sq5 and cz5r were already refactoring that function), 3 noise (sq4, a rename that changed no count), and 4 from a pull (sq6, P1). Once P1 is fixed, 7 remain, with 2 useful and 3 noise. One rule would cut the 3 noise lines but also cut sq1's useful line: skip a `STILL FAIL` when the count did not move. sq1's count did not move either (21 to 21), so that rule is not worth it.
- **Open question 4 (churn in a refactor made in several edits).** No churn. Five sessions brought a function over 20 down: sq2 and cz2 in one edit, sq1 in two rounds, sq5 and cz5r in three rounds of two Edit calls each. No function crossed and came back. Each step that stayed over was quiet: sq5 at 22, cz5r at 23, sq3 at 22. Every one of the five `PASS` lines came with the session's last edit to that file; no edit followed any of them. A rule that holds a crossing until it lasts across two edits would have withheld all five. Keep immediate delivery.

### Setup

| Item | Value |
| --- | --- |
| Isolation | The OS user `squeal-e2e`, case root `/home/squeal-e2e/runs/d1510`; credentials by name only (`tasks/015-10/part-c.md`) |
| Squeal | 0.1.284 from `git archive squeal--v0.1.284`, at user scope in the case's Claude Code |
| Harness and model | Claude Code 2.1.300, `claude -p --model sonnet` (`claude-sonnet-5-5`), bypass permissions |
| squeal clone | `d5018817a` (origin/main), complexity on with `docs/**` excluded: 1,204 files counted, 81 functions over 20 (60 in `src`), 4 files in parse errors with no function in them |
| cezar clone | `03c905a00`, complexity on with the default include and exclude: 944 files counted, 267 functions over 20, 1 function in a parse error, 1 file too big (`packages/cezar/src/workflows/run.ts`, 560 KiB) |
| Sessions | 06:46Z to 07:16Z. Planned: kinds 1 to 4 of the brief in each repository. Added: `sq5` and `cz5r`, refactors told to go in steps, because `sq2` and `cz2` refactored in one edit each; `sq6`, a session that fast-forwards first, for `window.md`'s pulled `STILL FAIL`; `cz6`, a second try at kind 3, because `cz3` stayed under 20 |
| Load gate | Until 07:05Z a session started only at a one-minute load of 24 or below. Then the human dropped the gate ("complexity is cheap"), and sessions started at once with the load recorded |

Twelve sessions are clean. Two runs are left out: `cz4` and `cz5`. By my error they shared the cezar clone, and `cz5`'s reset removed `cz4`'s edits. I stopped both and ran them again as `cz4r` and `cz5r` (`part-c.md`).

### The sessions

Times are seconds from the session's start. "Edit to line" is from the end of the tool call that wrote the file to the hook that carried the line. The registration line (`Complexity: N functions over 20; squeal code lists them.`) opened every session and is shown only where it was wrong.

**sq1 (squeal, kind 1).** Task: `squeal stop` names the daemon's pid. Load 22.9 at the start; 79 s; the daemon used 21 s of CPU.

| t | SQUEAL line | Edit to line | Agent's next action | Right? |
| --- | --- | --- | --- | --- |
| 29.5 | `STILL FAIL complexity: stopCommand (src/cli/stop.ts:45) is 21 after the edit; it was already over 20 before it (ESLint rule)` | 21.4 s. The PostToolBatch 0.4 s after the edit carried nothing; the next one came after the agent's 18 s Vitest call | It fixed the stop tests. At 63 s it moved the pid suffix into a `pidOf` helper | Yes: 21 before the edit and after it |
| 74.3 | `PASS complexity: stopCommand (src/cli/stop.ts:45) is 20, at or under 20` | 0.5 s | Its final message: "Squeal shows `stopCommand` at complexity 20, within the limit." | Yes |

**sq2 (squeal, kind 2).** Task: refactor `runCommand` (27) to 20 or under. Load 23.2; 56 s.

| t | SQUEAL line | Edit to line | Agent's next action | Right? |
| --- | --- | --- | --- | --- |
| 0.5 | `Complexity: 80 functions over 20; squeal code lists them.` | — | — | No: 81 were over. The reset to the base ran while no daemon ran, and the new daemon registered the session before it had counted the reset (P2) |
| 25.8 | `FAIL complexity: stopCommand (src/cli/stop.ts:45) is 21, over 20 (ESLint rule)` | — (from the reset) | Its final message: "That was already over before my change and isn't part of this task, so I left it." | The count yes; the change was not the session's (P2) |
| 25.8 | `PASS complexity: runCommand (src/cli/run.ts:72) is 20, at or under 20` | 8.5 s. The PostToolBatch 0.5 s after the edit carried nothing; the daemon had started with the session and was catching up (inferred) | "`runCommand` is at 20. Now the tests and lint." | Yes. Its own `squeal code`, 5 s after the edit, had printed the old CC 27; it ran `sleep 5` and asked again (P4) |

**sq3 (squeal, kind 3).** Task: `squeal retry` ends with a `Queued N of M` summary. Load 23.9; 52 s.

| t | SQUEAL line | Edit to line | Agent's next action | Right? |
| --- | --- | --- | --- | --- |
| 27.7 | `FAIL complexity: retryCommand (src/cli/retry.ts:69) is 23, over 20 (ESLint rule)` | 0.7 s | It read the tests, then moved the summary into a `summaryLine` helper: 23 to 22. Nothing followed. Its final message: "Squeal had flagged `retryCommand` at 23 (limit 20), so I moved the summary into a `summaryLine` helper … I haven't confirmed the function is back under 20." | Yes: 20 before, 23, then 22, still over. The quiet after the fix is D5's rule (P3) |

**sq4 (squeal, kind 4).** Task: rename the helper `worktreeRoot` to `resolveWorktreeRoot` in 7 files. Load 22.9; 26 s.

| t | SQUEAL line | Edit to line | Agent's next action | Right? |
| --- | --- | --- | --- | --- |
| 10.7 | `STILL FAIL complexity: removeCommand (src/cli/remove.ts:44) is 28 after the edit; …`, the same for `runCommand` (27) and `stopCommand` (21) | 0.6 s | It went on to the tests. Its final message: "Squeal reported complexity warnings on `removeCommand`, `runCommand` and `stopCommand`. They were already over the limit of 20 before this change, and the rename didn't affect them." | Counts yes. Noise: the rename changed no count |

**sq5 (squeal, added).** Task: bring `removeCommand` (28) to 20 or under, one helper per edit, tests after each. Load 22.3; 71 s.

| t | SQUEAL line | Edit to line | Agent's next action | Right? |
| --- | --- | --- | --- | --- |
| 10.6 | `STILL FAIL complexity: removeCommand (src/cli/remove.ts:44) is 25 after the edit; …` | 0.7 s | It ran the tests and went on to the next helper | Yes; redundant, since the task was this refactor |
| — | nothing at 22, after the second round | — | Its own `squeal code` showed CC 22 | Yes: still over, quiet by D5 |
| 49.0 | `PASS complexity: removeCommand (src/cli/remove.ts:44) is 19, at or under 20` | 0.6 s | Final checks; "now at CC 19, down from 28" | Yes |

**sq6 (squeal, added).** Task: fast-forward the branch `work` from `ab376e7fd` to `dogfood`, then make `--reason` accept any letter case. Load 22.0; 24 s.

| t | SQUEAL line | Edit to line | Agent's next action | Right? |
| --- | --- | --- | --- | --- |
| 5.7 | `STILL FAIL complexity: namedLine (src/cli/status-wait-lines.ts:215) is 32 after the edit; …`, the same for `waitForNamed.<withStatusStore>` (48), `recordFocusedTier.<map>` (25) and `report` (32) | 2.3 s after the merge | It edited `parse` in `retry.ts`. It never mentioned the four lines | Counts yes: both sides counted, 30 to 32, 28 to 48, 25 to 25, 31 to 32, each body moved. "After the edit" no: the session never edited them (P1) |

**cz1 (cezar, kind 1).** Task: `parseUnifiedDiff` reads `copy from` and `copy to`. Load 20.7; 42 s.

| t | SQUEAL line | Edit to line | Agent's next action | Right? |
| --- | --- | --- | --- | --- |
| 25.4 | `STILL FAIL complexity: parseUnifiedDiff (packages/web/src/lib/unified-diff.ts:55) is 23 after the edit; it was already over 20 before it (ESLint rule)` | 1.2 s | It ran `tsc`. Its final message: "It was already over before this edit, and my two new branches added to it. I left that alone because you only asked for the copy support. Say so if you want the header handling split into a helper." | Yes: 21 to 23 |

**cz2 (cezar, kind 2).** Task: refactor `resolveNpmInvocation` (27) to 20 or under. Load 21.9; 23 s.

| t | SQUEAL line | Edit to line | Agent's next action | Right? |
| --- | --- | --- | --- | --- |
| 17.5 | `PASS complexity: resolveNpmInvocation (packages/cezar/src/application-update/npm-process.ts:58) is 13, at or under 20` | 1.1 s | Its final message: "The `squeal code` output I printed was from before Squeal re-measured the edit. Squeal's later message reported 13" (P4) | Yes: 13; the five new helpers are 6 to 8 |

**cz3 (cezar, kind 3).** Task: read `resets at noon` and `resets at midnight`. Load 22.9; 24 s. No complexity line, which was right. The agent put the new branch in the caller: `parseUsageLimit` went from 15 to 19 and `parseClockReset` from 19 to 18. Nothing crossed.

**cz4r (cezar, kind 4).** Task: map `.jpeg` to `image/jpeg` in `mediaTypeFor`, in the 560 KiB `run.ts`. Load 18.8; 257 s, most of it waiting for a test result.

| t | SQUEAL line | Edit to line | Agent's next action | Right? |
| --- | --- | --- | --- | --- |
| 8.7 | `packages/cezar/src/workflows/run.ts is 560 KiB, over the 512 KiB limit; its functions are not counted.` | 2.3 s from the `run.ts` edit; 1.0 s from the batch's last edit | It waited for its test with `squeal status --wait` | Yes; told once. The contaminated first run gave the same line at 9.0 s |

**cz5r (cezar, added).** Task: bring `discoverInstallation` (31) to 20 or under, one helper per edit, tests after each. Load 14.5; 36 s.

| t | SQUEAL line | Edit to line | Agent's next action | Right? |
| --- | --- | --- | --- | --- |
| 9.6 | `STILL FAIL complexity: discoverInstallation (packages/cezar/src/application-update/discovery.ts:25) is 29 after the edit; …` | 0.8 s | It ran the tests and made the next extraction | Yes; redundant |
| — | nothing at 23, after the second round | — | — | Yes: still over, quiet |
| 28.3 | `PASS complexity: discoverInstallation (packages/cezar/src/application-update/discovery.ts:43) is 20, at or under 20` | 0.7 s | Final checks; "down from a complexity of 31 to 20" | Yes. The line moved from 25 to 43 because a helper was added above it; the function kept its state |

**cz6 (cezar, kind 3, second try).** Task: the preview's status says `cannot connect` from the third attempt. Load 21.7; 71 s.

| t | SQUEAL line | Edit to line | Agent's next action | Right? |
| --- | --- | --- | --- | --- |
| — | nothing. `statusFor` went from 20 to 21; the code store recorded the crossing (`pass-to-fail`, revision 26) 2 s after the edit | — | It finished, with no word on complexity | No: a missed `FAIL`. The PostToolBatch at 65.5 s was cancelled at its 2 s timeout (2.14 s). The session's view still holds `statusFor` as `pass` (P5) |

### Cost and load

- **Counting CPU.** I timed the released counter (`git archive squeal--v0.1.284 src`) on both sides of every file the sessions changed. Each count was timed after a warm-up count of the same file. At load 16.8, over 32 files, it took 3.3 ms of CPU at the median and 7.5 ms at p95; at load 86, over 36 files, 7.1 ms and 13.5 ms. One count of every included file took 2.1 s of CPU in squeal (1,204 files) and 3.7 s in cezar (944 files), at load 29 to 32. That is inside goal 8 (5 ms, 20 ms and 5 s). The pass logs no timing of its own, so these are the counter's times, not the pass's.
- **Delivery cost.** A PostToolBatch hook that carried a code line took 0.63 s at the median in squeal (max 0.94 s, n 8) and 1.05 s in cezar (0.68 to 1.17 s, n 5). Other PostToolBatch hooks took 0.37 s and 0.57 s. Each registration seeds the view with every function: 11,727 rows in squeal and 16,246 in cezar. Rows of ended sessions stay: after the round the code stores held 70,484 and 129,979 view rows (P5).
- **The daemons' CPU** per session was 12 to 52 s. Nearly all of it was test runs and the listing of about 1,000 test files at each daemon start. The first start used 40 s and 47 s of CPU in 45 s; complexity is a few seconds of that.
- **Load.** At the starts: 20.7 to 23.9 under the gate, 14.5 to 22.0 after it. During the sessions the 30 s samples and the end readings ranged from 15.7 to 57.2; cz6 ended at 57. At the end of the round, after the last session, the host went to 96 from other work.

### Other observations

- **Parse errors.** squeal: three barrel files with `export type * from` (TypeScript 5.0) do not parse in the shipped grammar: `src/core/code/store/index.ts`, `src/core/code/pass/index.ts` and `src/core/types/index.ts`. They hold no function, so nothing is lost, but `squeal code` lists them as "does not parse". The fourth, `test/fixtures/node-test/edge/test/syntax.test.ts`, is broken on purpose. cezar has no `export type *`. Its one parse error is a raw NUL byte inside a string literal (`split('<NUL>')`, `packages/cezar/src/git-worktree.ts:351`), which leaves 1 function not judged (P6).
- **The first-count status line** reads `Complexity: 0 functions over 20; counting, 800 of 1204 files; squeal code lists them.` The "0 functions over 20" is not yet true; D6 gives `Complexity: counting, 340 of 600 files.`
- **Delivery titles.** A delivery of `STILL FAIL` lines alone is titled `SQUEAL · 3 complexity changes at revision 12`, though nothing changed state. A delivery with test failures and a `STILL FAIL` is titled `8 checks changed (8 tests)`, which leaves the code line out.
- **How Sonnet edits.** Most edits were Bash heredocs (`python3 - <<'E' … open(p,'w')`) or `sed -i`, not the Edit tool, unless the prompt named the Edit tool. The PreToolUse hook for Bash carries no SQUEAL text, so a Bash edit's line comes with the next PostToolBatch. In 2 of 13 deliveries that PostToolBatch came before the pass had stored the revision (0.4 s and 0.5 s after the edit), and the line waited for the agent's next tool call (21.4 s and 8.5 s).
- **Agents ran `squeal code` themselves** in 4 of 12 sessions, all four of them refactors (sq2, sq5, cz2, cz5r). No agent ran `squeal code --changed`.
- **Not complexity, seen on the way.** A daemon exits 3 s after its last session ends. In cz4r, Squeal had no result for `pasted-attachments.test.ts` after two waits (60 s and 120 s), and the agent ran `npm test` itself. A cezar test run by the daemon left a QA server and its lease watcher running after the daemon stopped (started 06:56Z, both stopped at the cleanup); this is the e2e-server leak already filed as cezarion #1448.

### Proposed rows

The numbers continue after 015-18; the coordinator assigns the final ones. None of these is fixed here.

| Row | Problem, with the evidence | Done when |
| --- | --- | --- |
| P1, 015-19 a pull is not the agent's edit | sq6: `git merge --ff-only` brought 4 `STILL FAIL … after the edit` lines (`namedLine`, `waitForNamed.<withStatusStore>`, `recordFocusedTier.<map>`, `report`). The session never edited them. These are the 4 functions `window.md` saw after a rebase. D6's rule takes any moved body as the agent's edit. Proposal: D6's first-edit rule skips a function whose new body matches its body at the new `HEAD`, when `HEAD` moved in the same revision (a pull, merge, rebase or checkout). A `FAIL` or `PASS` from such a revision is still delivered, as a test result would be. D6 amendment | A pass test: a revision that moves `HEAD` and changes a failing function's body to the committed one marks no edit, and the consumer gets no `STILL FAIL`. An edit in the working tree after it still gets one |
| P2, 015-20 a change made with no daemon is told as the session's | sq2: a `git reset --hard` made while no daemon ran (a daemon exits 3 s after its last session) was delivered as `FAIL complexity: stopCommand … is 21, over 20` 25.8 s into the next session. The registration said 80 over when 81 were. The SessionStart hook seeds the view from the store before the new daemon has counted the catch-up revision. Proposal: a registration made while the daemon's code pass has not reached the latest revision is seeded again, by count only, once the pass reaches it, as D6's summary re-seeds after a policy change. D6 amendment | An integration test: stop the daemon, change a function from 20 to 21, start a session (its hook starts the daemon), edit another file. The session gets no `FAIL` line for that function, and its registration count matches `squeal code` |
| P3, 015-21 a failed fix attempt is quiet | sq3: after `FAIL … retryCommand … is 23` the agent cut it to 22 and heard nothing. It ended with "I haven't confirmed the function is back under 20". D5 makes fail to fail quiet, and D7 keeps code out of Stop. Options, a product decision: (a) a function told `FAIL` in this session whose body moves again and stays over is told once more, as `STILL FAIL`; (b) the Stop hook, which cannot reach the model without blocking, names nothing, but the next delivery after such an edit says it once; (c) leave as is, since the agent could run `squeal code`. My default is (a) | With (a): a delivery test, `FAIL` at 23 then an edit to 22, gets one `STILL FAIL … is 22` line; a third edit to 21 is quiet |
| P4, 015-22 `squeal code` marks a count that is behind the file | sq2: 5 s after its edit, the agent's `squeal code src/cli/run.ts` printed `runCommand  CC 27 … over since revision 0` (the old count); it slept 5 s and asked again. cz2: "The `squeal code` output I printed was from before Squeal re-measured the edit". Proposal: `squeal code <path>` compares each file's bytes with its counted blob. When they differ, it waits up to 750 ms for the pass, as `squeal status <path>` waits for its own pass. If the count is still behind, the file says `pending: changed since revision N, not counted yet` | A CLI test: edit a counted file with no daemon pass; `squeal code <path>` prints the file as pending, not the old counts |
| P5, 015-23 a code delivery lost to the hook timeout; views of every function | cz6: `statusFor` went from 20 to 21 (stored `pass-to-fail`, revision 26), but the PostToolBatch hook was cancelled at 2.14 s and the session ended with its view still `pass`. In cezar a PostToolBatch with a code line took 1.05 s at the median, and one without took 0.57 s. Each session seeds about 16,250 view rows in cezar, and the rows of ended sessions stay (129,979 after 8 sessions). Proposal: seed and keep view rows only for functions over the threshold, since a missing row reads as `pass`; drop a consumer's code views at SessionEnd or with C7's departed consumers; and measure the hook's code step against its share of the 2 s budget | A delivery test on a store with 20,000 functions: a PostToolBatch with one code transition stays under 0.3 s on this host at ordinary load. A store test: after SessionEnd, the consumer has no view rows. A registration writes one view row per failing function |
| P6, 015-24 two parse errors that need not be | `export type * from` (TypeScript 5.0) does not parse in the shipped grammar, so 3 barrel files in squeal are listed as "does not parse" with 0 functions lost. A raw NUL byte in a string literal (cezar `git-worktree.ts:351`) leaves 1 function not judged. Proposal: update `tree-sitter-tsx` if a release parses `export type *`, and move `COUNTER_VERSION`; replace each NUL with a space before parsing, so offsets stay the same | A counter fixture with `export type * from "./x.js"` and a string holding a NUL: both parse, and the function after the NUL is counted |

Two smaller points belong in whichever row touches the wording next, not in rows of their own: the first-count status line should not say "0 functions over 20" while counting, and a delivery title should not count `STILL FAIL` lines as changes, or leave code lines out of the count.

### For the next worker

- Part B (the passive working day) still runs on the real sessions. These sessions add the questions above to its tables. P1 and P2 should be counted there as well: how many `STILL FAIL` lines followed a pull, and how many `FAIL` or `PASS` lines came from a catch-up.
- After a reset or checkout between sessions, start a daemon and wait for `squeal status --wait` before the next session starts. Without that, the next session's registration is stale (P2). Never run two sessions in one clone.
- The raw streams, the transcripts and copies of both code stores stay under `/home/squeal-e2e/runs/d1510/` (`claude/projects/`, `evidence/`) and `/tmp/dogfood-015-10/w-4ddd4e37/logs/` while the host keeps them. The clones were removed after `squeal stop` in each.
