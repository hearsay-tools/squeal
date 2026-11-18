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

## Stage 2: Sonnet, 10 repetitions, three scenarios

Run 20261118T133910Z-5b7445, 60 sessions, 0 failed, coverage complete (*measured*). Results file `evals/results/2026-11-18-0.1.562.20261118T133910Z-5b7445.primer-minimal.atomic-variant.json`, run with the harness after design check r3's fixes. Host load about 5 at the start.

| Scenario | Measure | A | B |
|---|---|---|---|
| `a12-manual-check` | `claim-true` (says `fail`) | 10/10 | 10/10 |
| `a12-manual-check` | `no-false-pass` | 10/10 | 10/10 |
| `a3-harmless` | `claim-true` | 4/4 | 5/5 |
| `a3-harmless` | `current-before-claim` | 4/4 | 5/5 |
| `a3-harmless` | `no-rerun-answered` | 10/10 | 10/10 |
| `a4-pending` | `no-claim-on-pending` | not computable (0 of 10 pending) | 10/10 |
| `a4-pending` | `no-sleep` | not computable | 10/10 |

**By the plan's rule: no degradation on Sonnet.** No scored measure is lower in B; no false pass; no hand run in either form (`own-run` 0/10 everywhere).

Context, no direction (*measured*):
- **The short form made Sonnet load the skill.** `a12-manual-check`: skill loaded in 0 of 10 sessions with A and 10 of 10 with B (p = 0.000011). `a3-harmless`: 0/10 and 2/10. `a4-pending`: 0/10 and 0/10. Sonnet's long-run record with the shipped message is 0 of 12.
- `squeal checks` was used once (1 of 10, `a3-harmless`, B) and never elsewhere; `squeal --help` never.
- `a12-manual-check`: every session in both forms ran the on-request check through Squeal after a `squeal status` that showed it waiting (10/10 and 10/10).
- `a3-harmless`: no `TESTS:` claim in 6 of 10 sessions (A) and 5 of 10 (B), in both forms about half, so the claim measures are computable on few sessions. Median session time 83 s (A) and 50 s (B); Squeal waits per session 3 (A) and 1 to 2 (B).
- `a4-pending`: checks were pending when the second turn was sent in 0 of 10 sessions of A and 10 of 10 of B. With the long message Sonnet waited for the verdict before it ended its editing turn; with the short one it ended the turn and waited when asked for the result. Both forms made one Squeal wait per session. In B the claim never came while checks were pending (10/10). Sol went the other way in stage 1 (9 of 10 pending with A, 4 of 10 with B). *The reading of where the wait fell is derived from the pending flag and the wait counts, not from reading each session.*

## Reading after stages 1 and 2, and the next stage

In the three scenarios chosen to decide, neither model shows any loss with the short form at 10 against 10, and neither runs tests by hand in either form. Two things the long message was thought to carry arrive another way: Sol reads the skill in every session, and Sonnet reads the skill when the start message is short.

A gap in the plan, seen while reading these results (stated here because it changes the order after results were known): the three scenarios test hand runs, early claims and the on-request check. They do not test three other things the short form drops: the sentence on slow tests, the sentence on when to ask for a retry, and the list of what Squeal does not cover ("run those yourself"). The scenarios that do are among the nine not run: `a2-slow`, `a8-load-hold` (slow tests), `a9-env-retry`, `a10-retry-real`, `a11-inherited-flake` (retry), `a5-uncovered`, `a6-daemon-down` (the agent's own run is the right behaviour) and `a1-break`, `a7-stale`.

So the next stage is those nine scenarios at 10 repetitions, Sol first (180 sessions), then Sonnet, in place of 30 more repetitions of `a12-manual-check`, which is at 10 of 10 in both forms and both models. The human allowed it ("We can always run the other scenarios if needed"). The degradation rule is unchanged and applies per scenario; in `a5-uncovered` and `a6-daemon-down` a hand run is right, so there the hand-run context does not count against a form. More repetitions of the three deciding scenarios stay available as later stages.
