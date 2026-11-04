# 019 Run triggers: dogfooding lessons

## Round 1 (019-17)

Task 019-17, 2026-11-04, worker dc7216e0. Squeal 0.1.398 (main at `4163f5de8`, unreleased) from `git archive`, installed for the throwaway user `squeal-e2e` in Claude Code 2.1.300 and Codex 0.160.1. Eleven `claude -p --model sonnet` sessions and one `codex exec` session on `gpt-6-astra`, in two clones: the Part A fixture (unit at `edit`, lint at `commit`, e2e at `stop` after unit with `maxParallel: 1`; its e2e file sleeps 15 s) and cezarion at `10e7a5782` (its e2e browser project at `stop` after its unit projects, lint at `commit`; or its own configuration, the control). The brief is `tasks/wave-4.md`, "019-17". The setup, the scripts and what went wrong are in `tasks/019-17/notes.md`; the scripts in `tasks/019-17/bin/`, the prompts in `tasks/019-17/prompts/`. Every SQUEAL line quoted here is copied from a session's stream.

### Verdict

The groups run at their moments, Stop waits for the group at `stop`, and the agents read the group lines and acted on them. The commit report did not help any agent.

- **Moments.** No edit in any session ran an e2e file; each edit ran the unit files it re-keyed, and the e2e file waited "for the agent to pause". Lint ran at commits only.
- **Stop.** Stop started the e2e group and waited 15.4 to 15.7 s for its 15 s file in five Stops of four sessions (f2d, f2e, f6a, x2). With `stop.maxHolds` 2 the second Stop checked the agent's fix (f2e); with 1 it did not, and the agent said it would be checked (f2d). In Codex the first Stop's hold was the 2 s entry's, with no wait, so `maxHolds` 2 did not check the fix either (x2, P3).
- **Agents.** In the fixture, both agents not told to leave checking to Stop ran `squeal run e2e --wait` themselves after a line named the group (f2a, f4) and got the verdict in 16.4 s and 1.8 s. In cezarion, Stop's 120 s wait for an e2e group that never started still delivered a real unit failure the agent then fixed (c1); the same task with cezarion's own configuration ended silent with that test broken (c5).
- **Commits.** No agent saw a commit line. c3's agent committed as its last tool call; the line comes only at a later boundary and never at Stop (P2). In cezarion the stored line was "Commit fcaba9a: 0 known failures; lint 0 findings, 2283 files not determined; 1 test file not determined (unstaged changes); 1050 test files still running", while the commit's own file had a lint finding (P1, P4).

### Answers

