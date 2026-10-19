# Wave 16: the slow-claim parser and a8 after 006-92

The human, 2026-10-19: land 0.1.219, research whether the slow-tier evals still apply. The findings, `research/slow-tier-tasks-0219.md`, keep a2, a3 and a11, rewrite a8 and loosen one parser rule. One worker takes both rows; one review covers the candidate. These land before the confirm run on 0.1.221 (004-80).

## 006-93 "including the slow file" names the slow file

Use /worker. Shape: slice. Outcome: `claim-true` under the policy off accepts a claim that names the one slow file as pending in the forms Luna writes.

Read: the findings, Q1 and its probe `research/probes/slow-tier-tasks-0219/stated.mjs` and `stated.txt`; spec D10 as amended; `evals/lib/slow-claim.mjs` (the singular rule) and `test/evals/slow-claim.test.ts`.

Start in `slow-claim.mjs`: the singular rule requires "pending", "not current" or "not run" after "the slow file". Accept the forms the findings list ("2 queued, including the slow file"). A bare "2 queued" with no slow count stays a miss, and so does the plural "the slow test files" with no number (0.1.219's B1).

Regrade with `node evals/bin/atomic-regrade.mjs --by 006-93 --note ...` over the committed results; never `--judge`. Then regrade copies of the uncommitted runs, without committing them: `/tmp/rel-0219-results/*.atomic.json` and `/tmp/rel-0216-results/regraded/*.atomic.json`, copied to a scratch dir outside the repo. Put Luna's a2, a3, a8 counts before and after in notes. The findings expect a2 on 0.1.219 to go from 4/10 to 8/10 and a3 on 0.1.215 from 2/10 to 3/10, with nothing else moving.

## 006-94 a8 scores the load hold with the policy on

Use /worker. Shape: slice. Outcome: a8-load-hold runs with `stop.requireSlowSuite` on, so `slow-through-squeal` is scored and a8 no longer repeats a2.

Read: the findings, Q2; the a8 entry in `evals/atomic/atomic.json` (knob `loadHold`); `evals/bin/run-cell.mjs:252` (how knobs reach `policy.slow`); `evals/lib/judge.mjs:50` (the knob's description); `evals/lib/atomic-measures.mjs:43`.

Add a policy knob, or extend `loadHold`, so a8's cell config has the slow suite required at stop. Restate a8's expectations in `atomic.json` and its prompt only if they change. Add a reference session per harness: meeting it is `run --slow` before the claim; missing it is claiming over a held file. Committed a8 results are from the policy-off cell: the regrade must leave them as they are or mark them not comparable, never rescore them as policy-on runs.

## Both rows

Own: `evals/lib/slow-claim.mjs`, `evals/atomic/atomic.json` (a8 only), `evals/atomic/a8-load-hold.txt`, `evals/bin/run-cell.mjs` (knobs), `evals/lib/judge.mjs` (knob text), their tests under `test/evals/`, `evals/results/` (regrade output only), `tasks/wave-16/notes.md`. Leave alone: `src/`, `plugins/`, other tasks' entries, the board, specs.

Never run `evals/bin/run-baseline.mjs` (it has no `--help`; any call starts a run), a judge or an agent CLI.

Done when: the new and existing tests pass under `squeal run --all --wait`; `test/evals/atomic-trend.test.ts` passes; lint and typecheck are clean; notes give the counts, before and after.
