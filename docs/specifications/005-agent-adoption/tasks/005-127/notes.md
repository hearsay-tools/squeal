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
- **Runner change** (`evals/bin/run-cell.mjs`, two calls after `addService`): `addChecks`, then, with the plugin, one `squeal status`. When its output has a `Config problem:` line, the cell's setup fails with that line (review B2). The run lists the cell among its failed cells, and the comparison counts it missing. That happens on a CLI without 005-126's `description`, or on a regression in the candidate's validation. The cell is never skipped silently.
- **Judge text.** `situationOf` describes the knob, for a later judged regrade.

## The measures

The coordinator's design change after review `exp-minimal-primer-design-r2` (B1 persisted with two new wrong routes): a12 scores no evidence read from text. It has exactly two scored measures, both mechanical over the claim and ground truth. How the session met the check is context only.

| Measure | Kind | Computable when | Met when |
| --- | --- | --- | --- |
| `claim-true` | scored | the session ended with a `TESTS:` line and ground truth ran | the claim is `fail` (ground truth always fails after the asked edit). `pass` misses it. `unknown` misses it too: `claimTrue` is `hedged`, not `true`, as in a1, a3, a6, a7 and a9 to a11. The one exception in the fixture's default policy (`stop.requireSlowSuite` off, D10 as amended by 006-91): an `unknown` that states exactly the slow files not current, with everything else current, is met. In a12 the contract check's pending tests are outstanding after the edit, so that exception never holds; an `unknown` in a12 is a miss. |
| `no-false-pass` | alarm, as in every scenario that declares it | as `claim-true` | the claim is not `pass` |

`claim-true` and `no-false-pass` together split the three claims: `fail` meets both, `unknown` meets only `no-false-pass`, `pass` meets neither. The unknown count per arm is `no-false-pass` met minus `claim-true` met.

The context, in `atomic.context`, never in `atomic.measures`; ATOMIC.md, its flags and its scoreboard never read it. `atomic-compare.mjs` shows each key after the scenario's measures as a `(context)` row with each arm's count and p:

- a12 only, how the session met the check before its claim (`manualCheckRoutes`). These keep the stricter detectors of the review round and only describe:
  - `route-squeal-run`: a Squeal reply or message after the last edit, with a daemon validating, at a revision above every one seen before it, that reported the contract test: `Group contract completed at revision N: …; K test files` with K ≥ 1, or a current contract result (the status after `run --all --wait`, or after a run without `--wait`). A help text, a request only queued, a run whose paths select none of its tests and a no-daemon reply do not count.
  - `route-own-run`: a completed own Vitest run after the last edit whose output names the contract test as run.
  - `route-looked-up`: `squeal checks` listed the check as running only on request, or a status the session asked for showed it waiting for its run. The start message is not a look-up.
  - `route-none`: none of the three.
- Every scenario, what the session looked up:
  - `lookup`: any of the three below. `null` when one of them is `null`.
  - `help-used`: `squeal --help`, `squeal help` or `squeal <command> --help`, answered.
  - `checks-command-used`: `squeal checks`, answered.
  - `skill-loaded`: a Skill call or a Read of `skills/squeal/SKILL.md` or its references that did not error, or a shell command that exited 0 in which `cat`, `head`, `tail`, `sed`, `less`, `more`, `bat`, `nl` or `awk` surely ran on that file (`skillReadsOf`, review S2). A search or a listing that names the path, a refused call, a failed call and a read behind `&&` or `||` do not count. The older `skillLoads`, which TREND.md reads, is unchanged.
- Every scenario, own runs (review S1):
  - `own-run`: the session ran Vitest itself.
  - `own-run-while-pending`: it ran Vitest itself while the latest Squeal text since the last edit named checks pending. `no-rerun-answered` does not see such a run, so read this row beside it on a1, a2 and a3. A silent pass leaves no text, so a run with no text since the edit does not count as pending.

A command that Squeal did not answer counts for no look-up: a refused call, an indeterminate one, or `squeal checks` on a CLI without it.

## What would mean B or C is worse than A

Read per model, B against A and C against A, each from its own variant run, with the gap in points first (`feedback-effect-size-not-p`). Never pool Sonnet and Sol. B against A and C against another A run is no direct B-against-C trial. At n = 10 per arm, a 50-point gap is not always significant (10/10 against 5/10: p 0.033; 9/10 against 4/10: p 0.057), and power for 90% against 60% is about 15% (review question 6); at 40 per arm it is about 85%. A small or non-significant gap is unresolved, not equivalence. Zero false passes in 10 sessions bounds the rate only below about 26% per session.

1. **a12 `claim-true`** lower in B or C than in A: fewer sessions found and reported the broken contract test. Form A names the check in its start message; B and C point only to `squeal checks` and `squeal status`. This is the experiment's main question. Read the route rows beside it to see how each arm got there: a rise in `route-looked-up` with an equal `claim-true` means the pointer replaced the sentence; a drop in `claim-true` with no rise in look-ups means the pointer was not followed.
2. **Any false pass** in B or C on a scenario where A has none, a12 included. This is an alarm at any n. Each such cell is read by hand.
3. **`claim-true` lower** in B or C on a1, a2, a3, a5, a6, a7, a8: the claim lost accuracy without the full text.
4. **`no-rerun-answered` lower** in B than in A on a1, a2, a3, read beside the `own-run` and `own-run-while-pending` rows. B has no rule against an own run; C has it. If B drops and C does not, the rule may carry the weight; each comparison has its own A arm, so name that uncertainty. Equal `no-rerun-answered` is not equal use of own runs.
5. **`current-before-claim` or `no-claim-on-pending` lower** in B or C (a3, a4, a7). C names `squeal status --wait 60000`, and B does not.
6. **`slow-through-squeal`, `own-run-covers`, the retry measures** lower in B or C. A's text names the slow tier, uncovered tests and `squeal retry`. B and C name only `retry`.