- **Open question 4 (partial staging).** "Not determined for this commit" is enough. The probe (`bin/partial.sh`, no model) committed `src/math.ts` and left an edit of `src/strings.ts` unstaged; the line said "2 test files not determined (unstaged changes)", the two test files that read `strings.ts`. Agents almost never stage part of a file: of 14,460 agent commands with `git commit` in this host's Claude Code transcripts, 7 (0.05%) use `git add -p`, `-i` or `commit -p`; 4,223 (29%) add everything first; the rest name paths, and whether other files stayed unstaged is not known from the commands. A scratch checkout would buy a verdict for a case that is rare at the cost of a second install and daemon. The real gap is the other direction: an untracked file made c3's whole commit "not determined" (P4).
- **Open question 6 (a Claude Code Stop after an interrupt).** No Stop fires. Esc is not available in `-p`; the two interrupts that are were probed 5 s into a `sleep 60` the agent ran after an edit. The SDK's interrupt (f6a, stream-json input) and SIGINT (f6b) both rejected the Bash call and ended the turn with `error_during_execution`; no Stop hook ran. In f6a the next prompt's hook carried the undelivered news ("Squeal saw your edit and queued 2 test files"), and that turn's Stop waited 15.4 s for the e2e file. In f6b the session ended; the e2e file ran 3 s later as a pause, and nobody was told. So a turn interrupted after an edit is not held, its hold count starts again at the next prompt, and a group at `stop` waits for the next Stop or the session's end.
- **Open question 7 and row 019-19 (a lane per group).** A fixture daemon with a unit lane and an e2e lane held 150 to 276 MB RSS and 26 to 32 MB heap through every session (table below). Across 20 e2e lane cycles (`bin/cycles.mjs`: a new `src/delay.ts`, `squeal run e2e --wait`, 70 s for the lane's Vitest instance to close, then the heap after two forced GCs) the heap rose 25.6 to 31.2 MB, most of it in the first ten cycles, and private memory rose 151.6 to 178.5 MB, about 1 MB a cycle, without levelling off (see "Memory"). So a Vitest instance per group is acceptable in size, and 019-19's leak is the cost: about 1 MB of private memory per run of a group whose instance was closed, until the daemon exits. cezarion's daemon, one process for 1,220 test files, 2,283 lint files, coverage and complexity, held 1.0 to 2.2 GB RSS and 350 to 1,280 MB heap.

### Goals 1 to 6

| Goal | Judgment | Evidence |
| --- | --- | --- |
| 1. Groups with their moments | Met | Part A: an edit runs unit only, a commit runs lint. Sessions: every edit's runs were unit files (store rows); the e2e line read "1 pending, waiting for the unit group's files" or "waiting for the agent to pause" (f2a to f4, x2); c3's lint ran at its commit. One gap: with no agent in a turn, the worktree reads as paused, so a group at `stop` runs at a fresh repository's first start before any registration (Part A, `notes.md`) |
| 2. No new keys behaves as today | Met, one accepted difference | Part A's control: the same session on 0.1.393's plugin and this one gives equal texts, Stop decisions and runs, except that status after a commit no longer says "dirty not known" (D5's sync pass knows the tree is clean). c5's lines are today's ("Slow tier: 90 test files; 90 pending. Squeal runs them after the fast tests") |
| 3. Every group its own lane | Met where measured | Part A: e2e never overlaps itself and starts after unit at each revision. Fixture: unit results about 0.3 s after an edit while e2e waited. cezarion: an edit's first run started 21.5 s after its revision, behind the baseline, and e2e never started (P5) |
| 4. Stop waits, starts, holds `maxHolds` times | Met, with three gaps | f2d, f2e, x2, c1, c3: Stop requested the group and waited (15.4 to 15.7 s in the fixture; the full 120 s bound in cezarion). Gaps: the first Stop can spend a hold without a wait (P3); a group that cannot start within the bound still costs the bound (P5); the agent is not told when no hold is left (P6) |
| 5. A report per commit | Not met in practice | Part A shows the line and its one update. In the sessions no commit line reached an agent (P2); the stored lines counted work that is not the commit's as running (P1) and lint as not determined (P4) |
| 6. The agent is told each moment | Met | The primer named every moment in every groups session: "Check groups: unit after each edit; e2e at Stop, and Stop waits for them; lint when you commit" in the fixture, and "unit and tests (the test files no group selects) after each edit; …" in cezarion, whose node:test files no group selects; and status and edit lines named the e2e group and `squeal run e2e --wait 60000`. f2a and f4 used that command unprompted; c1's agent used `squeal run unit --wait`, which waited its whole 120 s for the group's backlog (Other observations) |

### Setup

| Item | Value |
| --- | --- |
| Isolation | The OS user `squeal-e2e`, case root `/home/squeal-e2e/runs/d1917`; credentials by name only; scratch `/tmp/dogfood-019-17` (`notes.md`) |
| Squeal | 0.1.398 from `git archive 4163f5de8`; Claude Code plugin at user scope; Codex plugin (adapter 1.0.3) with the 0.1.398 runtime selected and both Stop handlers trusted |
| Harnesses | Claude Code 2.1.300, `claude -p --model sonnet`, bypass permissions, stream-json with hook events. Codex 0.160.1, `codex exec --json -m gpt-6-astra`, reasoning effort medium |
| Fixture | Part A's, 4 test files, e2e file 15 s. Branches `fix-h1`, `fix-h2` (`stop.maxHolds` 1 and 2). From f2d each session started on a new store |
| cezarion | `10e7a5782`, 1,220 test files (1,019 Vitest unit, 90 browser e2e, 111 node:test), oxlint on 2,283 files, coverage on. Branches `cez-groups` and `cez-today`. Its browser e2e cannot launch Chrome as `squeal-e2e`: global setup fails in 29 s (`notes.md`) |
| Sessions | 03:01Z to 03:20Z. Load gate 24: every session started at a one-minute load of 6.7 to 15.3 |
| Cleanup | No daemon and no process of `squeal-e2e` left at 03:40:27Z ("Cleanup" below) |

### The sessions

Times are seconds from the session's first stream line. "Right?" compares the line with the files and the store's runs.

**f2a (fixture, `maxHolds` 1).** Task: `shout("hi")` returns "HI!!"; update `test/strings.test.ts`. Load 6.7; 48 s. Daemon RSS 251 MB, heap 28 MB at the start; 242 MB in the last sample before the daemon exited.

| t | SQUEAL line (about groups, Stop or commits) | Agent's next action | Right? |
| --- | --- | --- | --- |
| 4.84 | `e2e: 2 test files; 1 current at revision 0; 1 pending, waiting for the unit group's files. … Stop waits up to 2 min for them; squeal run e2e --wait 60000 runs it now` | `squeal status --wait`, which said the e2e file waits for Stop; "The e2e test reads `shout` too, so I'll run it now": `squeal run e2e --wait 60000` | Yes |
| 24.54 | `squeal run e2e` result: `Group e2e completed at revision 2: 1 known failure: 1 test`, then the boundary `FAIL [e2e] test/e2e/flow.test.ts > shouts end to end, PASS -> FAIL` | Read the e2e test, fixed it, ran `squeal run e2e --wait` again: `no known failures` (44.45) | Yes. 16.4 s from each request to the verdict |
| 46.53 | Stop: nothing (e2e current) | End | Yes. 0.3 s |

**f2c, f2b (fixture, `maxHolds` 1 and 2, "do not run tests").** The same edits as f2a make the same bytes, so Squeal reused f2a's results by key: the e2e failure came 0.1 s after the edit (f2c 5.45, f2b in the PreToolUse deny at 4.07), the agents fixed the e2e test, and the fix's pass came from the store before Stop. Stop never waited: the 2 s entry spoke, so the waiting entry gave up after its 3.0 s handoff wait in both. Right, and kept as a record of the cache; from f2d each session ran on a new store. f2b's first boundary also carried a commit line for the session runner's reset commit: `Commit 0a477f7: 0 known failures; lint 0 findings, 3 files not determined` (P4). RSS 152 to 156 MB, heap 26 to 29 MB.

**f2d (fixture, `maxHolds` 1, new store).** Load 12.3; 32 s. RSS 208 → 200 MB, heap 27.3 → 29.3 MB.

| t | SQUEAL line | Agent's next action | Right? |
| --- | --- | --- | --- |
| 3.79 | PreToolUse deny of the unit test edit: the old test failed against the new `shout` | Re-issued the edit | Right, but it denied the edit that fixes the failure (Other observations) |
| 7.76 | Stop 1, the 2 s entry's news: `PASS [unit] test/strings.test.ts`, `e2e: … 1 pending, waiting for the agent to pause` | "One e2e test file is still queued. Squeal runs it when I pause, and Stop waits for it." Stopped again | Yes |
| 27.59 | Stop 2, a hold after 15.7 s: `Squeal policy checks puts the e2e group at stop and the e2e group ran at revision 2: 1 check fails: [e2e] test/e2e/flow.test.ts > shouts end to end.` | Fixed the e2e test | Yes |
| 31.51 | Stop 3: nothing, at once (no hold left) | Final message: "I haven't run it. Squeal will re-run the e2e group when I stop." | The line is right by D4; the agent's belief is wrong: nothing checked its fix in the turn (P6) |

**f2e (fixture, `maxHolds` 2, new store).** Load 15.3; 42 s. RSS 205 → 206 MB, heap 27.3 → 28.6 MB.

| t | SQUEAL line | Agent's next action | Right? |
| --- | --- | --- | --- |
| 3.98 | `e2e: 2 test files; 1 current at revision 0; 1 pending, waiting for the unit group's files. … Stop waits up to 2 min for them` | Final message, Stop | Yes |
| 20.98 | Stop 1, a hold after 15.7 s: the e2e failure, as in f2d | Fixed the e2e test | Yes |
| 40.71 | Stop 2: nothing after 15.4 s (the fixed e2e file passed) | End, verified | Yes |

**f4 (fixture, the agent should use `squeal run <group>`, new store).** Task: an optional third parameter `c` of `add`, a unit test, "make sure the e2e tests pass too". Load 12.6; 19 s. RSS 254 → 276 MB, heap 32.4 → 32.3 MB.

| t | SQUEAL line | Agent's next action | Right? |
| --- | --- | --- | --- |
| 4.84 | `e2e: … 1 pending, waiting for the agent to pause. … squeal run e2e --wait 60000 runs it now` | "Need e2e result before finishing": `squeal run e2e --wait 60000; squeal status --wait 60000` | Yes |
| 7.88 | `Group e2e completed at revision 2: 1 known failure`, `FAIL [e2e] test/e2e/sums.test.ts > sums end to end … expected 9 to be 6` (`reduce` passes the index as `c`) | Fixed the e2e test, `squeal run --all --wait`: no known failures (14.68) | Yes. 1.8 s to the verdict |
| 17.42 | Stop: nothing | End | Yes |

**f6a, f6b (interrupts, `maxHolds` 1, new store).** Task: add `// checked` to `src/strings.ts`, then run `sleep 60 && echo done`. Load 9.5 and 8.7. RSS 247 → 239 and 242 → 251 MB, heap 26.6 → 27.0 and 26.6 → 28.5 MB. f6a: the SDK interrupt at about 8.6 s; no Stop; the second prompt's hook at 9.14 carried `e2e: … 1 pending, waiting for the agent to pause` and the saw-edit line; the agent answered; its Stop waited 15.4 s and was silent (the comment changes no result). f6b: SIGINT at about 8.4 s; no Stop; the session ended; the e2e file ran at 12.1 s. Both right; see open question 6.

**x2 (Codex, fixture, `maxHolds` 2, "do not run tests", new store).** Load 12.5; 64 s. RSS 245 → 228 MB, heap 28.0 → 29.9 MB. Times from the rollout.

| t (UTC) | SQUEAL line | Agent's next action | Right? |
| --- | --- | --- | --- |
| 03:10:50.5 | Stop 1, the 2 s entry's hold, no wait: `Squeal policy checks puts the e2e group at stop and 1 e2e test file is not current at revision 1: test/e2e/flow.test.ts. …/bin/squeal run e2e --wait runs them and waits for their results.` | "one e2e test is queued to run on pause", stopped again | The text is right; the hold should have been the waiting entry's (P3) |
| 03:11:10.0 | Stop 2, the waiting entry's hold after 15.4 s: the e2e failure | Fixed the e2e test | Yes |
| 03:11:22.6 | Stop 3: nothing (two holds spent) | End: "Verification is left to the automatic checks" | The fix was not checked although `maxHolds` was 2 (P3) |

**c1 (cezarion, groups).** Task: `parseEffort` falls back to "medium" for an unknown value. Load 10.3; 273 s. The unit baseline was still running (927 test files queued). RSS 1,220 → 1,128 MB (peak 2,129), heap 624 → 351 MB.

| t | SQUEAL line | Agent's next action | Right? |
| --- | --- | --- | --- |
| 0.32 | Registration: `e2e: 90 test files; 90 pending, waiting for the unit group's files. … Stop waits up to 2 min for them`; `unit: 1019 test files; 182 current …` | Edited `effort.ts`, the namesake test and `delegation/effort.ts`; no line at any of five boundaries (the edit's first run started 21.5 s after its revision) | Yes |
| 141.32 | Stop's hold after 120 s: `after 120 s 90 e2e test files are still not current at revision 6: … and 80 more`, with `FAIL [server] packages/cezar/src/core/claude-cli-runner.test.ts > buildClaudeArgs effort (#45) > omits the flag for auto/unknown values …, PASS -> FAIL` | Fixed `claude-cli-runner.test.ts`, then `squeal run unit --wait 120000`, which returned at its bound with 990 files queued; the boundary said `RESOLVED` | Yes. The e2e files never started: they follow unit, which had 911 files pending (P5). The failure ran at 103.6 to 118.7 s, 98 s after the edit, and reached the agent through the hold |
| 271.26 | Stop: nothing (hold spent) | End: "the Stop hook's 2-minute wait for them timed out" | Yes |

**c5 (cezarion, its own configuration, the control).** The same task. Load 8.6; 81 s. RSS 1,544 → 2,089 MB, heap 948 → 390 MB. The registration's line was today's: `Slow tier: 90 test files; 90 pending. Squeal runs them after the fast tests; squeal run --slow --wait 60000 waits for their results.` The agent made the same three edits, ran `squeal status --wait 60000`, which returned after 61 s with 4,291 tests queued and no failure yet, and ended its turn; Stop said nothing in 0.6 s. `claude-cli-runner.test.ts` stayed broken and the agent never heard of it. Right by today's rules.

**c3 (cezarion, groups: a commit with a lint finding).** Task: a private unused helper `isEffortLevel`, committed, then `git log -1 --stat`. Load 12.0 (24.5 at the end, from cezarion's own lint and unit backlog); 138 s. RSS 2,101 → 1,488 MB (peak 2,230), heap 1,282 → 424 MB.

| t | SQUEAL line | Agent's next action | Right? |
| --- | --- | --- | --- |
| 6.60 | The boundary after `git commit` (and `git log` in the same call): nothing | Final message, Stop | The line was asked for but comes at a later boundary, and there was none (P2) |
| 131.22 | Stop's hold after 120 s: e2e still not current (as in c1), with `FAIL lint: packages/contract/src/effort.ts (oxlint): 1 finding, +1 eslint(no-unused-vars) (Function 'isEffortLevel' is declared but never used.)` | "The lint failure is real, and it comes straight from what you asked for"; said `npm run lint` will fail until the helper is used | Yes: the finding equals the rule the task makes fail. 124.6 s from the commit to the agent, because the turn ended first and only the hold carried it |
| status | `Commit fcaba9a: 0 known failures; lint 0 findings, 2283 files not determined; 1 test file not determined (unstaged changes); 1050 test files still running` | (not delivered) | No: the commit's own file had 1 finding; no test group runs at commit, so none of the 1,050 runs for it (P1, P4) |

### Memory

| Daemon | RSS (MB) | Heap used (MB) | Notes |
| --- | --- | --- | --- |
| Fixture, each session (unit and e2e lanes) | 150 to 276 | 26.4 to 32.4 | Start to end of a session: −17 to +22 MB RSS, −2.3 to +2.0 MB heap |
| Fixture, 20 e2e lane cycles | see the cycle table | see the cycle table | One daemon, a lane instance made and closed per cycle |
| cezarion, 22 min from its start (one daemon, groups and today's configuration) | 677 at listing, 994 to 2,231, last 1,312 | 325 at listing, 351 to 1,282 | Sampled every 5 s (`logs/cez-mem.jsonl`); unit baseline, an edit closure of 958 files, lint of 2,283 files |

The 20 cycles (`bin/cycles.mjs`, 03:15Z to 03:40Z, load 7.6 to 24.5; each `squeal run e2e --wait` took 2.3 to 3.6 s; heap after two forced GCs):

| Cycle | 0 | 1 | 5 | 10 | 15 | 20 | Per cycle, 0 to 20 | Per cycle, 10 to 20 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Heap used (MB) | 25.6 | 26.7 | 28.5 | 30.6 | 31.0 | 31.2 | 0.28 | 0.06 |
| RssAnon (MB) | 151.6 | 156.6 | 163.1 | 168.3 | 172.8 | 178.5 | 1.35 | 1.02 |
| RSS (MB) | 223.6 | 229.2 | 235.7 | 240.8 | 245.4 | 251.0 | 1.37 | 1.02 |

The heap grew 0.43 MB a cycle over the first ten and 0.06 over the last ten; private memory grew about 1 MB a cycle throughout and did not level off. 019-12 measured 0.39 MB of heap and 2.2 MB of private memory a cycle on a fixture whose test files import 110 to 120 modules; this one's e2e files import two. The probe waited 70 s after each run for the lane's instance to close (60 s, 019-12); no log shows each close, so that the heap levels off here may also mean an instance was kept, not freed. Row 019-19's done-when ("flat across 20 lane cycles") is not met: RSS rose 27 MB in 20 cycles.

### Part A

`test/e2e/run-triggers.test.ts` and `run-triggers-control.test.ts` pass three times in a row (222 to 224 s each, load 5.6 to 8.9), commit `8873d52d1`. Two defects found while writing them are P1 and P3 below. The control compares this release with 0.1.393 for a repository with no `checks`: every text the agent got, the Stop decisions and the runs are equal, but for status after a commit, which drops "dirty not known" (D5's sync pass). Writing the test also found that every Codex end-to-end test of the plugin copy runs the plugin's seed runtime, 0.1.368, not the release under test (P7).

### Other observations

- **Results are shared by key across sessions** (f2b, f2c): an agent repeating an earlier edit gets the earlier verdict at once, and Stop has nothing to wait for. This is the design working.
- **The regression deny blocks the fix** (f2b, f2d; 001 D9): the PreToolUse after the source edit denied the agent's test edit, because the old test failed against the new source, and the agent had to send the edit again. Not 019.
- **News at Stop continues the turn without a hold** (f2b, f2c, f2d): the 2 s entry's news (a unit pass, the e2e line) made the agent answer and stop again. One extra round trip each; not counted in `stop.maxHolds`.
- **`squeal run <group> --wait` waits for the whole group**, its backlog included: c1's `squeal run unit --wait 120000` used its whole 120 s with 990 files queued, where `squeal status --wait <path>` answers for the files an edit touched. Its request line says "they run once unit has nothing pending" also for one file and when unit has nothing pending (f2a, f4).
- **gh-134 reproduced** (load 10, 2026-11-04): during cezarion's baseline a revision recorded `\tmp\squeal-1002\tmp\204d669a2359edeb\coverage-XHl4Up\.tmp\coverage-<id>.json` at the worktree root, and the next session's registration header named it as a changed path (c1; again at revision 15, c3). The human's own cezar checkout has two such entries. It is also the likely cause of c3's "not determined" counts (P4).
- **A fresh repository's first session**: the first SessionStart with no store says nothing, and `claude -p` does not register on its prompt, so until the first tool boundary no agent is in a turn and a `stop` group runs as at a pause (Part A).

### Proposed rows

Numbers are for the coordinator to assign. None is fixed here. Reproductions name the Part A test, the sessions and the scripts in `tasks/019-17/bin/`.

| Row | Problem, with the evidence | Done when |
| --- | --- | --- |
| P1 the commit report counts work that is not the commit's as running, and its update waits for it | `commitReport` (`src/core/scheduler/head-move.ts`) stores every keyed test file with a pending phase as `waiting.tests` (`testTally`'s `running`), and `testWaitEnded` holds while such a file stays pending without a commit group's ask. Part A: a commit while the e2e files waited for Stop read `2 test files still running`, and the update never came in 90 s although lint had finished; the test now commits after Stop ran them. c3: `1050 test files still running` (the unit backlog and the e2e group) in a repository whose only commit group is lint. Proposal: running and waiting count only files a commit group asked for at their key; other pending files are named by their moment or left out | Part A's commit with the e2e files pending gives its update once lint ends; a commit in a repository with only a lint group at commit never says "test files still running" |
| P2 the commit line does not reach an agent whose commit is its last tool call | The boundary that sees `HEAD` move asks the daemon for a pass and returns (019-13 known limit); the line comes at a later boundary, and Stop never shows it (019-22). c3's agent committed and ended its turn: no commit line in the session. Options: (a) that boundary waits up to 500 ms for the pass's report, inside the hook's 2 s; (b) Stop tells an untold commit line once, which continues the turn; (c) leave. Default (a) | With (a): a real-daemon test where a boundary right after a commit carries the commit line, and a boundary with no `HEAD` move waits for nothing |
| P3 the first Stop of a session can spend a hold without a wait | Until the waiting entry records that it runs for the session (`stopWaitRuns`, 001-297), the 2 s entry holds at once on the required checks, and that block counts as a hold. Both entries start together, so the first Stop is a race. x2 (Codex): the 2 s entry won, hold 1 had no wait, hold 2 found the e2e failure, and the agent's fix went unchecked with `maxHolds` 2. Part A's first probe: the same in Claude Code. Proposal: when the policy has a group Stop waits for and the harness has a waiting entry, the 2 s entry waits up to 500 ms for its record before it decides; or its hold before the record does not count | A harness test: both entries at a session's first Stop, the 2 s entry started first: the waiting entry decides, and the turn's holds count only its block |
| P4 lint and test files read "not determined" for reasons that are not partial staging | Part A and f2b: with a lint group at commit, files the commit did not change were never linted and read `lint 0 findings, 2 files not determined` (f2b: 3, for a commit that changed only `squeal.config.json`). c3: `lint 0 findings, 2283 files not determined; 1 test file not determined (unstaged changes)` although the commit's own file had 1 finding. Inferred cause in c3: the untracked gh-134 file differs from the commit, and 019-13 decision 4 makes whole-program lint checks not determined at any differing path. Proposal: the lint part counts the files the commit changed; an untracked file no key reads makes nothing not determined; "(unstaged changes)" only for files that are staged differently | Part A's commit reads `lint 1 finding` with no "not determined"; a commit beside an untracked file reads the same as without it |
| P5 Stop waits its whole bound for a group that cannot start in it | cezarion: e2e follows unit (`after`), and unit had 785 to 911 files pending (its baseline and a 958-file edit closure). Stop waited 120 s in c1 and c3 for e2e files that never started, then held with `after 120 s 90 e2e test files are still not current`, which does not say they never started or why. D1's `after` works as specified; the cost and the text are the problem. A product decision: (a) the hold names the wait (`they have not started: they run after unit, which has 872 files pending`); (b) also, Stop's request runs the predecessors' pending files of the current revision ahead of their backlog; (c) leave. Default (a) | With (a): a harness test where a required group's predecessor has files pending at the bound: the hold names the predecessor and its count |
| P6 the last hold does not say it is the last | f2d (`maxHolds` 1): after the one hold the agent fixed the e2e test and wrote "Squeal will re-run the e2e group when I stop"; Stop ended the turn at once and the e2e file ran after it, untold. The primer says "Stop waits for them"; no text says how many holds are left. Proposal: a hold that spends the last one says so and names the group's run command ("this is Stop's last hold this turn; `squeal run e2e --wait` checks a fix") | A harness test with `maxHolds` 1 and 2: only the last hold's reason says no hold is left, with the run command |
| P7 Codex end-to-end tests run the seed runtime, not the release | `test/e2e/harness.ts` copies `plugins/codex` and gives it an empty data folder, so the adapter runs `seed/` (0.1.368). Part A's Codex fixture showed no `groupTiers` until `pluginAt` installed and selected `plugins/codex-runtime`. Every Codex scenario that installs no runtime (`slow-vitest`, `lifecycle`, `policy` and the rest) checks 0.1.368's hook and daemon code; only the adapter is current. Proposal: the harness selects this worktree's runtime for Codex fixtures by default (`pluginAt`'s method), and the tests that mean the seed say so | A Codex fixture's `squeal --version` through its hooks is `package.json`'s version; the seed tests still pass |

### Cleanup

At 03:40:27Z `squeal stop` in both clones found no daemon left, `mem.mjs` found no daemon of either clone, and `ps -u squeal-e2e` listed no process. cezarion's test server, which the browser e2e probe's global setup had started detached, was stopped at 03:21Z with its `test-env-down.sh`, and its lease watcher with `kill`. No daemon of a Part A fixture (`/tmp/squeal-e2e-*`) was running. The clones stay in the case root as evidence; `xdg/squeal` keeps one empty `repo.<id>/group.e2e.0.lock` folder per removed store.

### For the next worker

- A session that should exercise Stop's wait must keep the agent from checking first, and must write bytes the store has not seen (`notes.md`).
- cezarion's browser e2e needs a host where Chrome can launch for the session's user; until then its e2e group fails in global setup, and a Stop wait there measures only `after` and the bound.
- P1, P2 and P4 decide whether the commit line is worth showing; until they are fixed, a repository with a slow backlog sees lines that count the backlog.
