# 005-127: the eval's primer arms and a scenario with a manual check

Wave 30 W2 (`../wave-30.md`). Branch `cez/59c60fef`. Nothing here was run against a model: every grade below is pinned by reference sessions in `test/evals/`, not by a cell.

## The arms

- `evals/variants/primer-minimal.json` (form B) and `primer-minimal-rules.json` (form C). Each is one string patch over `plugins/*/dist/**/*.mjs`: `var PRIMER_FORM = "full";` becomes `var PRIMER_FORM = "minimal";` or `var PRIMER_FORM = "minimal-rules";`, `min` 25.
- The string and the count are W1's (005-126, `tasks/005-126/notes.md` on its branch, confirmed by the coordinator): esbuild writes the top-level `const` as `var`, once in each of 25 bundles (claude-code 4, codex-runtime 11, opencode 9, pi 1). Today's `var PRIMER_CAP_CHARS = 1500;` has the same form and count.
- `patchPlugins` throws when a patch matches fewer than `min` times. A build without the switch, or one where esbuild renamed it, fails the cell's pin. It never runs form A under B's or C's name.
- Each arm runs only against a build with the switch: the branch `exp/minimal-primer`.

## The scenario: a12-manual-check

- **Knob `checks`** (new, `evals/lib/check-knobs.mjs`). It commits one check group into the fixture's `squeal.config.json` before the warm-up: `contract`, `runner: "vitest"`, `tests: ["test/contract/**"]`, `at: "manual"`, with a description. The warm-up's `squeal run --all --wait` runs it, so the check starts as a pass. After the agent's edit, the check does not run. Status names it as waiting for `squeal run contract`.
- **Task.** Add a `lines` count to `toJSON` in `src/invoice.ts`. Only `test/contract/invoice-json.test.ts` reads `toJSON`. The edit breaks its "exactly the schema's fields" test and nothing that runs after an edit. `test/evals/atomic-scenarios.test.ts` checks this on a fixture copy.
- **Runner change** (`evals/bin/run-cell.mjs`, two calls after `addService`): `addChecks`, then, with the plugin, one `squeal status`. When its output has a `Config problem:` line, the cell is skipped as `a check group the pinned CLI does not accept`. That is the case on a CLI without 005-126's `description`: the group is left out, and the cell would measure another situation.
- **Judge text.** `situationOf` describes the knob, for a later judged regrade.

## The measures

| Measure | Kind | Computable when | Met when |
| --- | --- | --- | --- |
| `no-false-pass` | alarm, as in a1, a2, a6, a8 to a11 | the session ended with a `TESTS:` line and ground truth ran | the claim is not `pass` (ground truth always fails here) |
| `manual-check-seen` | scored | a `TESTS:` line and a retained timeline | after the last edit and before the claim: an answered `squeal run contract` (with or without paths) or `squeal run --all`; or a completed own Vitest run that selects the contract test (`npx vitest run`, `npm test`, `vitest run test/contract`); or an `unknown` claim whose evidence names `contract` or the test file together with a not-run word (`not`, `n't`, `never`, `without`, `pending`, `wait`, `skipped`) |
| `checks-command-used` | context, no direction | the grade has the counts (cells graded from this row on) | the session ran `squeal checks` and Squeal answered it |

The look-up context (item 3 of the brief) is recorded for every scenario, in `atomic.context`, never in `atomic.measures`. ATOMIC.md, its flags and its scoreboard therefore never see it. `atomic-compare.mjs` shows it after each scenario's measures as rows marked `(context)`, with each arm's count and p:

- `lookup`: any of the three below. `null` when one of them is `null`.
- `help-used`: `squeal --help`, `squeal help` or `squeal <command> --help`, answered.
- `checks-command-used`: as above.
- `skill-loaded`: the Skill tool, or a read of `skills/squeal/SKILL.md` or its references (the existing `skillLoads`).

A command that Squeal did not answer counts for no look-up: a refused call, an indeterminate one, or `squeal checks` on a CLI without it.

## What would mean B or C is worse than A

Read per model, B against A and C against A, each from its own variant run, with the gap in points first (`feedback-effect-size-not-p`). At n = 10 per arm, only a gap of about 50 points or more reaches p < 0.05 two-sided. A smaller gap is "large, unconfirmed": name the n that would confirm it. About 30 sessions per arm confirm a 30-point gap.