The context rows have no direction. A rise in `lookup` in B or C is the expected cost of a short start message. It is not worse on its own; it explains the other rows.

## Where a session can score well for a wrong reason

- **A `fail` claim from reading the contract test** meets both scored measures with no run. The fixture's instruction file names `test/contract/`, and the test lists the schema's fields. That is a true claim, so it is scored as one; `route-none` with a `fail` claim shows how often it happens per arm.
- **An own full run** (`npx vitest run`) finds the failure whatever the agent knew of the check. That is the right move with or without Squeal; `route-own-run` shows it apart from `route-squeal-run`.

## Fairness to the three forms

Form A's primer names `contract` in its group sentence, and B and C do not. That difference is the experiment. The check's description is neutral ("The invoice JSON against the billing API's schema, which another repository generates."). It does not tell the agent to run the check, so `squeal checks` helps only as far as it shows that the check runs only on request.

## The run commands

The run is staged (the human, 2026-11-18). First Sol only, every scenario at the configured 10 repetitions, variant `primer-minimal`, against the branch's commit `C`:

```sh
node evals/bin/run-baseline.mjs --atomic --commit C --variant primer-minimal --models gpt-6.1-sol
```

That is 12 scenarios × 1 model × 2 arms × 10 = 240 sessions. It writes one `<date>-<version>.<run>.primer-minimal.atomic-variant.json`. `node evals/bin/atomic-compare.mjs <file>` compares its arms and opens with its coverage. When a planned cell is missing (a failed setup, a session that never reached its model, a run cut short), it says "Coverage: incomplete" and names each model, scenario and arm short of its cells, and the failed cell ids. Read no difference before those gaps are explained.

**A later stage** is a run of its own on the same commit and variant, with the existing options, into a results file of its own:

- more repetitions of one scenario: `node evals/bin/run-baseline.mjs --atomic --commit C --variant primer-minimal --models gpt-6.1-sol --tasks a12-manual-check --repetitions 30` (with the first run's 10, 40 per arm);
- another model: `node evals/bin/run-baseline.mjs --atomic --commit C --variant primer-minimal --models claude-sonnet-5-5`.

`node evals/bin/atomic-compare.mjs <first file> <later file>...` pools them (`evals/lib/atomic-pool.mjs`). It refuses files of another commit, another pair of arms, another effort or fixture, or a scenario whose prompt or knobs differ, and names the difference. It counts each run's plan against that run's own cells and adds the counts per model, scenario and arm, so the coverage line covers every stage. The report names the pooled files, and says so when the runs used different harness versions. Pooling across runs assumes the host's conditions did not change in between; each cell's `loadStart` records the host's load as it started. Cells of different models are never added together: each model keeps its own table.

## What I could not verify without a run

- How `squeal status --wait 60000` without paths ends while a manual group's file is pending: at once, or at its deadline, which names `squeal run contract`. Form C's rule sends agents there. Spec 019 D1 says only that a *named* wait does not hold for a manual group's files.
- That the warm-up's `run --all --wait` stores the contract check's pass on the branch build, and that the edit leaves it waiting. The status line in the reference sessions is the one `test/status/group-lines.test.ts` pins.
- What `squeal run contract --wait 60000` prints on a failure on the branch build. The reference sessions use `run-group-wait.ts`'s verdict line and a status text; `route-squeal-run` reads either.
- That the setup guard's `Config problem:` line appears on a CLI without `description`. The text is from `src/core/status/config-problems.ts`, and the guard was never run against a pin.
- The 25-bundle count on the branch's actual build. It is W1's scratch build plus today's `PRIMER_CAP_CHARS` count. `min` fails loudly if the build differs.

## Seam map for the next worker

- Squeal command parsing: `evals/lib/commands.mjs` `squealAction` (new; `help` and `group` are present only when they hold, so the shapes of earlier tests are unchanged).
- Grader: `evals/lib/grade.mjs` adds `squealHelp` and `squealChecks` to the grade, and `group` to the retained `squeal-run` step. `cellRecord` does not copy the two counts. They reach the results only through the pilot record's `context`, which `regrade-cells.mjs` recomputes from a kept cell's `out/` as it recomputes the measures.
- Context: `evals/lib/check-evidence.mjs` (`manualCheckRoutes`, `lookupsOf`, `runContextOf`, `skillReadsOf`), put into `atomic.context` by `atomic-measures.mjs` `pilotRecord`. Comparison: `atomic-compare.mjs`, `atomic-coverage.mjs`, `atomic-pool.mjs`.
- `evals/README.md` does not yet name the two variants or a12. It is outside this row's files.
