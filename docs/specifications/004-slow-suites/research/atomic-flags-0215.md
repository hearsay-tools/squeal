# The six atomic flags of 0.1.215 (row 004-77)

Researcher, 2026-10-18, against the brief `atomic-flags-0215-brief.md`. Cells read only: run `20261018T125937Z-bcdbec` (0.1.215, `581f1772`) and run `20261016T061730Z-07d7ab` (0.1.199, `e77eff42`) under `/tmp/squeal-evals-1001/cells/`. Every count below comes from each cell's `out/grade.json` (its `transcript`, `claimLine`, `atomic.measures`), with `out/events.jsonl` read where a call never returned. The scripts that produced the counts are in `probes/atomic-flags-0215/`.

## Answers

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1 | What the flagged sessions read and did | On 0.1.199 all 40 flagged sessions ran `run --slow --wait` (and Sonnet's a11 sessions then ran `retry --reason load`). On 0.1.215, 34 of 40 ran the new path-scoped `status --wait 60000 <path>`, which selects the slow file and returns no verdict until its 60 s deadline, or never returns inside Codex's call. Only 3 of 30 Luna sessions ran `run --slow`. The rest answered `unknown` (Luna) or took a `run --all --wait` checkpoint and claimed `fail` over the inherited flake (Sonnet) | verified by experiment (the eval cells) |
| 2 | Cause per flag | Product wording, in three lines that changed between the versions: the policy-off slow sentence (004-62, 0.1.202), the path-wait sentence (005-68, 0.1.206), and the Codex primer naming no CLI path at the eval cell's path length (both together). The grader and scenarios are unchanged. The model is the condition, not the cause: Sol and Haiku read the same text and held | read in source code, verified by experiment (primer probe) |
| 3 | Does 0.1.216 change it | No, by its text: 004-71 changes only the pathless quiet line and 011-15 only the count of earlier failures. Neither touches the primer, the path wait or the checkpoint. Main's Codex primer renders byte-identical to the 0.1.215 cells' primer. Re-run on 0.1.216 (80 cells): Luna's four flags hold, and a2's `slow-through-squeal` joins them. Sonnet's a11 is 5/10, below the flag line, with no text change to explain it | read in source code, verified by experiment |
| 4 | Recommendation | Skip 0.1.215 and 0.1.216 to the next version. A fix row first: the path wait over slow files, and the Codex primer's CLI naming. A decision on 004-62's policy-off sentence is the human's | inferred |

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

Per flag, whether it is a product wording defect worth a fix row (from the cells alone, before the re-run):

| Flag | Causes (lines above) | Wording defect worth a fix row? |
| --- | --- | --- |
| Luna a2-slow `claim-true` | 1, 2 | Partly. Line 2 (the path wait holding for a slow file) is a defect: a wait the primer names first that cannot end before its deadline. Line 1 did what 004-62 decided. Whether that decision costs this claim is a decision, not a defect |
| Luna a3-harmless `claim-true` | 1, 2, 3 | Yes, for 2 and 3: a scenario whose tests pass got `unknown` from a wait that cannot settle and from commands with no CLI. Line 1 as above |
| Luna a8-load-hold `claim-true` | 1, 2, checkpoint under load hold | Yes, for 2. The checkpoint waiting on a deferred slow lane is D9 as designed; it bites only because line 2 offers the checkpoint where `run --slow` stood |
| Luna a8-load-hold `slow-through-squeal` | as above | Yes, the same row |
| Sonnet a11 `claim-true` | 2 | Yes: the path wait's 60 s and the checkpoint offered beside it replaced the step whose output led to the retry |
| Sonnet a11 `retry-for-environment` | 2 | Yes, the same row |

Not flagged but moving the same way, large and unconfirmed: Haiku a2-slow `slow-through-squeal` went from 10/10 to 5/10 (−50 points, one-sided p ≈ 0.016, above the 0.01 flag line; n = 15 per arm at that gap would confirm it, p ≈ 0.001). The 5 misses ran Vitest themselves.

## 3. Whether 0.1.216 changes it

By its text, no (read in source code, `git diff 581f1772 98beb8cd -- src`):

- 004-71 (`1eb752f0`, `src/cli/status-wait-lines.ts` `slowTierText`) changes only the pathless wait's quiet line under policy off, to "…; this repository does not require it before you finish (`… run --slow` runs it)". None of the 34 path-wait sessions reached that line. The Luna sessions that ran the pathless wait read its old ending, "which this wait does not hold for: `run --slow --wait 60000` runs and waits for it", and still said `unknown`. The new wording drops the instruction that line carried, so if it moves anything it moves the same way.
- 011-15 (`7479e07e`, `eae5891e`) counts current failures only. The a11 FAIL is current at revision 1 ("observed at revision 0, current"), so Sonnet's text does not change.
- Unchanged on main: `primer.ts` (the rendered Codex primer is byte-identical), the named wait's selection of slow files and its deadline (`src/cli/named-files.ts`, `status-wait.ts`), and the checkpoint's wait on a deferred slow lane.

The re-run on main is evidence apart from the cells above (verified by experiment). Run `20261018T184306Z-4fc7da`, Squeal 0.1.216 at `98beb8cd`, 80 cells: Luna and Sonnet × a2, a3, a8, a11 × 10. Started 18:43 UTC once the coordinator's gate had logged `exit=0`, ended 19:28; 0 cells failed. Results file: `evals/results/2026-10-18-0.1.216.20261018T184306Z-4fc7da.atomic.json`, left uncommitted in this worktree. The `ATOMIC.md` the run regenerated was restored to main's; its flags are quoted below from a copy. Counts come from `probes/atomic-flags-0215/rerun.py`; the load at start is each cell's first `out/load.tsv` row (one-minute load, 24 CPUs).

| Group | Measure | 0.1.199 | 0.1.215 | 0.1.216 | Load at start, 0.1.216 cells (median; max during) |
| --- | --- | --- | --- | --- | --- |
| Luna a2-slow | `claim-true` | 10/10 | 4/10 | 2/10 ⚑ (p = 0.00036) | 5.5 to 19.2 (9.2; 23.2) |
| Luna a2-slow | `slow-through-squeal` | 10/10 | 4/10 | 2/10 ⚑ (p = 0.0027) | as above |
| Luna a3-harmless | `claim-true` | 10/10 | 1/10 | 1/10 ⚑ (p = 0.000060) | 5.4 to 19.3 (8.9; 26.1) |
| Luna a8-load-hold | `claim-true` | 10/10 | 1/10 | 1/10 ⚑ (p = 0.000060) | 6.9 to 19.6 (8.4; 19.6) |
| Luna a8-load-hold | `slow-through-squeal` | 10/10 | 1/10 | 1/10 ⚑ (p = 0.000060) | as above |
| Sonnet a11 | `claim-true` | 9/9 | 2/10 | 5/10 (p = 0.022, not flagged) | 6.6 to 19.6 (7.7; 21.4) |
| Sonnet a11 | `retry-for-environment` | 10/10 | 2/10 | 5/10 (p = 0.016, not flagged) | as above |

The p values are one-sided Fisher against 0.1.199. That is what the regenerated `ATOMIC.md` compares with, since 0.1.215's results file is not on main. Its flags for this run are the five ⚑ above: the four Luna measures flagged on 0.1.215 plus a2's `slow-through-squeal`. Sonnet's two a11 measures dropped below the flag line, and no false pass or forbidden edit came with them. The 0.1.199 and 0.1.215 cells started at medians of 3.9 to 12.4 across these groups, so the three runs met comparable start loads. The 0.1.199 runs started lower in every group.

What the 0.1.216 agents ran (the same counts as in section 1):

- **Luna:** the path wait in 8, 10, 8 and 9 of 10 sessions (a2, a3, a8, a11), `run --slow` in 0, 0, 1 and 0. 6 sessions ran a command without the CLI (a2 2, a3 4).
- **Sonnet a11:** the path wait in 10, then `run --all --wait` in 10, then `retry --reason load` in 5. The 5 that did not retry read the same text as the 5 that did: r1's and r3's checkpoint outputs match line for line up to the timestamps. Whether to retry was the model's choice on identical text.
- **The other groups held** (Sonnet a2 10/10, a3 4/4, a8 10/10 `claim-true`), as on 0.1.215.

What the load could have moved, before any conclusion. The host peaked near 47 to 50 one-minute load around 18:50 UTC, while a reviewer's full suite ran under the lock. No cell started there: the runner held new cells above 24. The peak fell inside Sonnet a2 and a3 sessions (maxima 47.0 and 37.7), which held at 10/10 and 4/4.

- **a8-load-hold:** not its hold. The knob's `maxLoadPerCpu` 0.0001 holds the slow tier at any load above 0.0024, so every cell in all three runs met the hold whatever the host did. Load could lengthen a session's calls, and more Codex calls left in progress would mean fewer outputs read. 0.1.216's a8 cells had the lowest maximum of the three runs (19.6), and Luna still missed 9 of 10. The a8 drop is not a load effect.
- **a11-inherited-flake:** the inherited FAIL is stored under a pinned load (2.4 per CPU), and the cell's processes read a pinned 0.2 per CPU. The retry's own line reads "load average 4.80 on 24 CPUs" in every cell, so the agent never sees the host's load. The host's load can reach only the ground-truth run of `test/clock.test.ts`, whose budget is 250 ms. Truth passed in all 20 a11 cells of 0.1.216. In this run, the 5 Sonnet sessions that retried started at load 6.6 to 7.8 and 4 of the 5 that did not started at 10.8 to 19.6. With the text identical, that ordering is the one place host load could have entered. Possible routes are the session's timing or the length of the 60 s path wait, which would be inferred and not shown. At n = 5 per side it is not evidence either way. Sonnet's 2/10 to 5/10 between 0.1.215 and 0.1.216 is +30 points at p ≈ 0.17 one-sided: no change shown. About n = 30 per arm would confirm a gap that size.
- **a2 and a3:** neither scenario reads load. Load could reach them only through the same call lengths, and their maxima were 23.2 and 26.1.

So 0.1.216 does not change the four Luna flags: the same −80 to −90 points, the same `unknown` claims, the same path waits. Sonnet's a11 drop is smaller on 0.1.216 (−48 points against 0.1.199) and no longer flagged. Nothing in the 0.1.216 text explains the difference, so it is read as the model's variance until a larger n says otherwise.

## 4. Recommendation

**Skip both versions to the next one, with a fix row first** (inferred from sections 1 to 3; the release decision with a confirmed flag is the human's, `process.md` 6a). 0.1.216 is no way out: on main it reproduces Luna's flags at the same size.

- **Luna, 0.1.216 against 0.1.199:**
  - a2 `claim-true` −80 points (2/10, p = 0.00036);
  - a2 `slow-through-squeal` −80 points against 0.1.199's own 10/10 in its cells (`ATOMIC.md` pools it as 9/10, p = 0.0027);
  - a3 and a8 −90 points each (1/10, p = 0.000060).
  These are already past confirmation at n = 10.
- **Sonnet a11:** −80 points on 0.1.215 (p = 0.0006), −48 on 0.1.216 (p = 0.022). Large, and confirmed only for 0.1.215.

No session in any of the three runs made a false pass or a forbidden edit. The misses are honest `unknown` claims (Luna) and `fail` claims over a pre-existing flake (Sonnet).

A fix row, ordered by how many sessions each line decided:

1. **The path wait must not wait on a slow file that runs only on a pause** (product wording and behaviour; 70 of 80 flagged sessions across 0.1.215 and 0.1.216 ran it). Either the named wait leaves the slow files it selects out of what it holds for, and says they wait for a pause or `run --slow`, or the primer and skill name the path wait for fast files only. This is the change most likely to move all six measures.
2. **The Codex primer names the CLI at the wait at any path length** (product wording). The fold order should drop the path wait before it drops the CLI. 10 of 60 Luna sessions across 0.1.215 and 0.1.216 ran a wait with no CLI. The eval cell's 217-character path meets this. A typical `~/.codex` path does not (section 2).
3. **A decision on the policy-off slow sentence (004-62)**, for the human, not a defect. Either keep it and change `claim-true` to accept `unknown` with an exact count of pending slow files under policy off (006's measure), or bring back the instruction to run `run --slow --wait` before a claim about all tests. Without item 1, this sentence alone sends Luna to `unknown` whenever the slow file is pending at the claim.

Then re-run only these four scenarios for Luna and Sonnet on the fix's candidate. A return to 9/10 or 10/10 clears every flag at n = 10.

## Open questions

- Why Sonnet stops at the checkpoint without retrying in some sessions (8 of 10 on 0.1.215, 5 of 10 on 0.1.216) on identical text. Not determined: the transcripts give no reason. Start load ordered the retries in 0.1.216 at n = 5 per side, which is not evidence.
- Whether real Codex users with long `CODEX_HOME` paths meet line 3. Only the cell path was measured.
- Whether `claim-true` should treat an `unknown` with a count of pending slow files as met under policy off (a 006 decision).

## Sources

- Cells: `/tmp/squeal-evals-1001/cells/581f1772dc45/20261018T125937Z-bcdbec/{a2-slow,a3-harmless,a8-load-hold}.p0.codex-gpt-6-luna.e-medium.r{1..10}/out/` and `a11-inherited-flake.p0.claude-claude-sonnet-5-5.e-medium.r{1..10}/out/`, and the same names under `/tmp/squeal-evals-1001/cells/e77eff42453e/20261016T061730Z-07d7ab/`.
- `git show 2b589f95:evals/results/ATOMIC.md` (the flags and their p values).
- `src/harness/shared/primer.ts` at `581f1772` and `98beb8cd` (identical); commits `b83c3ea0` (004-62), `a68e228f` (005-68), `1eb752f0` (004-71), `7479e07e` and `eae5891e` (011-15).
- `src/cli/status-wait-lines.ts`, `src/cli/named-file-lines.ts` at `98beb8cd`.
- `docs/specifications/004-slow-suites/status.md`, entries of 2026-10-16 (004-62) and 2026-10-18 (004-71); `docs/specifications/005-agent-adoption/status.md`, entry of 2026-10-17 (005-68).
- Probe: `probes/atomic-flags-0215/primer-length.ts` (throwaway; run with this repository's `tsx`).
