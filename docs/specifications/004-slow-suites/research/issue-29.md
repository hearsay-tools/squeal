# Issue 29: requireSlowSuite=false and the injected completion guidance

Brief: reproduce https://github.com/hearsay-tools/squeal/issues/29 (read 2026-10-17 with `gh issue view 29`: open, label `friction`, no comments) in at most 20 minutes, documentation only. Examined at main `6ea14815` (Squeal 0.1.208, Node 24.21.0) and at the installed plugin `~/.claude/plugins/cache/hearsay/squeal/0.1.199` (`squeal --version`: 0.1.199). Host: 24 CPUs. One-minute load 7.92 before the first probe and 15.70 before the recorded run, both below the CPU count, so the live probe went ahead. Nothing in product code, tests, spec, status, skills or board was changed.

## Verdict

The symptom is real on 0.1.199 and fixed on main since 0.1.202 (004-62, issue #5). Issue 29 is the same defect as #5, reported in another session: a docs-only edit plus the 0.1.199 primer and skill step 4 tell the agent to run `run --slow --wait` before it finishes, whatever the policy is. On 0.1.208, with `requireSlowSuite: false`, the primer says the slow tier is not required. Affected-input slow checks are a separate path from `run --slow` in source, and that path stays as it was. Recommendation: close #29 as a duplicate of #5, fixed in 0.1.202. The reporter's host has to move off 0.1.199 for the fix to reach it. One residual, inferred: main's primer now offers `run --all --wait` as a before-finish option, and that run includes the slow tier (finding 4).

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does 0.1.199 inject an unconditional slow-run instruction under the reporter's policy? | Yes. The primer reads "before you say the task is done, run `squeal run --slow --wait 60000` unless the latest `Slow tier:` line states every slow file is current". | verified by experiment (0.1.199 bundle) |
| 2 | Does main differ? | Yes. The primer reads "this repository does not require them before you finish: say slow tests pass only when … every slow file is current, else say how many are not". | verified by experiment (0.1.208 bundle) |
| 3 | Do the skill and `commands.md` agree with the primer? | 0.1.199: no. Step 4 says "while the last one says any slow file is not current, run `squeal run --slow --wait 60000`", and `commands.md` calls `run --slow` "the skill's step 4 before saying the task is done". Main: yes. Both read the policy off the `Slow tier:` line ending. | read in source code (both trees) |
| 4 | Are affected-input slow checks distinct from forced whole-tier coverage? | Yes. An edit re-keys only the test files whose closure or declared inputs hold a changed path, slow ones included. `run --slow` queues every slow file that is not current. | read in source code (`6ea14815`) |
| 5 | Is it a duplicate of #5, and how does it relate to #19? | Duplicate of #5 (closed 2026-10-16, COMPLETED, by 004-62). #19 is the policy-on, no-edit case (004-67, done in 0.1.207, issue still open). | read in source code (board, status), `gh issue view` |
| 6 | Did the 87-file incident reproduce? | Not recreated (out of scope). Only the guidance that led to it was reproduced. | not determined, because no cezarion session was run |

## Findings

### 1–2. Primer, 0.1.199 against main (verified by experiment)

`probes/issue-29/probe.sh` runs each plugin's `squeal start` and then its Claude Code `session-start.mjs` in a temp repository with the reporter's three policy keys, an isolated HOME and an isolated `XDG_RUNTIME_DIR`. It queues no test. Command, from `probes/issue-29/`:

    ./probe.sh ~/.claude/plugins/cache/hearsay/squeal/0.1.199 "$(cd ../../../../../../plugins/claude-code && pwd)"

The full output is in `probes/issue-29/output.txt`. The slow sentence from each run:

- 0.1.199: "Slow test files run when you pause between turns; before you say the task is done, run `squeal run --slow --wait 60000` unless the latest `Slow tier:` line states every slow file is current: it runs the rest and waits for them."
- 0.1.208 (main's committed `plugins/claude-code/dist`): "Slow test files run when you pause between turns; this repository does not require them before you finish: say slow tests pass only when the latest `Slow tier:` line states every slow file is current, else say how many are not; `squeal run --slow --wait 60000` runs them now."

Under 0.1.199, an agent in the issue's state (affected files quiet, 87 slow files not current) is told to run all 87. Under main it is told to report how many are not current. The first attempt printed nothing, because the 2 s hook found no daemon. The probe now runs `squeal start` first. Daemons from that attempt exited on their own, and none from the probe remained (`pgrep -af issue29-`).

### 3. Skill and commands (read in source code)

0.1.199 `skills/squeal/SKILL.md:15` (step 4) and `references/commands.md:78` are unconditional, as quoted in the table. Main's `plugins/claude-code/skills/squeal/SKILL.md:15` reads: "If the last one says `Stop waits`, they are required once you edit … Without `Stop waits`, say how many are not current". Its `commands.md:78` reads: "Whether it is needed before saying the task is done is the repository's policy, read off the end of the `Slow tier:` line". This matches 004 D8 as amended for 004-62 (`status.md` 2026-10-16).

### 4. Affected-input checks against whole-tier coverage (read in source code, `6ea14815`)

- Edit path: `rekeyContent` (`src/core/scheduler/revision.ts:36-55`) settles only `touched`. That covers the test files that `keys.index.rekey(changes)` re-keys (closure references), files with changed declared inputs, and every file of a project whose environment input changed. `Ledger.settle` (`ledger.ts:173`) queues the misses and marks them recent when `changed` reaches their closure (`recentOf`, `ledger.ts:274`). A slow file reached this way is pending and runs on D2's idle trigger. A docs row that no slow closure or declared input names re-keys no slow file.
- Forced path: `queueSlowSuite` (`src/core/scheduler/slow-tier.ts:647-664`) takes every slow file with a key, not blocked and not `current`. That includes the ones `lookup-only` left unrun at bootstrap (`bootstrap.ts:176`, abandoned baseline). In the issue, those are the 87.
- So the issue's acceptance criterion 2 ("affected slow checks still validate when the edited inputs reach them") holds without the forced path. The 0.1.199 guidance is what turned an affected-only revision into a whole-tier run.

Residual (inferred): main's primer also says "before you finish, `squeal status --wait 60000` or a checkpoint, `squeal run --all --wait`" (`src/harness/shared/primer.ts:114`, from 005-68 `a68e228f`, gh-18). It is an alternative, and `status --wait` is listed first. But 004 D8 says the full-suite checkpoint includes the slow files, and this sentence does not read `stop.requireFullSuite`. An agent that picks the checkpoint in the reporter's repository would queue the slow tier again. The probe did not measure whether agents pick it.

### 5. Duplicates (read in source code; `gh issue view 5`, `gh issue view 19`)

- #5 ("Honor optional slow-suite policy in Codex guidance"): CLOSED 2026-10-16T21:06:45Z, COMPLETED. Board row 004-62 is done in 0.1.202 (re-review 004-64 PASS). `research/issue-5.md` reproduced the same primer sentence at 0.1.200. #29 is that defect in a docs-only session, and its "Expected fix" and acceptance criteria 1 and 3 restate 004-62's done-when.
- #19 (read-only reviews): OPEN. Board row 004-67 is done in 0.1.207 and covers the policy-on, no-edit case. The row says "The policy-off case reported on 0.1.199 was fixed by 004-62 in 0.1.202". #29 edits a file and is policy-off, so 004-62 covers it, not 004-67. #19 being open while its row is done is for the coordinator to settle.

## Limits

- Claude Code primer only, live. The Codex, Pi and OpenCode primers share `slowSentences` (`research/issue-5.md` 1), but they were not re-run here.
- The 87-file cezarion incident, the six affected files and the store state were not recreated. Agent behaviour under the new primer was not measured (that is 006's `a2-slow`).
- The probe's repository listed no slow files ("no slow test files listed yet"). The slow sentence depends only on `slow.include` being set (`coverageOf`, `src/harness/shared/coverage.ts:58-83`), so the count does not change it.

## Open questions

1. Should the `run --all --wait` before-finish option read `stop.requireFullSuite`, or name its slow-tier cost? That is 005's wording and 001's facts, and it is not decided here.
2. Should #19 be closed against 004-67 (0.1.207)? That is the coordinator's call.

## Sources

- Issues: https://github.com/hearsay-tools/squeal/issues/29, /5, /19
- Probe: `research/probes/issue-29/probe.sh`, `README.md`, `output.txt`
- 0.1.199: `~/.claude/plugins/cache/hearsay/squeal/0.1.199/dist/session-start.mjs`, `skills/squeal/SKILL.md:15`, `skills/squeal/references/commands.md:78`
- main `6ea14815`: `src/harness/shared/primer.ts:114` and `slowSentences`, `src/harness/shared/coverage.ts`, `src/core/scheduler/{revision.ts,ledger.ts,slow-tier.ts,bootstrap.ts,scheduler.ts:364}`, `plugins/claude-code/skills/squeal/SKILL.md`, `references/commands.md`
- `docs/specifications/004-slow-suites/spec.md` D7–D9, `status.md` (2026-10-16 004-62, 2026-10-17 004-67), `research/issue-5.md`; `docs/board.md` rows 004-62, 004-63, 004-67
