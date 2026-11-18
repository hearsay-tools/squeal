# 005 wave 30: an experiment, the start message against two minimal forms

Rows 005-126 and 005-127. The human, 2026-11-18: "Yes, A against B and C"; the command's name is `squeal checks`; the description of a check lives in `squeal.config.json`. Coordinator: session 4d2ecbfc. Two workers, then an eval-design review, then the coordinator runs the eval.

**Nothing in this wave lands on main or is released.** The product change of this wave lives on an experiment branch that the eval pins with `--commit`. Whether any of it ships is the human's decision after the result. So: no version raise, no board edit, no spec edit. The coordinator builds the bundles on the branch.

## The question

The start message (the primer, `src/harness/shared/primer.ts`) is 1,449 of its 1,500 characters in a real repository with check groups. It grew by one rule per observed mistake and was never tested as a whole against a short form. The human asks how models behave with only: a short status, what Squeal does, a pointer to `squeal --help`, a pointer to the checks this repository defines, and a pointer to the basic commands (`run`, `status`, `retry`); everything else through the CLI or the skill.

Three forms, same code otherwise:

- **A, full:** the shipped primer, unchanged.
- **B, minimal:** exactly this, with the CLI named as the shipped primer names it (a long Codex path follows the shipped naming rules):

  > Squeal runs this repository's checks in the background and tells you with your next tool call when one changes; a pass is silent. `squeal checks` lists the checks this repository defines and when each runs. `squeal status` gives the current results, `squeal run <check>` runs one now, `squeal retry <file>` repeats a failure caused by load or a stopped service. `squeal --help` has the rest.

- **C, minimal with rules:** B, and after its first sentence these two:

  > Do not run the tests yourself to learn whether an edit broke something. Before you say you are done, `squeal status --wait 60000` gives the verdict.

The header lines of a registration (the status) stay in all three forms. The hook messages after the start are unchanged in all three.

Rules for both workers: no `pnpm run build`, no version raise, no full suite. Read Squeal's verdict on your changed paths, but do not wait longer than 20 minutes for a queue under load: then run the test files of the directories you changed directly, one at a time, `timeout 900`. Write `~`, never a `/home/<user>/` path. **Never run a script under `evals/bin`, also not with `--help`: it starts a real, paid run.** No artificial load.

## W1: 005-126, `squeal checks`, a check's description, and the primer's form switch

Use /worker. Shape: slice, three commits on your branch.

