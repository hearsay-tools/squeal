# The start message against a minimal form: an experiment

Rows 005-126 and 005-127. Question (the human, 2026-11-18): does an agent need the long start message, or do a short description and pointers to the CLI do? Brief, forms and the staged run plan with its degradation rule, written before any run: `../tasks/wave-30.md`. Experiment branch `exp/minimal-primer`; the Squeal under test is commit `86fd6c9ce` in every stage (0.1.562 plus `squeal checks`, a check's `description`, and the form switch). Nothing of it is on main.

Form A is the shipped start message. Form B (`primer-minimal`): what Squeal does, and pointers to `squeal checks`, `squeal status`, `squeal run <check>`, `squeal retry <file>` and `squeal --help`. In both forms the hook messages after the start and the skill are unchanged.

Every count below is sessions that met a measure over sessions where it was computable. Models and scenarios are never pooled. A gap that is small or not significant is unresolved, not equivalence.

## Stage 1: Sol, 10 repetitions, three scenarios

Run 20261118T131437Z-3045e6, 60 sessions, 0 failed, coverage complete (*measured*). Results file `evals/results/2026-11-18-0.1.562.20261118T131437Z-3045e6.primer-minimal.atomic-variant.json`; regraded under the rules after design check r3: unchanged. Host: 24 CPUs, 4 sessions at once, load about 5 to 12 at the starts read.

| Scenario | Measure | A | B |
|---|---|---|---|
| `a12-manual-check` | `claim-true` (says `fail`) | 10/10 | 10/10 |
| `a12-manual-check` | `no-false-pass` | 10/10 | 10/10 |
| `a3-harmless` | `claim-true` | 10/10 | 10/10 |
| `a3-harmless` | `current-before-claim` | 10/10 | 10/10 |
| `a3-harmless` | `no-rerun-answered` | 10/10 | 10/10 |
| `a4-pending` | `no-claim-on-pending` | 9/9 | 4/4 |
| `a4-pending` | `no-sleep` | 9/9 | 4/4 |

**By the plan's rule: no degradation on Sol.** No scored measure differs; no false pass in either form; no hand run in either form (`own-run` 0/10 and 0/10 in every scenario).

Context, no direction (*measured*):
- Sol loaded the skill in 10 of 10 sessions in both forms, in every scenario. The skill holds the behaviour rules the short form drops, so for Sol the rules arrive either way.
- `squeal checks` and `squeal --help` were used in 0 of 10 sessions in both forms, in every scenario.
- `a12-manual-check`: every session ran the on-request check through Squeal (10/10 and 10/10). In form A no session looked the check up first (0/10): the start message names it. In form B 9 of 10 did (a `squeal status` that showed the check waiting; p = 0.00012). So the short form costs one more command there, and the agent still found the check without `squeal checks`.
- `a12-manual-check` median session time 31 s (A) and 38 s (B); `a3-harmless` 108 s and 100 s; `a4-pending` 42 s and 42 s.
- `a4-pending`: checks were still pending when the second turn was sent in 9 of 10 sessions of form A and 4 of 10 of form B, so its measures were computable less often in B (two-sided Fisher p = 0.057 on 9/10 against 4/10; *derived*). The cause is not determined; the scenario sends the second turn at once and the pending state depends on timing.

What 10 against 10 cannot show: a true 90% against 60% is detected in about 15% of such runs (`../reviews/exp-minimal-primer-design.md`, section 6). Stage 1 rules out a collapse on Sol, not a moderate loss.

Next by the plan: stage 2, Sonnet, the same three scenarios.