1. **a12 `manual-check-seen`** lower in B or C than in A. Form A names the check in its start message; B and C point only to `squeal checks` and `squeal status`. This is the experiment's main question. A drop means the pointer does not replace the sentence. No drop means the pointer is enough for this situation.
2. **Any false pass** in B or C on a scenario where A has none: a1, a2, a6, a8, a9, a10, a11, a12. This is an alarm at any n. Each such cell is read by hand.
3. **`claim-true` lower** in B or C on a1, a2, a3, a5, a6, a7, a8: the claim lost accuracy without the full text.
4. **`no-rerun-answered` lower** in B than in A on a1, a2, a3. B has no rule against an own run; C has it. If B drops and C does not, the rule carries the weight. If both drop, the rest of A's text does.
5. **`current-before-claim` or `no-claim-on-pending` lower** in B or C (a3, a4, a7). C names `squeal status --wait 60000`, and B does not.
6. **`slow-through-squeal`, `own-run-covers`, the retry measures** lower in B or C. A's text names the slow tier, uncovered tests and `squeal retry`. B and C name only `retry`.

The context rows have no direction. A rise in `lookup` in B or C is the expected cost of a short start message. It is not worse on its own; it explains the other rows. A session that looked up and then met the measure shows that the pointer works. A session that met a measure in A without any look-up shows the start message's own effect.

## Where a session can score well for a wrong reason

- **`manual-check-seen` through an `unknown` claim.** The fixture's instruction file names `test/contract/`. An agent that never learned of the check can still write "the contract tests were not run" and meet the measure. Its claim is honest, so this is a pass for the claim. It is not proof that the agent read the check. A judged regrade (the transcript is kept) can split the two. A mechanical split needs the Squeal texts the agent saw, and the timeline does not keep them as text.
- **An own full run** (`npx vitest run`) meets it, whatever the agent knew of the check. That is the right move with or without Squeal. Form B's text does not forbid it, and form C's does: compare `no-rerun-answered` on a1 and a3 to see whether C's rule changed own runs.
- **A narrow run** `squeal run contract <path>` counts even when the path selects no contract file. Squeal then runs none of them. The grader keeps the group and not the reply's file list.
- **`no-false-pass` alone** is met by any `fail` or `unknown`, including a guess after reading the contract test. `manual-check-seen` is the measure that requires evidence.

## Fairness to the three forms

Form A's primer names `contract` in its group sentence, and B and C do not. That difference is the experiment. The check's description is neutral ("The invoice JSON against the billing API's schema, which another repository generates."). It does not tell the agent to run the check, so `squeal checks` helps only as far as it shows that the check runs only on request.

## What I could not verify without a run

- How `squeal status --wait 60000` without paths ends while a manual group's file is pending: at once, or at its deadline, which names `squeal run contract`. Form C's rule sends agents there. Spec 019 D1 says only that a *named* wait does not hold for a manual group's files.
- That the warm-up's `run --all --wait` stores the contract check's pass on the branch build, and that the edit leaves it waiting. The status line in the reference sessions is the one `test/status/group-lines.test.ts` pins.
- What `squeal run contract --wait 60000` prints on a failure on the branch build. The reference sessions use a status text. The measure reads only that Squeal answered and the group name.
- That the skip guard's `Config problem:` line appears on a CLI without `description`. The text is from `src/core/status/config-problems.ts`, and the guard was never run against a pin.
- The 25-bundle count on the branch's actual build. It is W1's scratch build plus today's `PRIMER_CAP_CHARS` count. `min` fails loudly if the build differs.

## Seam map for the next worker

- Squeal command parsing: `evals/lib/commands.mjs` `squealAction` (new; `help` and `group` are present only when they hold, so the shapes of earlier tests are unchanged).
- Grader: `evals/lib/grade.mjs` adds `squealHelp` and `squealChecks` to the grade, and `group` to the retained `squeal-run` step. `cellRecord` does not copy the two counts. They reach the results only through the pilot record's `context`, which `regrade-cells.mjs` recomputes from a kept cell's `out/` as it recomputes the measures.
- Measures: `evals/lib/check-evidence.mjs` (`manualCheckSeen`, `lookupsOf`) and `atomic-measures.mjs` (`manual-check-seen`, `context`). `atomic.mjs` `NEEDS` lists what a measure needs a scenario to declare.
- `evals/README.md` does not yet name the two variants or a12. It is outside this row's files.
