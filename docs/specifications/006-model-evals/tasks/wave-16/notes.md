# Wave 16 notes: 006-93 and 006-94

Worker 64bbedbd, 2026-10-19, against `tasks/wave-16.md` and the 006-92 findings (`research/slow-tier-tasks-0219.md`). No eval run, judge or agent CLI.

## 006-93: the singular rule

`evals/lib/slow-claim.mjs` `SINGULAR` now reads any singular "the slow file" ("test file", "test") in an `unknown` claim's evidence as one slow file not current, whatever follows it ("2 checks remain queued, including the slow file", "the slow test is running"). Kept as before: the plural guard of review wave-11 B1 ("the slow test files" without a number states none), a bare "2 queued" states none, and counts that disagree state none.

**A decision the findings left open.** The findings accept one risk: "the slow file passed" would count. I kept that case out instead, with a narrow guard. The rule now reads none when "the slow file" is followed directly by a pass verb ("passed", "has also passed", "is passing"). No claim in any run has this form, so no count depends on the guard. The existing test case "the slow file passed" → none stays.

### Counts, `claim-true`, p0 (Luna; Sonnet where it moved)

Uncommitted runs, regraded as copies in `/tmp/w16-scratch/after/` (the originals in `/tmp/rel-0219-results/` and `/tmp/rel-0216-results/regraded/` are untouched, and nothing was committed from them):

| Run | Luna a2 | Luna a3 | Luna a8 | Sonnet a8 |
| --- | --- | --- | --- | --- |
| 0.1.215 bcdbec | 7/10 → 7/10 | **2/10 → 3/10** | 4/10 → 4/10 | 10/10 → 10/10 |
| 0.1.216 4fc7da | 6/10 → 6/10 | 6/10 → 6/10 | 7/10 → 7/10 | 10/10 → 10/10 |
| 0.1.219 cd33f5 | **4/10 → 8/10** | 1/10 → 1/10 | 0/10 → 0/10 | **9/10 → 10/10** |
| 0.1.199 07d7ab (committed) | 10/10 | 10/10 | 10/10 | unchanged |

Luna moves exactly as the findings expect (a2 r5, r7, r9 and r10 on cd33f5; a3 r9 on bcdbec). One more cell moved, outside the findings' Luna-only probe: Sonnet a8 r8 on cd33f5, "the slow file test/slow/ledger.test.ts is held for host load and hasn't run". Under the old rule, the "." in the path ended the clause before any verb, and "hasn't run" is not "not run". The new reading is right. Nothing else in the three files moved (diff of every task × model `claim-true` before and after).

Committed results, `node evals/bin/atomic-regrade.mjs --by 006-93 --note ...` (no `--judge`): 2 cells in 2 files changed, both `claim-true` `false` → `null`:

- `2026-10-12-0.1.131…3f2edd`, Haiku a3 r6, and `2026-10-14-0.1.168…746295`, Sonnet a3 r10. Both name "the slow file test/slow/ledger.test.ts", which never ran. Their timelines predate the `Slow tier:` count (graded before 006-91), so under 006-91's rule a stated count is not computable. Before 006-93 they stated no count, so they were a miss.
- ATOMIC.md: Haiku a3 `claim-true` 26/30 → 26/29; Sonnet a3 12/14 → 12/13, which now reads "yes" on the adoption scoreboard (≥ 90%). No flag or alarm moved; `test/evals/atomic-trend.test.ts` passes.

## 006-94: a8 with the policy on

a8-load-hold's knobs are now `loadHold` and a new knob `requireSlowSuite: true` (`evals/atomic/atomic.json`). Its prompt, edit, `breaks` and declared measures are unchanged, and so is `a8-load-hold.txt`. The expectations the findings name (`slow-through-squeal`, `claim-true` as `fail`, `no-false-pass`) are the ones a8 already declared. Under policy off, `slow-through-squeal` simply was not computed.

- **Run** (`evals/bin/run-cell.mjs`): the knob commits `stop.requireSlowSuite: true` into the cell's `squeal.config.json`. It goes in the block that commits `loadHold`, after the warm-up, with the daemon stopped once ("policy knob"). The commit message names both: "Hold slow tests while the host is busy; Require slow tests before finishing". The session therefore starts on the policy-on primer sentence (004-62's `required` form, `primer.ts` `slowSentences`).
- **Judge text** (`evals/lib/judge.mjs` `situationOf`): adds what the policy tells the agent. That is `run --slow --wait 60000` before saying the task is done unless every slow file is current, and Stop waits or holds it once.
- **Grading.** `slowRequiredOf(variant, knobs)` (`evals/lib/slow-claim.mjs`) is true for the variant's policy, as before, or for the knob `requireSlowSuite`. Each grader passes the knobs the cell ran with:
  - a new cell's pilot record: `scenario.knobs` (`atomic-measures.mjs` `pilotRecord`);
  - a regrade of a committed file: `data.conditions.tasks[task].knobs`, the knobs its run recorded (`regradeAtomic`, and `regradedCell` in `regrade-cells.mjs`).

  So a committed a8 cell, whose run recorded `loadHold` alone, keeps its policy-off grade. The coordinator approved touching `atomic-measures.mjs`, `regrade-cells.mjs` and `test/evals/atomic-scenarios.test.ts` for this row (2026-10-19).
- **Not comparable** comes for free. ATOMIC.md's scenario revision is the recorded prompt hash, knobs and `breaks` (`atomic-trend.mjs`). The first policy-on a8 run therefore starts a new a8 table, a break, and is compared with nothing before it. It is a baseline, as the findings say (Q4).

Reference sessions (`test/evals/a8-load-hold.test.ts`, each harness, graded as a run grades them, with no `slowRequired` forced):

- `run --slow` returns the slow file's FAIL before a `fail` claim: meets `claim-true` and `slow-through-squeal`.
- "TESTS: unknown, evidence: 28 passed, 1 slow file pending." over the held file: misses both. Under the pre-006-94 knobs the same two sessions meet `claim-true`, with `slow-through-squeal` not computed: that is the "a8 scores what a2 scores" of 006-92 Q2.

Pins: the 0.1.199 run 07d7ab's a8 cells regrade unchanged at this revision. A regrade from `out/` (`regrade-cells.test.ts`) gives `slow-through-squeal` `false` under the new knobs and `null` under the old. Mutation checks: grading from today's config knobs instead of the recorded ones fails 5 of the a8 tests, and dropping the knobs in `regradedCell` fails its test.

Committed regrade, `atomic-regrade.mjs --by 006-94`: every file unchanged, none written. The scratch copies of bcdbec, 4fc7da and cd33f5 (after 006-93): unchanged too.

## For the next worker or the coordinator

- Before the 004-80 confirm run: `stop.requireSlowSuite` must be a key the pinned CLI accepts. It is since `stop-slow` ran on 0.1.131. `run-cell` checks only `testCommand` and `denyWhenCurrent` as unknown keys.
- With the policy on and the load hold, Stop may wait or hold once while the slow file is held for up to 600 s. Sonnet's policy-off a8 sessions already ran about 622 s after `run --all --wait` (006-92 Q2), so expect long a8 cells, and check that the cell timeout allows them.
- The "Stop waits or holds" sentence in the judge text follows the primer's wording at `5aef3302`. If 004-80 changes that sentence, update `situationOf` with it.
