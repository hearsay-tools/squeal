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

## Round 2 (019-33)

Task 019-33, 2026-11-04, worker 7de9ed74. Squeal 0.1.400 (main at `636d2088f`, after wave 5 fixed P1 to P7) from `git archive`, installed for the throwaway user `squeal-e2e` in Claude Code 2.1.300 and Codex 0.160.1, in a new case root. Eleven `claude -p --model sonnet` sessions and two `codex exec` sessions on `gpt-6-astra`, each on a new store, in the same two clones as Round 1: the Part A fixture (unit at `edit`, lint at `commit`, e2e at `stop` after unit with `maxParallel: 1`; its e2e file sleeps 15 s) and cezarion at `10e7a5782` (Round 1's bundle). Three probes with no model: `p3probe.mjs` (18 first Stops), `symlink.sh` and `update.sh`. The brief is `tasks/wave-6.md`, "019-33". The scripts are in `tasks/019-33/bin/` (Round 1's unchanged ones run from `tasks/019-17/bin/`), the prompts in `tasks/019-33/prompts/`, the setup and raw data in `tasks/019-33/notes.md`. Every SQUEAL line quoted here is copied from a session's stream or a probe's output.

### Verdict

Wave 5 fixed what Round 1 saw in the fixture: the commit line now reaches the agent in the boundary of its commit, it counts only the commit's work, and the last hold says that it is the last. Four gaps stay or are new.

- **Commits (Goal 5).** In the fixture the commit line came in the same boundary as the agent's last tool call, the `git commit`, 0.2 and 0.3 s after it (s1f, s2; P2 fixed there). It counted no test file as running (P1 fixed) and read the partly staged file and the untracked notes file right (P4 fixed). Its update (`lint 1 finding`) never reached either agent: it was stored 17 to 18 s after the commit, after the turn had ended, and Stop does not tell commit lines (P8, P9). s1f's agent then told the user "lint had no findings". In cezarion no commit line reached the agent at all: the boundary waited its 500 ms and gave up (s1c, P2's known limit). Its stored line said `1 test file not determined (unstaged changes)` on a clean tree (P11).
- **Stop's first hold (P3).** Fixed in 11 of the 12 sessions whose first Stop had the e2e group to wait for, Codex included (s5: `maxHolds` 2 now checked the agent's fix). It remains when the first Stop also has news to tell: s3b in Claude Code spent its first hold at once, with no wait, and the agent's fix went unchecked with `maxHolds` 2, as in Round 1's x2. The probe shows why: the 2 s entry keeps its news's write transaction open while it waits for the waiting entry's record, and that entry cannot write the record until the transaction ends (P10).
- **The last hold (P6).** Every last hold said so and named `squeal run e2e --wait` (s3a, s3b, s3c, s5b, s1c, s4), and it was right each time. Codex's agent then reported the truth ("The end-to-end fix hasn't been rechecked", s5b), and both cezarion agents told the user the e2e files had not run. Claude Code's agents in the fixture still ended with "Squeal will re-check it when I stop" or "leaving the re-check to the gate" (s3a, s3b, s3c), and none ran the command, also when the prompt allowed squeal commands (s3c). Their prompt said the repository checks the change when they stop. The text is right; it does not change what these agents do.
- **A group behind its predecessor (P5).** The bound's hold named the predecessor and its count, `They have not started: they run after the unit group, which has 964 test files pending.` (s1c; 962 in s4), equal to status at that moment, and both agents repeated it correctly. Stop still waits its whole 120 s for files that cannot start in it (option (a) as chosen), and in s4 the unit file that fails with the agent's change ran 1 s after the session ended.

### Goals 1 to 6

