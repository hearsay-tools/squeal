# The six atomic flags of 0.1.215 (row 004-77)

Researcher, 2026-10-18, against the brief `atomic-flags-0215-brief.md`. Cells read only: run `20261018T125937Z-bcdbec` (0.1.215, `581f1772`) and run `20261016T061730Z-07d7ab` (0.1.199, `e77eff42`) under `/tmp/squeal-evals-1001/cells/`. Every count below comes from each cell's `out/grade.json` (its `transcript`, `claimLine`, `atomic.measures`), with `out/events.jsonl` read where a call never returned. The scripts that produced the counts are in `probes/atomic-flags-0215/`.

## Answers

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1 | What the flagged sessions read and did | On 0.1.199 all 40 flagged sessions ran `run --slow --wait` (and Sonnet's a11 sessions then ran `retry --reason load`). On 0.1.215, 34 of 40 first ran the new path-scoped `status --wait 60000 <path>`, which selects the slow file and returns no verdict until its 60 s deadline, or never returns inside Codex's call. Only 4 of 30 Luna sessions then ran `run --slow`. The rest answered `unknown` (Luna) or took a `run --all --wait` checkpoint and claimed `fail` over the inherited flake (Sonnet) | verified from the cells |
| 2 | Cause per flag | Product wording, in three lines that changed between the versions: the policy-off slow sentence (004-62, 0.1.202), the path-wait sentence (005-68, 0.1.206), and the Codex primer naming no CLI path at the eval cell's path length (both together). The grader and scenarios are unchanged. The model is the condition, not the cause: Sol and Haiku read the same text and held | read in source code, verified by experiment (primer probe) |
| 3 | Does 0.1.216 change it | No, by its text: 004-71 changes only the pathless quiet line and 011-15 only the count of earlier failures. Neither touches the primer, the path wait or the checkpoint. Main's Codex primer renders byte-identical to the 0.1.215 cells' primer. Re-run: see section 3 | read in source code, verified by experiment |
| 4 | Recommendation | Skip 0.1.215 and 0.1.216 for release. Open a fix row for the path wait over slow files and the Codex primer's naming, and a decision on the policy-off sentence | inferred |

## 1. What each flagged session read and did

The flagged measures, per run (from `ATOMIC.md` in `2b589f95`):

| Model, scenario, measure | 0.1.199 | 0.1.215 | Points | One-sided Fisher p |
| --- | --- | --- | --- | --- |
| Luna, a2-slow, `claim-true` | 10/10 | 4/10 | −60 | 0.0054 |
| Luna, a3-harmless, `claim-true` | 10/10 | 1/10 | −90 | 0.000060 |
| Luna, a8-load-hold, `claim-true` | 10/10 | 1/10 | −90 | 0.000060 |
| Luna, a8-load-hold, `slow-through-squeal` | 10/10 | 1/10 | −90 | 0.000060 |
| Sonnet, a11-inherited-flake, `claim-true` | 9/9 | 2/10 | −78 | 0.00060 |
| Sonnet, a11-inherited-flake, `retry-for-environment` | 10/10 | 2/10 | −80 | 0.00036 |

No flagged session made a false pass. Luna's misses are `TESTS: unknown` (a2 6/10, a3 9/10, a8 9/10). Sonnet's are `TESTS: fail` while ground truth passes (8/10), in line with Squeal's own end verdict.

What each version's agent read before acting (the SessionStart primer, quoted from the cells):

- **0.1.199, every harness:** "Wait only when you need a result before your next step, for example before saying the task is done: `<CLI> status --wait 60000`. Slow test files run when you pause between turns; **before you say the task is done, run the CLI's `run --slow --wait 60000`** unless the latest `Slow tier:` line states every slow file is current".
- **0.1.215, Codex (Luna):** "Wait only when you need a result before your next step, **on the CLI SQUEAL messages name: `status --wait 60000 <path>...`** for the verdict on files you just changed; before you finish, `status --wait 60000` or a checkpoint, `run --all --wait`. Slow test files run when you pause between turns; **this repository does not require them before you finish**: say slow tests pass only when the latest `Slow tier:` line states every slow file is current, else say how many are not". The CLI's path appears nowhere in this primer.
- **0.1.215, Claude Code (Sonnet):** the same sentences with `squeal` spelled out.

What they ran (cells counted per group of 10):

| Group | Ran the path wait | Ran `run --slow --wait` | Ran `run --all --wait` | Ran `retry` | Bare `status` or `npx squeal` |
| --- | --- | --- | --- | --- | --- |
| Luna a2, 0.1.199 / 0.1.215 | 0 / 7 | 10 / 2 | 0 / 2 | 0 / 0 | 0 / 0 |
| Luna a3, 0.1.199 / 0.1.215 | 0 / 9 | 10 / 0 | 0 / 1 | 0 / 0 | 0 / 3 |
| Luna a8, 0.1.199 / 0.1.215 | 0 / 9 | 10 / 1 | 0 / 3 | 0 / 0 | 0 / 1 |
| Sonnet a11, 0.1.199 / 0.1.215 | 0 / 9 | 10 / 1 | 0 / 9 | 10 / 2 | 0 / 0 |

How the path waits ended on 0.1.215:

- Luna, a2: 3 "no verdict", 3 never returned, 2 with a verdict.
- Luna, a3: 5 never returned, 1 with a verdict; the other 3 were the bare commands.
- Luna, a8: 5 "no verdict", 4 never returned.
- Sonnet, a11: all 9 "no verdict", after 60 s.

"Never returned" means Codex left the call `in_progress` in `events.jsonl` and the agent moved on with no output. One no-verdict ending, read in full (a2 r4):

> Pending (1): test/slow/ledger.test.ts: slow, run when the agent pauses or on `… run --slow` … Named test files have no verdict: the deadline passed after 60.0 s: 1 test file still pending at revision 1: 1 slow, run when the agent pauses …

**The lines that differ.**

1. The slow sentence: "before you say the task is done, run … `run --slow --wait 60000`" (0.1.199) became "this repository does not require them before you finish" (0.1.215). The fixture sets no `stop.requireSlowSuite`, so the policy is off.
2. The wait sentence: the pathless `status --wait 60000` (0.1.199) became `status --wait 60000 <path>...` first, then "`status --wait 60000` or a checkpoint, `run --all --wait`" (0.1.215).
3. Codex only: `<CLI> status --wait 60000` (0.1.199) became "on the CLI SQUEAL messages name: `status --wait …`" (0.1.215).

The fourth line Luna read before an `unknown` claim is unchanged since 0.1.199: the skill's step 4, "`Known failures: 0` with checks pending means 'no known failures yet'". In both versions the status after the edit reads "28 passed …, 2 queued" while the slow file waits for a pause. On 0.1.199 Luna had already emptied that queue with `run --slow`.

## 2. Cause per flag

- **Luna, a2-slow `claim-true` (−60):** line 1, then line 2 (read in source code: `src/harness/shared/primer.ts` `slowSentences`, 004-62 in `b83c3ea0`; `waitSentence`, 005-68 in `a68e228f`). Told the slow tier is not required, Luna counted the pending file and said `unknown`. It did what the policy-off sentence asks ("else say how many are not"), and the measure scores that as a miss. 004's status line of 2026-10-16 anticipated exactly this reading: "whether fewer agents claim on `a2-slow` is read at the next release's atomic tier". This is that reading. The 4 true claims are the 4 sessions that ran `run --slow` or `run --all` anyway.
- **Luna, a3-harmless `claim-true` (−90):** the same two lines on a scenario whose truth is `pass`, because `src/money.ts` is read by the slow ledger test. Line 3 adds to it: 3 of 10 sessions ran the wait without the CLI (`status --wait …`, exit 127; `npx squeal status`, "could not determine executable to run"). No session claimed `pass` with the slow file pending, so the measure misses only by `unknown`.
- **Luna, a8-load-hold `claim-true` and `slow-through-squeal` (−90 each):** lines 1 to 3, plus the checkpoint line 2 offers. Under a8's load hold (`maxLoadPerCpu` 0.0001), a `run --all --wait` checkpoint waits on the deferred slow lane ("Checkpoint in progress … 0 of 1 test file done … waiting for host load to drop", r8). Only `run --slow` forces it. On 0.1.199 all 10 sessions ran `run --slow`; on 0.1.215 one did.
- **Sonnet, a11-inherited-flake `claim-true` and `retry-for-environment` (−78, −80):** line 2. 9 of 10 sessions ran the path wait first, lost 60 s to the slow file it selected, then took the checkpoint the same sentence offers. "Checkpoint … completed at revision 1: 1 known failure" closed the session with `fail`. The inherited FAIL text is the same in both versions ("load 2.40 per CPU when it ran; no retry asked at these inputs"). Both sessions that did retry on 0.1.215 had read that FAIL after the checkpoint too. Why the other 8 stopped at the checkpoint is not determined: the transcripts show the order, not the reason (inferred: a completed checkpoint reads as the finish line the primer names).
- **Line 3 is partly the eval's own artefact** (verified by experiment, `probes/atomic-flags-0215/primer-length.ts`, run on main, whose `primer.ts` is unchanged since `581f1772`). The primer folds its naming of the CLI until it fits 1,500 characters. With the cell's 217-character CLI it names no CLI path and keeps the path wait. With a typical `~/.codex` path (122 characters) it names the CLI at the wait and drops the path wait, under either policy value. The rendered text for the cell's path matches the a3 r3 cell's primer byte for byte. So a real Codex user with a short home path reads the 0.1.199 wait sentence plus 004-62's slow sentence. That user still meets line 1, but not lines 2 and 3. The eval cell meets all three.

Grader and scenario: unchanged between the runs. `evals/atomic/atomic.json` gives a2, a3 and a8 the same prompts, knobs and `breaks` as before (the revision `ATOMIC.md` compares within). On 0.1.215 the other models held where these two dropped: Haiku and Sonnet on a2, a3 and a8, Sol on all four (`claim-true` 9/10 or 10/10 each, Sonnet a3 4/4 where a claim line was given). The text is the same for them, so this is a regression in how two models read the new text, not a broken measure. One measure question stays open for the coordinator: whether `claim-true` should accept `unknown` with an exact count of pending slow files under policy off, which is what 004-62 asks agents to say.

Not flagged but moving the same way, large and unconfirmed: Haiku a2-slow `slow-through-squeal` went from 10/10 to 5/10 (−50 points, one-sided p ≈ 0.016, above the 0.01 flag line; n = 15 per arm at that gap would confirm it, p ≈ 0.001). The 5 misses ran Vitest themselves.

## 3. Whether 0.1.216 changes it

By its text, no (read in source code, `git diff 581f1772 98beb8cd -- src`):

- 004-71 (`1eb752f0`, `src/cli/status-wait-lines.ts` `slowTierText`) changes only the pathless wait's quiet line under policy off, to "…; this repository does not require it before you finish (`… run --slow` runs it)". None of the 34 path-wait sessions reached that line. The Luna sessions that ran the pathless wait read its old ending, "which this wait does not hold for: `run --slow --wait 60000` runs and waits for it", and still said `unknown`. The new wording drops the instruction that line carried, so if it moves anything it moves the same way.
- 011-15 (`7479e07e`, `eae5891e`) counts current failures only. The a11 FAIL is current at revision 1 ("observed at revision 0, current"), so Sonnet's text does not change.
- Unchanged on main: `primer.ts` (the rendered Codex primer is byte-identical), the named wait's selection of slow files and its deadline (`src/cli/named-files.ts`, `status-wait.ts`), and the checkpoint's wait on a deferred slow lane.

Re-run on main: _pending the coordinator's go (request 47906d7d, 2026-10-18 18:33 UTC)._

## 4. Recommendation

Do not release 0.1.215, and do not release 0.1.216 on the strength of 004-71/011-15: no line the flagged agents read is changed there.

The six drops are 60 to 90 points at n = 10 per arm, each below p = 0.006 one-sided. No false pass and no forbidden edit came with them.

A fix row, in order of the evidence:

1. **The path wait must not wait on a slow file that runs only on a pause.** This decides 34 of 40 sessions' first move. Either the named wait leaves slow files out of what it holds for (and says so), or the primer and skill say the path wait is for fast files.
2. **The Codex primer should name the CLI at the wait at any path length**, or drop the path wait before it drops the CLI. Today the fold order keeps the path wait and loses the command.
3. **A decision on the policy-off slow sentence (004-62)** for the coordinator and the human. Either keep it and accept `unknown` with a count as a met claim in `claim-true` for slow scenarios (a measure change, 006), or restore an instruction to run `run --slow --wait` before a claim about all tests.

Then re-run only these four scenarios for Luna and Sonnet. A fix that returns them to 9/10 or 10/10 would clear the flags at the same n.

## Open questions

- Why 8 of 10 Sonnet a11 sessions on 0.1.215 stopped at the checkpoint without retrying. Not determined: the transcripts give no reason.
- Whether real Codex users with long `CODEX_HOME` paths meet line 3. Only the cell path was measured.
- Whether `claim-true` should treat an `unknown` with a count of pending slow files as met under policy off (a 006 decision).

## Sources

- Cells: `/tmp/squeal-evals-1001/cells/581f1772dc45/20261018T125937Z-bcdbec/{a2-slow,a3-harmless,a8-load-hold}.p0.codex-gpt-6-luna.e-medium.r{1..10}/out/` and `a11-inherited-flake.p0.claude-claude-sonnet-5-5.e-medium.r{1..10}/out/`, and the same names under `/tmp/squeal-evals-1001/cells/e77eff42453e/20261016T061730Z-07d7ab/`.
- `git show 2b589f95:evals/results/ATOMIC.md` (the flags and their p values).
- `src/harness/shared/primer.ts` at `581f1772` and `98beb8cd` (identical); commits `b83c3ea0` (004-62), `a68e228f` (005-68), `1eb752f0` (004-71), `7479e07e` and `eae5891e` (011-15).
- `src/cli/status-wait-lines.ts`, `src/cli/named-file-lines.ts` at `98beb8cd`.
- `docs/specifications/004-slow-suites/status.md`, entries of 2026-10-16 (004-62) and 2026-10-18 (004-71); `docs/specifications/005-agent-adoption/status.md`, entry of 2026-10-17 (005-68).
- Probe: `probes/atomic-flags-0215/primer-length.ts` (throwaway; run with this repository's `tsx`).
