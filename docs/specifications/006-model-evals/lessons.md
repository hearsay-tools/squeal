# 006 Model evals: lessons

## In use at a real release: 0.1.131, 2026-10-12

The proof run for this spec was 0.1.131's release (`docs/process.md` 6a), carried out by the 001 coordinator, with the long baseline finished by 006:
- The atomic tier ran on `9c762e65`: run `20261012T134945Z-3f2edd`, 280 sessions, 0 failed, every model served. Cells were under `/tmp`, at load 1.5 to 81.7.
- The judge was calibrated as part of the run. It failed twice on rubric wording and passed on `4bb132acc949`.
- The long baseline ran at one repetition: run `20261012T191126Z-af5be4`, 16 sessions, judged by Haiku 5.5, at load 0.4 to 2.0.
- The human decided the release on the report: they released over 12 false-pass alarms on `a5-uncovered`.

### Verdict

| Goal | Verdict | Evidence |
| --- | --- | --- |
| 1. One command runs the baseline against a commit | held | `node evals/bin/run-baseline.mjs --commit <sha>` ran the long baseline and the atomic tier (`--atomic`) at a release, from two coordinators' checkouts. `--resume` recovered two runs killed by Cezar restarts (72 of 280, then 18 of 280 graded) without rerunning a graded cell. 006-45 added `--models` and `--tasks`, 006-48 `--atomic --variant`. |
| 2. Every cell graded against ground truth | held | Every cell records Vitest's JSON report and node:test's output after the session (`truth.*`). A claim is true only against those. |
| 3. Expectations, references, committed results, alarms by cell | held, amended | The four judged expectations are graded by a calibrated judge (D9), and the parser is kept as a cross-check. Calibration caught three rubric ambiguities: `fail` claims with checks pending, currency against agreement with the claim, and `unknown` claims under `no-overclaim`. All three are fixed in the rubric and pinned by reference sessions. The long tasks' drop flag was dropped (goal 7 carries the release check), and alarms stay listed by cell. |
| 4. At every release and `/quality` scan, at calm load, never in CI | held | 0.1.131's release ran it; the runner waits below `--max-load` and recorded load per cell. No eval runs in CI or the Vitest suite (`claudeRunner` refuses under Vitest). |
| 5. A variant runs with the same tasks and grader | held | Four long-task variants on 0.1.127 (skill file, skill description, slow step, stop-slow), and since 006-48 atomic variant arms (006-38 below). |
| 6. The fixture covers the situations agents meet | held | T1 to T4 with knobs (flake, stale edit, daemon stopped) and seven atomic scenarios. 005's D8 deny joins when its key exists. |
| 7. A per-model regression is visible at a release | held | At 10 repetitions a drop from 10/10 to 4/10 flags (one-sided Fisher p < 0.01). Two pilot runs on one commit agreed on every measure, and 0.1.131 raised no flag. The alarm path worked: luna's 10/10 false passes on `a5-uncovered` reached the human the same day. |
| 8. Adoption is a scoreboard | held | `ATOMIC.md`'s scoreboard (006-47): sol meets 90% on 22 of 23 measures, Haiku 15 of 19, Sonnet 14 of 19, luna 10 of 17. Shared weak spots: `a5-uncovered` (running the tests Squeal does not cover) and `a3-harmless` (current evidence before claiming). |

## What the suite found about itself

1. **Cells inside the repository read its instructions.**
   - In a Cezar session, `os.tmpdir()` is inside the Squeal checkout. Claude Code loads `CLAUDE.md` from every directory above the working directory, so every Claude cell and judge call read Squeal's own instructions (001's R4).
   - 006-42 moved the root under `/tmp` and refuses one inside a repository.
   - 006-37 measured the effect on the same code. Haiku's `a2-slow` `slow-through-squeal` went from 13/30 to 10/10 (p = 0.0014).
   - Claude cells from before the move are a different condition, marked "old root" in `ATOMIC.md`. Codex cells are unaffected.
2. **The host's file watchers ran out.**
   - An installed Squeal daemon for another project, then this repository's own main checkout descending into `.ai/cezar/worktrees`, exhausted inotify.
   - Cells got ENOSPC, and the 0.1.127 reference run was stopped at about 240 of 280.
   - 001 fixed the watcher (001-299, 001-300); the human held every eval until it landed.
3. **A provider outage looked like a served model.**
   - From about 21:35 to 22:30 on 2026-10-12, Haiku answered every session with "unknown provider".
   - The runner recorded Haiku as served, because Claude Code writes the refusal as assistant text.
   - 006-46 counts such a session as not reaching the model.
4. **The judge's calibration gate is strict.** Each pass requires every verdict, about 430 per calibration, to match in both rounds. Haiku went pass, pass, fail, fail, pass, each failure a single slip. Both failures traced to wording a reader could take two ways, so the gate did its job. A third failure from a plain slip would make it a question for the human.
5. **The long tasks cannot flag a drop.** At one to three sessions per model and task, chance swings reach 56 points. They are an alarm check, and the per-model release check lives in the atomic tier (the human, 2026-10-12, "simplify").

## 006-38: `stop.requireSlowSuite` on 0.1.131

Not yet run: it waits for the eval slot.

## Open questions

- Open question 3 (the Claude allow-list): resolved. `Bash(node:*)` is in the list. The refusals that remain are compound shell commands Claude Code asks about: Haiku in 0 to 3 of 10 atomic sessions per scenario, Sonnet in none. They explain none of Sonnet's misses.