| Goal | Judgment | Evidence |
| --- | --- | --- |
| 1. Groups with their moments | Met | Every fixture edit ran `test/strings.test.ts` only; `flow.test.ts` ran after a Stop (store rows of s3a to s5b) or at a pause; lint ran at the commits (s1f, s2) and at no edit. In cezarion the e2e group stayed "waiting for the unit group's files" through every session |
| 2. No new keys behaves as today | Met | s6, the same task without `checks`: no group line and no "Check groups" sentence in the primer, the same regression deny and re-issue, a Stop that said nothing in 0.01 s, and `flow.test.ts` run as an ordinary test that outlived the session untold, as before 019. The 0.1.400 review compared the texts without `checks` with 0.1.399: equal |
| 3. Every group its own lane | Met where measured | Fixture: each e2e run started after the unit run of its revision ended (s3a to s5b). cezarion: e2e never started (unit had 960 to 1,019 files pending); an edit's first run started 24.2 s after its first revision and 14.2 s after its last (s4), behind the baseline, as in Round 1 |
| 4. Stop waits, starts, holds `maxHolds` times | Met, with one gap | Stop requested e2e and waited 15.3 to 16.5 s in the fixture (14 Stops) and the full bound in cezarion (120.5 s, s1c and s4). `maxHolds` 2 checked the fix (s3b2, s3b3, s3b4, s5); `maxHolds` 1 held once (s3a, s3c, s5b). Gap: a first Stop with news can spend a hold without a wait (s3b, P10) |
| 5. A report per commit | Partly met | The line reaches an agent whose commit is its last tool call in the fixture, and is right (s1f, s2). Its update reaches no such agent (P8, P9); in cezarion the line itself does not reach it (s1c), and its stored test part is wrong (P11) |
| 6. The agent is told each moment | Met | The primer said "Check groups: unit after each edit; e2e at Stop, and Stop waits for them; lint when you commit; `squeal run <group> --wait 60000` runs one now" in every fixture session, Codex included, and "unit and tests (the test files no group selects) after each edit; …" in cezarion (s1c, s4); the edit, status, P5 and P6 lines named the e2e group and its command. What agents do with the last-hold line is the P6 note above |

### Setup

| Item | Value |
| --- | --- |
| Isolation | The OS user `squeal-e2e`, case root `/home/squeal-e2e/runs/d1933` (its pnpm store is Round 1's, linked); credentials by name only; scratch `/tmp/dogfood-019-33` (`tasks/019-33/notes.md`) |
| Squeal | 0.1.400 from `git archive 636d2088f`; Claude Code plugin at user scope; Codex plugin (adapter 1.0.3) with the 0.1.400 runtime selected, and all ten hooks trusted again with `squeal init --harness codex --trust --yes`, both Stop handlers among them |
| Harnesses | Claude Code 2.1.300, `claude -p --model sonnet`, bypass permissions, stream-json with hook events. Codex 0.160.1, `codex exec --json -m gpt-6-astra`, reasoning effort medium |
| Fixture | Part A's, 4 test files, e2e file 15 s. Branches `fix-h1`, `fix-h2` (`stop.maxHolds` 1 and 2) and `fix-none` (lint, no `checks`: Goal 2's control) |
| cezarion | `10e7a5782`, branch `cez-groups` (its own configuration plus `checks`: e2e at stop after unit, `maxHolds` 1). A new store each session, so the unit baseline of 1,019 files was queued behind every session |
| Sessions | 05:19Z to 06:04Z. Load gate 24: every session started at a one-minute load of 5.0 to 19.2; the gate never waited |
| Cleanup | No daemon and no process of `squeal-e2e` left at 05:59:57Z and again at 06:04:48Z ("Cleanup" below) |

### The sessions

Times are seconds from the session's first stream line. "Right?" compares the line with the files and the store's runs.

**s1f (fixture, `maxHolds` 1: the commit is the last tool call).** Task: a private unused helper `isLoud` in `src/strings.ts`, committed, "Make the commit your last command". Load 13.2; 23 s. RSS 247.2 → 239.8 MB, heap 27.1 → 28.1 MB.

| t | SQUEAL line | Agent's next action | Right? |
| --- | --- | --- | --- |
| 5.13 | The boundary of `git add src/strings.ts && git commit` (216 ms): `Commit d5e4440: 0 known failures; lint 0 findings, 1 file still running`, beside the e2e line and "Squeal saw your edit and queued 2 test files" | Final message: "Squeal showed 2 test files still pending, and lint had no findings with 1 file still running." | The line is right (lint was running; no test file counted). The agent read "0 findings" as "no findings" |
| 6.77 | Stop: the waiting entry waited 15.4 s, then nothing (`flow.test.ts` passed) | End | Yes |
| 22.1 | Stored, never told: `Commit d5e4440: 0 known failures; lint 1 finding` | (none) | The update is right; it came after the turn (P8, P9) |

**s2 (fixture, `maxHolds` 1: s1f beside an untracked `notes.md` and a partly staged `src/math.ts`).** Before the session: `notes.md` untracked; `src/math.ts` with a new `sub` staged and a comment unstaged (`MM src/math.ts`). Task: s1f's, "together with what is already staged", leaving the rest. Load 12.1; 26 s. RSS 240.5 → 239.9 MB, heap 26.7 → 27.8 MB.