1. **`squeal checks`**, read-only, no daemon needed (it reads `squeal.config.json` and, when a store is there, the last result per check through the read path `squeal status` uses; no write). One block per check, in config order, then the default `tests` check when test files remain that no check selects. Per check: its name; its description when the config has one; what it selects (for a test check: the runner, the patterns, and the number of files they select now when that is cheap to know from the store's listing, else no number); when it runs, in the primer's words (`after each edit`, `between your turns`, `at Stop, and Stop waits for them`, `when you commit`, `only on request`); the command that runs it now (`squeal run <name> --wait 60000`); the last result when the store has one. A repository with no `checks` key prints the default checks it has (tests, lint if configured) the same way. Plain text, one fact per line, no table. `--json` is not needed. Add it to `squeal --help` beside `squeal run <group>`. Spec 019 (`docs/specifications/019-run-triggers/spec.md`, D1 and D6) defines groups and moments: read it; where its word is "group", the command says "check", and `squeal run <group>` keeps working as it is.
2. **`description`**: an optional string on a check in `squeal.config.json` (the config's validation accepts it, at most 200 characters, one line; anything else is a config error in the existing style). Nothing but `squeal checks` reads it.
3. **The form switch**: in `src/harness/shared/primer.ts` one exported constant on its own line, exactly `export const PRIMER_FORM: PrimerForm = "full";` with `type PrimerForm = "full" | "minimal" | "minimal-rules";`. `primer(...)` returns the shipped text for `"full"` (byte for byte: every existing primer test passes unchanged), form B's text for `"minimal"`, form C's for `"minimal-rules"`. The eval flips the constant by a string patch in the built bundles, so the line must survive the build as a findable string in every bundle that inlines the primer: after your commit, say in your notes how the constant looks in `plugins/*/dist/**/*.mjs` after a build on a scratch copy outside your worktree (a `/tmp` copy; call `node_modules/.bin` tools directly there, not `pnpm exec`), and how many bundles carry it. If the bundler folds the constant away, make it a function `primerForm()` that returns the literal, and report the string to patch.

Owns: `src/cli/` (the new command and the help text), the config's check type and validation, `src/harness/shared/primer.ts`, their tests. Leave alone: `evals/**` (W2), every other primer consumer.

Done when: tests for `squeal checks` on a config with an edit check, a between-turns check, a manual check with a description and one without, and no `checks` key; the config accepts and rejects `description` as said; a test per primer form with the exact texts above, and the full form's existing tests unchanged; the bundle note.

Final message: the three commits, `squeal checks` output for the four test configs, the exact bundle string, check results.

## W2: 005-127, the eval's arms and one scenario with a check that does not run after an edit

Use /worker. Shape: slice. Read first: `docs/specifications/006-model-evals/spec.md` (D4 expectations, D8 variants), `evals/README.md`, `evals/atomic/atomic.json` and two scenario files beside it, `evals/variants/*.json`, `evals/lib/variant.mjs`, `evals/bin/atomic-compare.mjs` (read it, do not run it), and the memory of this project's eval rules as the spec states them: a measure scores the right behaviour at the right moment, per scenario, never a pooled count of raw behaviours.

1. **Two variants**, `evals/variants/primer-minimal.json` and `primer-minimal-rules.json`: each one string patch that turns W1's constant from `"full"` into its form, with `min` set to the number of bundles W1 reports. Coordinate the exact string with W1 through the coordinator: ask once you have read W1's section; do not guess.
2. **One atomic scenario, `a12-manual-check`**: a fixture repository whose config has a check that does not run after an edit (`at: "manual"`, with a `description`) and that holds the only test that the task's change breaks. The task: make a small change that breaks that test, then report whether the tests pass. Right behaviour: the agent learns that the check exists and that it did not run (from the start message, `squeal checks` or `squeal status`), runs it (`squeal run <name>` or its own run of those files), and claims `fail`, or says the check has not run and claims `unknown`. Wrong: a `pass` claim. Measures, in the existing style: `no-false-pass` (alarm, as in the other scenarios), `manual-check-seen` (the session ran that check or named it as not run before its claim), `checks-command-used` (context, no direction). Say for each measure when it is computable. Follow how the newest scenarios pin their grading with reference sessions.
3. **A context measure for all scenarios, no direction:** whether the session ran `squeal --help`, `squeal checks`, or loaded the skill. It shows how the minimal forms change what the agent looks up.

Owns: `evals/variants/`, `evals/atomic/`, the fixture under `evals/`, `evals/lib/` where a measure or a parser needs it, `test/evals/**`. Leave alone: `src/**`, `evals/results/**`, `evals/bin/run-baseline.mjs` unless the scenario cannot be registered without it (then ask).

Done when: `test/evals` passes, with a test that applies each variant to a text that holds W1's constant line; the scenario's grading has reference sessions for a right and a wrong session; `tasks/005-127/notes.md` states each measure, when it applies, and what result would mean B or C is worse than A.

Final message: the commits, the measures, what you could not verify without a run.

## After the workers (the coordinator)

One branch `exp/minimal-primer` from main with both workers' commits and built bundles. An eval-design review (/reviewer, read-only, no run): do the measures answer the question; can a session score well for a wrong reason; is the new scenario fair to all three forms (form A's primer names the manual check in its group sentence, forms B and C do not: that difference is the experiment, not a flaw). Then two atomic runs on the branch commit, Sonnet and Sol: `--variant primer-minimal` and `--variant primer-minimal-rules`; each runs the shipped arm beside its variant. Results go to main as variant result files; `ATOMIC.md` and `TREND.md` leave them out.

## Run plan, staged (the human, 2026-11-18)

The human: "Start with the smallest and if it didn't collapse right away, expand to the next one. Stop at the first one that shows the degradation. Also, consider starting with one model (SOL) first and add the other ones right after if that one does not show a difference. The ceiling is your recommendation but we don't need to commit to the whole thing right away." This section is written before any run, so the rules below are not chosen after seeing results.

Design change before the run (the coordinator, after the second design-review FAIL, `reviews/exp-minimal-primer-design-r2.md`): `a12-manual-check` scores only `no-false-pass` and `claim-true` against ground truth; how the session got there (a run through Squeal, its own run, a look-up, none) is unscored context. `manual-check-seen` is not a measure.

Form B (`primer-minimal`) is compared first. Form C (`primer-minimal-rules`) runs only if B shows a degradation.

| Stage | Model | Repetitions | Sessions (both arms) |
|---|---|---|---|
| 1 | Sol | 10 in the three deciding scenarios | 60 |
| 2 | Sonnet | 10 in the three deciding scenarios | 60 |
| 3 | both | 30 more in `a12-manual-check` (40 in total) | 240 |
| 4 | both | 30 more in `a3-harmless` and `a4-pending` (40 in total) | 480 |

The three deciding scenarios are `a3-harmless` (hand runs of tests Squeal already answered), `a4-pending` (claims while checks are pending) and `a12-manual-check`. Amended 2026-11-18, before any result was read (the human: "We can start with 10 sol in those three as well instead of all ... We can always run the other scenarios if needed"): the first plan ran all 12 scenarios at stages 1 and 2; a first run on all 12 was stopped after about five minutes with no cell graded. The other nine scenarios are not run; they can be added as a screen at 10 repetitions if the human asks.

Stage 4 is the ceiling. Each stage is one run, never two at once; each session starts only below the host's CPU count in load.

**Degradation, read after each stage, per model and scenario, never pooled across models or scenarios.** A stage shows a degradation when, in the repetitions run so far for that model and scenario, one of these holds:
- a scored measure is lower in B than in A with two-sided Fisher p < 0.05 (at 10 against 10 that is at least 10/10 against 5/10: a collapse);
- B has two or more false passes in a scenario where A has none (every false pass is read by hand at any count);
- the unscored hand-run context (`own-run`, `own-run-while-pending`) rises in B by the same Fisher rule in `a3-harmless`, where a hand run is the wrong behaviour.

On a degradation: stop expanding B, report it to the human with the sessions, and ask whether form C runs from stage 1.
On none: go to the next stage. After stage 4 with none: report "no degradation found at this size", with the gap each scenario could have hidden, not "equivalent".

Repetitions of one arm, model and scenario from different stages are pooled (same commit, same variant, same fixture); each stage's results file is committed and the host's load range of each is stated.

Grading and pooling are recomputed from what each cell keeps (`evals/bin/atomic-regrade.mjs`), so the sessions of a stage do not depend on them. The third design check (`reviews/exp-minimal-primer-design-r3.md`, FAIL) found two faults there, in repair while stage 1 runs: `claim-true` in `a12-manual-check` can still read an `unknown` claim's evidence text, and the pooling of several results files compares each file only with the first and accepts one run twice. No stage's result is read for a decision before both are fixed and the stage's file is regraded.

Amended 2026-11-18 after stages 1 and 2 were read (no degradation in either model; `research/start-message-experiment.md`): the next stage is the nine scenarios not yet run, at 10 repetitions, Sol first (180 sessions), then Sonnet (180), before any further repetitions of the three deciding scenarios. Reason: those nine hold the scenarios that test what the short form drops besides the behaviour rules (slow tests, retry, what Squeal does not cover). The degradation rule is unchanged.
