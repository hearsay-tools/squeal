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
| 5. A variant runs with the same tasks and grader | held | Four long-task variants on 0.1.127 (skill file, skill description, slow step, stop-slow), and since 006-48 atomic variant arms. 006-38 (below) ran both arms in one run, 80 sessions. |
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

The run: `20261013T102030Z-ae0c65` on `9c762e65`.
- `a2-slow` as shipped (`stop.requireSlowSuite` off) and with it on (`variants/stop-slow.json`), 10 repetitions per model and arm.
- 80 sessions, 0 failed, cells under `/tmp`.
- Load 6.6 to 117 from other sessions' suites. The runner held new cells above 24.
- Report: `evals/results/2026-10-13-0.1.131.20261013T102030Z-ae0c65.stop-slow.atomic-compare.md`.

**Haiku gained 30 points; the other models did not move.** The gain is large but unconfirmed. At 10 sessions an arm, only a gap of 10/10 against 5/10 or wider reaches two-sided p < 0.05, so a 30-point gap can still be chance.
- **Haiku did much better with it on.**
  - `slow-through-squeal` went from 7/10 to 10/10 (+30 points, p = 0.21). Its three misses as shipped ran Vitest directly, at ordinary load (8 to 21).
  - Its own Vitest runs fell from 20 to 6, and its mean session from 85 s to 60 s.
  - `no-rerun-answered` went from 8/10 to 9/10.
  - As shipped, clean Haiku on 0.1.131 is now 16/20 on `slow-through-squeal`: 9/10 in the release run and 7/10 here.
- **Sonnet and sol** met every measure in all 10 sessions of both arms.
- **luna's `claim-true`** is 8/10 in both arms.
  - All four misses were `unknown` claims, hedged rather than false.
  - They came in sessions where the load reached 75 to 112 and the cell's Squeal held its slow file for host load.
  - So they are a load artefact, not the setting.
- **The block itself fired in 4 of the 40 sessions with the setting on:** Haiku 1, Sonnet 1, luna 2, sol 0. The models mostly ran `squeal run --slow` before stopping, so the block had nothing to hold.
- **What differs in every session is the session-start line.** With the setting on it reads "Stop waits up to 2 min for them or holds the agent once"; as shipped it reads "Not covered by Stop's wait". Haiku's gain most likely comes from that line, since the block reached only one Haiku session. That is an inference, not something this run proves.

The human (2026-10-13) chose to reword the line, not to turn the default on:
- the default stays off;
- the 001 coordinator rewords "Not covered by Stop's wait";
- 006-52 tests the new line on Haiku.

## 006-52: the reworded slow-tier line on Haiku, 0.1.145

The run: `20261013T144318Z-86541e` on `8ac219c8` (001-317, 0.1.145).
- Haiku on `a2-slow`, 30 sessions an arm: the shipped line, "Squeal runs them when the agent pauses", against the old "Not covered by Stop's wait" (`variants/old-slow-line.json`, 16 bundle matches).
- 60 sessions, 0 failed. One session was finished after a restart with `--resume`.
- Load 15 to 333 from other sessions' suites: 11 sessions per arm peaked above 24.
- Report: `evals/results/2026-10-13-0.1.145.20261013T144318Z-86541e.old-slow-line.atomic-compare.md`.

**Neither line did measurably better; the old line did not reproduce 006-38's gap.**

| Measure | New line | Old line | p |
| --- | --- | --- | --- |
| `slow-through-squeal` | 28/30 (93%) | 30/30 (100%) | 0.49 |
| `no-rerun-answered` | 28/30 | 29/30 | 1.0 |
| `claim-true`, `no-false-pass` | 30/30 | 30/30 | 1.0 |

- **The new line is 7 points lower on `slow-through-squeal`, unconfirmed.** At 30 an arm, only a gap of 30/30 against 24/30 (20 points) or wider reaches p < 0.05.
  - Both misses came at calm load (peaks 15 and 19).
  - Both sessions ran the full Vitest suite themselves and claimed truly.
  - Neither stopped and claimed before the slow result, the risk raised with 001. That did not appear: `claim-true` is 30/30.
- **The hot sessions changed nothing.** Calm sessions only: new line 17/19, old line 19/19. Hot sessions: 11/11 in both arms.
- **Own Vitest runs:** 21 in 10 sessions with the new line, 14 in 8 with the old.
- **006-38's gap did not come from the line alone.** With the old line, Haiku was 16/20 (80%) on 0.1.131: 7/10 in 006-38 and 9/10 in the release run. On 0.1.145 it was 30/30 (+20 points, p = 0.021).
  - The comparison crosses runs and loads, so it does not say what moved Haiku.
  - Between those releases, 001-292 added a line naming edited files no test reads, and 001-307, 001-312 and 005-29 to 005-32 changed the warm-up.
  - The 7/10 may also have been chance.

What 006-38 hoped to fix is no longer there to fix: on 0.1.145, Haiku runs the slow tier through Squeal with either line. Whether to keep the new line is the 001 coordinator's call on the human's word. The data supports neither changing it back nor rewording it further.

## `a8-load-hold`: slow files held for host load, 0.1.179

The first run: `20261014T212723Z-dd4056` on `1bc146f0`. That is 0.1.179, where an explicit `run --slow` skips the load guard (004-59). The hold uses the default `maxDeferMs`.
- 10 sessions per model, 40 in all, 0 failed.
- Load 17 to 110. Three or four sessions per model peaked above 24.

| Model | `slow-through-squeal` | `claim-true` | `no-false-pass` |
| --- | --- | --- | --- |
| Haiku | 6/10 | 10/10 | 10/10 |
| Sonnet | 10/10 | 10/10 | 10/10 |
| luna | 10/10 | 10/10 | 10/10 |
| sol | 10/10 | 10/10 | 10/10 |

- **No false claim from any model.** Every session that got the slow result claimed it truly.
- **Haiku ran the held slow test through Squeal in 6 of 10.** The other four ran the full Vitest suite themselves and claimed `fail` truly.
  - Three of the four misses were at calm load (peaks 20 to 22); one peaked at 42.
  - That is 30 points below its `a2-slow` without the hold on 0.1.168, 9/10. The gap is unconfirmed: p = 0.30 at 10 sessions an arm, across runs. Confirming a 60% against 90% gap takes about 30 sessions an arm (p ≈ 0.015).
- **Every session that met the measure ran `squeal run --slow`.** So agents do act on the line's "runs them now", which 004-59 made true.

**Correction (2026-10-15): the Claude half of this run is invalid.** In 18 of the 20 Claude cells, `squeal` answered `no squeal@hearsay plugin is installed`.
- The cells inherited the host's `PATH`. The host's `~/.local/bin/squeal` launcher, installed 2026-10-14 at 15:47Z, read the cell's empty `HOME` and never reached the pinned plugin.
- The grader still counted those failed `squeal run --slow` calls. So Sonnet's 10/10 and Haiku's 6/10 measure commands typed, not the slow tier settled through Squeal.
- The Sonnet sessions then ran Vitest themselves.
- Only luna's and sol's 10/10 stand, along with every session's claim.
- The bullet above holds for Codex only.
- Row 006-62 fixes the cell's `PATH` and the grader. a8's Claude cells run again after it.

## Open questions

- Open question 3 (the Claude allow-list): resolved. `Bash(node:*)` is in the list. The refusals that remain are compound shell commands Claude Code asks about: Haiku in 0 to 3 of 10 atomic sessions per scenario, Sonnet in none. They explain none of Sonnet's misses.