| t | SQUEAL line | Agent's next action | Right? |
| --- | --- | --- | --- |
| 7.20 | The commit's boundary (281 ms): `Commit f63eab6: 0 known failures; lint 0 findings, 1 file not determined, 1 file still running; 2 test files not determined (unstaged changes)` | Final message: "Squeal's checks on the commit were still running when I finished, so I have no results from them." | Yes: `src/strings.ts` was being linted; `src/math.ts` in the working tree differs from the commit, so its lint and the two test files that read it are not determined; `notes.md` changed nothing. The lint part gives no reason where the test part does |
| 9.81 | Stop: 15.4 s, then nothing | End | Yes |
| 25.1 | Stored, never told: `lint 1 finding, 1 file not determined; 2 test files not determined (unstaged changes)` | (none) | Right; after the turn (P8, P9) |

**s1c (cezarion: the commit is the last tool call).** Task: Round 1's c3 without the `git log`. The unit baseline had 1,214 of 1,220 files not current at the start. Load 11.2; 135 s. RSS 1,107 → 1,210 MB (peak 1,450), heap 323 → 326 MB.

| t | SQUEAL line | Agent's next action | Right? |
| --- | --- | --- | --- |
| 7.16 | The commit's boundary waited 715 ms and gave nothing | Final message, Stop | The pass that stores the report took longer than the 500 ms bound (019-29's known limit); the line came at no boundary |
| 129.33 | Stop's hold after 120.5 s: `… after 120 s 90 e2e test files are still not current at revision 1: … and 80 more. They have not started: they run after the unit group, which has 964 test files pending.` and `This is Stop's last hold this turn: no later Stop in it waits for the e2e group, and squeal run e2e --wait runs it and waits for its results.`, then status | "none of the 90 e2e files have started. They queue behind the unit group, which still has 964 files pending." Offered to run `squeal run e2e --wait 60000`; did not, as told to run nothing after the commit | Yes: status read 964 pending at that moment. The commit line and its lint finding were not in it, and the agent said "I don't expect it to break anything" |
| status | `Commit 172965e: 0 known failures; lint 1 finding; 1 test file not determined (unstaged changes)` (stored at 20.5 s) | (not delivered) | Lint is right (P1 and P4 fixed: no backlog counted, only the commit's file). The test part is not: `git status` was clean (P11) |

**s3a (fixture, `maxHolds` 1, "do not run tests or squeal commands").** Round 1's f2d. Load 11.4; 32 s. RSS 235.6 → 223.0 MB, heap 26.5 → 30.0 MB.

| t | SQUEAL line | Agent's next action | Right? |
| --- | --- | --- | --- |
| 3.85 | PreToolUse deny of the test edit (the old test fails against the new `shout`) | Re-issued it | As Round 1 (001 D9) |
| 7.75 | Stop 1, the 2 s entry's news after 0.1 s: `PASS [unit] test/strings.test.ts`, `e2e: … 1 pending, waiting for the agent to pause` | "One e2e test file is still queued, and Squeal runs it when I stop." Stopped again | Yes. The waiting entry's record came in time: no hold spent |
| 27.32 | Stop 2, the waiting entry's hold after 15.4 s: `the e2e group ran at revision 2: 1 check fails: [e2e] test/e2e/flow.test.ts > shouts end to end.` and the last-hold line | Fixed the e2e test | Yes |
| 31.49 | Stop 3: nothing | "I haven't confirmed it passes: I haven't run it, and Squeal will re-check it when I stop." | The line was right; the e2e file re-ran after the turn and nobody was told |

**s3b (fixture, `maxHolds` 2, the same prompt).** Round 1's f2e. Load 7.1; 35 s. RSS 244.1 → 246.4 MB, heap 27.3 → 29.4 MB.

| t | SQUEAL line | Agent's next action | Right? |
| --- | --- | --- | --- |
| 7.85 | Stop 1, the 2 s entry's hold after 0.50 s, no wait: `Squeal policy checks puts the e2e group at stop and 1 e2e test file is not current at revision 2: test/e2e/flow.test.ts. squeal run e2e --wait runs them and waits for their results.`, with its news (`PASS [unit]`). The waiting entry: nothing after 3.5 s | "I'm not running `squeal run e2e`, because you told me not to … the stop check should run it." | The text is right; the hold should have been the waiting entry's (P10) |
| 29.45 | Stop 2, the waiting entry's hold after 15.3 s: the e2e failure and the last-hold line | Fixed the e2e test | Yes |
| 33.80 | Stop 3: nothing (two holds spent) | "the stop check will be the first run of it" | The fix was not checked although `maxHolds` was 2 (P10); `flow.test.ts` ran at 34.2 s, untold |

**s3b2, s3b3, s3b4 (s3b again).** Loads 10.6, 14.8, 16.1; 44 to 45 s. The agents sent both edits in one batch, so no deny, and the first Stop had no news: the 2 s entry said nothing in 0.07 s, and the waiting entry held after 15.4, 16.3 and 16.5 s with the e2e failure and no last-hold line. Each agent fixed the e2e test; the second Stop waited 15.7, 15.7 and 15.4 s and said nothing (the fix passed). Final messages: "The e2e check runs again when I stop" and the like. All right: this is `maxHolds` 2 as designed.

**s3c (fixture, `maxHolds` 1, "Do not run the tests yourself", squeal commands allowed).** Load 8.2; 29 s. RSS 249.9 → 246.9 MB, heap 26.8 → 29.4 MB. Both edits in one batch; the boundary: `e2e: … 1 pending, waiting for the unit group's files`. Stop 1 (6.6): the waiting entry's hold after 15.4 s with the failure and the last-hold line; the agent fixed the e2e test and ended "I haven't re-run it. The test sleeps for `DELAY_MS` first, so I'm leaving the re-check to the gate." Stop 2: nothing. The lines were right; the agent did not use the command the last hold named.

**s5 (Codex, fixture, `maxHolds` 2, s3's prompt).** Round 1's x2. Load 13.0; 56 s. RSS 250.4 → 241.1 MB, heap 27.2 → 28.3 MB. Times from the stream and the rollout.

| t | SQUEAL line | Agent's next action | Right? |
| --- | --- | --- | --- |
| 30.6 | Stop 1, the waiting entry's hold, after the e2e run of 15.26 to 30.51 s: the failure, no last-hold line | Fixed the e2e test | Yes: P3 fixed here |
| 55.6 | Stop 2: nothing, after the e2e run of 40.51 to 55.78 s (the fix passed) | End: "verification is left to the stop checks" | Yes: the fix was checked |

**s5b (Codex, fixture, `maxHolds` 1).** Load 11.3; 48 s. RSS 237.2 → 235.4 MB, heap 26.5 → 29.3 MB. Stop 1's hold at 36.2 s, after the e2e run of 20.88 to 36.17 s: the failure and the last-hold line, with the plugin's CLI path. The agent read Squeal's skill file, fixed the e2e test and ended: "The end-to-end fix hasn't been rechecked; I ran no tests or Squeal commands, as requested." Stop 2: nothing; `flow.test.ts` ran at 47.5 s, after the turn. Right, and the agent's last words are true.

**s4 (cezarion, Round 1's c1 task: `parseEffort` falls back to "medium").** The unit baseline of 1,019 files was queued. Load 19.2; 161 s. RSS 1,179 → 1,790 MB (peak 2,072), heap 326 → 324 MB.

| t | SQUEAL line | Agent's next action | Right? |
| --- | --- | --- | --- |
| 5.1 to 11.7 | Two edits of `effort.ts`, two of `effort.test.ts`: no line at any boundary | Final message, Stop | Yes: no result had come. No test run started between 5.2 and 30.3 s; `effort.test.ts` ran at 30.6 to 33.2 s |
| 135.96 | Stop's hold after 120.5 s: the 90 e2e files, `They have not started: they run after the unit group, which has 962 test files pending.`, the last-hold line, status | Ran `npm test -- packages/cezar/src/core/effort.test.ts` itself (17 s, passed); its boundary said "Squeal saw your edit and queued 958 test files" | Yes |
| 160.13 | Stop: nothing (no hold left) | End: "The e2e group has not run: all 90 files are still waiting behind about 960 queued unit files. No Squeal check shows a failure so far" | True, but `claude-cli-runner.test.ts`, which this change breaks (Round 1's c1), started at 161.3 s, after the session. Nobody was told |

**s6 (fixture without `checks`, Goal 2's control).** s3's prompt on `fix-none`. Load 5.0; 8 s. The primer had no group sentence; the regression deny and re-issue were as in s3a; Stop's three entries said nothing in 0.01 s; `flow.test.ts`, an ordinary test file here, started at 3.96 s and was still running when the session ended at 7.5 s. Today's behaviour, as 019 Goal 2 asks.

### Probes

**P3 with news (`bin/p3probe.mjs`).** No model. Per trial, a new store on `fix-h2`, the pinned 0.1.400 Claude Code hooks driven as `claude -p` drives them (SessionStart, UserPromptSubmit, PreToolUse and PostToolBatch per edit): the source edit fails the unit test and a boundary tells it; the test fix passes and is not told yet; then `stop.mjs` and `stop-slow.mjs` start with the same Stop input. Load 9.3 to 17.8.

| Start order | Trials | The 2 s entry held at once, no wait | Its time when it held | Its time when it gave the news only |
| --- | --- | --- | --- | --- |
| Both at once | 10 | 5 | 648 to 743 ms | 158 to 185 ms |
| The 2 s entry 150 ms first (019-30's test order) | 4 | 4 | 635 to 660 ms | none |
| The waiting entry 150 ms first | 4 | 1 | 824 ms | 309 to 337 ms |

When the 2 s entry held, the waiting entry ended after 3.68 to 3.77 s in 4 of 5 trials, against 3.14 to 3.16 s when the 2 s entry gave news: about the 500 ms it could not write. The cause, read from the code and agreeing with these times: the 2 s entry prepares its news first (`newsText`), whose writes stay in a transaction open until the hook hands the text over (`PreparedReports`, row 011-288), and only then decides and polls for the waiting entry's record (`waitingEntryRecorded`, row 019-30). The waiting entry writes that record first thing (`recordStopWait`), and cannot while that transaction is open. 019-30's test passes because its first Stop has no news (`expect(out.quick).toEqual({})`).

**A tracked symlink in a test's inputs (`bin/symlink.sh`).** To test one guess for P11: cezarion's `CLAUDE.md` is a symlink to `AGENTS.md` and an input of `.github/scripts/ci.workflow.test.cjs`. In the fixture, `README.md` as a symlink (blob mode 120000) or a regular copy, named in `inputs` of `test/math.test.ts`, then a commit of `src/strings.ts`: `link: Commit ad82a85: 0 known failures; lint 0 findings` and `file: Commit 4eaa1ee: 0 known failures; lint 0 findings`. A symlink is not the cause.

**When the update comes (`bin/update.sh`).** No model, no hook. A commit of a new `src/extra.ts` with an unused variable, which no test reads. The report appeared at 30.3 s (the daemon's own pass: no boundary asked for one), lint ended by 31.0 s (`Lint: 1 file with findings`), and the update `Commit 0455d65: 0 known failures; lint 1 finding` came at 60.5 s, at the next 30 s pass. In s1f and s2 it came when the e2e run's record landed, 17 and 18 s after the commit. `updateCommitReport` runs after a pass that does not move `HEAD` and after a test tier's record, not after lint's (P9).

### Memory

| Daemon | RSS (MB) | Heap used (MB) | Notes |
| --- | --- | --- | --- |
| Fixture, each session (unit and e2e lanes, new store) | 223 to 258 | 26.5 to 30.0 | Start to end of a session: −12.6 to +2.3 MB RSS, +1.0 to +3.5 MB heap. Round 1: 150 to 276 MB, 26.4 to 32.4 MB |
| cezarion (s1c, s4; new store, baseline queued) | 1,107 to 1,790, peak 2,072 | 323 to 326 | Round 1: 994 to 2,231 MB RSS |

### Other observations

- **Claude Code runs three Stop entries**: the 2 s `stop.mjs`, the waiting `stop-slow.mjs` and the async `waiter.mjs`. The third ended within 0.1 s in every Stop.
- **The regression deny still blocks the fix** (s3a, s3b, s6): the PreToolUse after the source edit denied the test edit; the agents re-issued it. Agents that sent both edits in one batch got no deny (s3c, s3b2 to s3b4, s5, s5b). Not 019 (001 D9).
- **The edit's own unit files are not Stop's** (s4): Stop waits for the e2e group, but the 958-file closure of the agent's edit ran in an order that put its one failing file after the session. Round 1's c1 got that failure through the hold only because it ran within the 120 s. P5's option (b) (Stop's request runs the predecessors' pending files of the current revision first) would have run it.
- **cezarion's unit tests write into the clone**: during s1c a test wrote `notes.md` ("mock notes — 2026-11-04T05:51:38.606Z: next") at the clone's root, a path its `.gitignore` names, and Squeal stopped two processes `test-env-launcher.test.ts` left running. Both are cezarion's; neither changed a commit line here.
- **In Round 2 no gh-134 file appeared** at the clone's root (`git status --ignored` listed only `notes.md`).

### Proposed rows

Numbers are for the coordinator to assign; P8 to P11 continue Round 1's P1 to P7. None is fixed here. Reproductions name the sessions (`node tasks/019-33/bin/session.mjs <id>`) and the probes in `tasks/019-33/bin/`.

| Row | Problem, with the evidence | Done when |
| --- | --- | --- |
| P8 Stop does not tell a commit line or its update that no boundary told | 019-29 chose P2's option (a); its notes name option (b) for what (a) leaves. s1c: the commit's boundary waited 715 ms and gave nothing, the agent's next hook was Stop, and the hold 120 s later carried status but not the commit line or its lint finding. s1f and s2: the update (`lint 1 finding`) was stored after the turn and never told; s1f's agent told the user "lint had no findings". Proposal, P2's option (b): a Stop with an untold commit line or untold update tells it once, with a hold when there is one, else as news (which continues the turn once). With P9 the update of s1f would exist at its first Stop | A real-daemon test: a commit as the last tool call, its boundary past the 500 ms bound, then Stop: the line comes once at that Stop and not at the next; the same for an update stored after the commit's boundary |
| P9 the commit line's update waits for an unrelated pass | `updateCommitReport` (`src/core/scheduler/head-move.ts`) runs after passes that do not move `HEAD` and after test tiers' records, not when lint records. `update.sh`: lint ended by 31.0 s, the update came at 60.5 s (the next 30 s pass). s1f, s2: it came with the e2e run's record, 17 and 18 s after the commit, after the turn. Proposal: also run it after a lint pass records | A scheduler test: a commit whose only commit work is lint: the update is stored when lint's record lands, with no test tier and no interval pass between |
| P10 the first Stop's 2 s entry with news holds without a wait | P3 stays when the first Stop has news: the 2 s entry's prepared news keeps a write transaction open while it polls for the waiting entry's record, which that entry cannot write until the transaction ends. s3b (Claude Code, `maxHolds` 2): the first hold came after 0.50 s with no wait, and the agent's fix went unchecked. `p3probe.mjs`: 5 of 10 such first Stops with both entries at once, 4 of 4 with the 2 s entry 150 ms first, 1 of 4 with the waiting entry first. Proposal: the 2 s entry waits for the record before it prepares its news, or polls without the open transaction | 019-30's harness test (`test/harness/stop-first-last.test.ts`, the 2 s entry first) with an untold result at the first Stop, on Claude Code and Codex: the waiting entry decides, one hold; `p3probe.mjs 4 150` gives no hold from the 2 s entry |
| P11 a commit on a clean tree reads a test file "not determined (unstaged changes)", and nothing names it | s1c (cezarion, `git status` clean): `Commit 172965e: 0 known failures; lint 1 finding; 1 test file not determined (unstaged changes)`. Round 1's c3 had the same count, put then on gh-134's stray file, which was absent here. "Unstaged" means a committed path whose cached hash differs from its blob (`differingPaths`); neither the report, `status --full` nor `--json` names the file or the path. Not a symlink (`symlink.sh`). Proposal: `status --full` lists the commit line's not-determined files with the paths that make them so; then find the cause from s1c | s1c's case names its file and path; the cause is fixed, or the line says why the file is not determined |

### Cleanup

At 05:59:57Z `squeal stop` stopped cezarion's daemon and found none in the fixture; `mem.mjs` found no daemon of either clone; `ps -u squeal-e2e` listed no process. s6 started one more fixture daemon, which exited by itself after its session; at 06:04:48Z `squeal stop` found no daemon in either clone, `mem.mjs` none, and `ps -u squeal-e2e` no process. The probes stop their daemon at their end. The e2e group never started in cezarion, so no test server of its browser e2e ran. The clones stay in the case root as evidence.

### For the next worker

- A first Stop with news and a first Stop without it are different cases for P3: s3b had news (the regression deny made the agent's test edit a separate boundary, so its pass was untold at Stop), s3b2 to s3b4 had none.
- Fixture sessions take 23 to 56 s; a cezarion session on a new store takes over 2 min, most of it Stop's 120 s bound.
- To learn whether the last-hold line changes what an agent does, the prompt must not tell it that the repository checks the change at Stop. Every Round 2 prompt that reached a last hold did.
