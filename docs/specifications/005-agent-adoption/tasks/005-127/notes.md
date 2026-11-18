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
| `claim-true` | scored | the session ended with a `TESTS:` line and ground truth ran | the claim word against ground truth alone, no claim text read (review `exp-minimal-primer-design-r3` B1): `fail` meets it (ground truth always fails after the asked edit), `pass` and `unknown` miss it whatever the evidence says. The other scenarios keep 006-91's rule, under which an `unknown` that states exactly the slow files not current, with everything else current, is met; a scenario with a `manualCheck` does not apply it (`evals/lib/atomic-measures.mjs`). |
| `no-false-pass` | alarm, as in every scenario that declares it | as `claim-true` | the claim is not `pass` |

`claim-true` and `no-false-pass` together split the three claims: `fail` meets both, `unknown` meets only `no-false-pass`, `pass` meets neither. The unknown count per arm is `no-false-pass` met minus `claim-true` met. A session without a `TESTS:` claim leaves both not computable (the harness's convention), so it drops out of both denominators; `atomic-compare.mjs` shows the sessions without a claim per arm as the context row `no-claim`, read from each cell's kept claim, so a shrinking denominator is visible.

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

`node evals/bin/atomic-compare.mjs <first file> <later file>...` pools them (`evals/lib/atomic-pool.mjs`). It refuses files of another commit, another pair of arms, another effort or fixture. It checks every scenario that more than one file holds against all of them, whatever their order, and refuses one whose prompt or knobs differ in either arm. It refuses two files of one run id (one file given twice, or a copy) and a file that holds one cell id twice. A cell id names its repetition, not its run, so a later run of a12 holds `r1` to `r30` again as new sessions; the run id keeps them apart. It prints each file's plan (its repetitions, scenarios and models) and coverage, with each gap, before the pooled coverage line and the tables. It counts each run's plan against that run's own cells and adds the counts per model, scenario and arm. The report names the pooled files, and says so when the runs used different harness versions. Pooling across runs assumes the host's conditions did not change in between; each cell's `loadStart` records the host's load as it started. Cells of different models are never added together: each model keeps its own table. The staged looks and the many comparisons make p < 0.05 a nominal, exploratory threshold, not a 5% false-alarm bound for the whole experiment.

**Regrading a results file under these rules.** `evals/bin/atomic-regrade.mjs` recomputes each cell's measures from what it kept (its pilot record, timeline and claim line) under `evals/atomic/atomic.json` and the grading code of the checkout it runs in, so it runs from a checkout that has this row's fix:

```sh
node evals/bin/atomic-regrade.mjs --by 005-127 --note "a12 claim-true reads no claim text (review exp-minimal-primer-design-r3 B1)" evals/results/<file>.primer-minimal.atomic-variant.json
```

It writes that file only when a cell's measures changed, adding `regraded: { by, date, changed, note }` with the changed cell ids, and prints the changed cells; nothing else in the file changes. When it wrote the file, it then regenerates `evals/results/ATOMIC.md` from every atomic file there; a variant file is not in that table. No session and no model call. It does not recompute `atomic.context` (the route and look-up rows were recorded at grading time); the `no-claim` row needs no regrade.

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

## Forms E and F: sending the agent to the skill

The human, 2026-11-18: test forms E and F. In stage 4, form B brought hand runs back on Sonnet in a9-env-retry and a11-inherited-flake, in sessions that had not loaded the skill. Both forms are variant files only. The Squeal under test stays 86fd6c9ce9cce15ed9a983753bb1762ff5eb2cb7, so the pins and the shipped arm are those of stages 1 to 4.

- `evals/variants/primer-minimal-skill.json` (E): the form switch to `minimal`; the retry step in the skill; and the start message's last sentence followed by "Read the squeal skill before you run or judge tests." The skill's description is as shipped.
- `evals/variants/primer-minimal-desc.json` (F): the form switch to `minimal`; the retry step in the skill; and the skill's `description:` line replaced in every copy. The start message is the plain minimal form.

**The retry step and its numbering.** The skill's steps had no `squeal retry`. The new text is step 3, before "Wait only when you need a result before your next step". The later steps become 4, 5 and 6, and every reference to their numbers moves with them:

- in `SKILL.md`: `(step 4)` becomes `(step 5)`; `use step 3's path wait instead` becomes `use step 4's path wait instead` (the seed has no such line); `not what step 3 or 4 expects` becomes `not what step 4 or 5 expects`;
- in `references/commands.md`: "The skill's step 4 says what to claim from it." and "(the skill's step 4)" become step 5.

**Which copies.** The copies that hold the steps are `plugins/claude-code`, `plugins/codex-runtime`, `plugins/pi` (`plugins/*/skills/squeal/`, min 3) and the Codex seed, `plugins/codex/seed/skills/squeal/` (min 1). `plugins/codex/skills/squeal/SKILL.md` is a short file without steps: it tells the agent to read the runtime's skill. Every patch matched exactly its minimum on a copy of 86fd6c9ce's plugin tree, as the variant loader applies it. The counts are, in patch order: E `[25,3,1,3,1,3,1,3,1,3,3,1,3,1,3,1,25]`, F `[25,3,1,3,1,3,1,3,1,3,3,1,3,1,3,1,4,1]`.

**E's anchor.** In 86fd6c9ce's bundles the minimal form's last sentence is the template line `` `${capital(cli("--help"))} has the rest.`, ``: once in each of 25 bundles (checked on that commit's tree, `git archive`), the same 25 that hold the switch. With the patch, the start message ends "… `squeal --help` has the rest. Read the squeal skill before you run or judge tests." One exception: when the start message names no CLI (`naming === "none"`), the sentence "These are commands of the CLI SQUEAL messages name." still follows.

**F's description.** The description line is identical in all five `SKILL.md` copies, and no other file of the pin holds it.
- Claude Code reads a plugin skill's `name` and `description` from the front matter of `skills/<name>/SKILL.md` in the plugin directory the cell passes, `<pin>/plugins/claude-code`. `.claude-plugin/plugin.json` and the marketplace files hold only the plugin's own description.
- Codex installs `plugins/codex` from the pinned marketplace (`codex plugin add squeal@hearsay`, after the pin was patched). It takes the skill's description from that copy's `skills/squeal/SKILL.md` front matter, which F patches too. The steps the Codex agent then reads are the runtime's `skills/squeal/SKILL.md`, which the cell retains from the patched `plugins/codex-runtime`, or the seed.
- Earlier variants relied on the same places: `noskill` removed both skill copies, and `skill-file` patched bundles. I did not run Codex to observe this.

**The Codex runtime's hashes.** `plugins/codex-runtime/runtime.json` lists a sha256 per file, and the patched files no longer match it. Stages 1 to 4 ran Sol on `primer-minimal`, whose patch changes 11 codex-runtime bundles in the same way, so the retained runtime is not verified against those hashes at use. The E and F runs are Sonnet only.

**Run commands**, from a checkout that holds these two variant files (the runner reads `evals/variants/` there; the pin comes from `--commit`):

```sh
node evals/bin/run-baseline.mjs --atomic --commit 86fd6c9ce9cce15ed9a983753bb1762ff5eb2cb7 --variant primer-minimal-skill --models claude-sonnet-5-5 --tasks a9-env-retry,a11-inherited-flake --repetitions 10
node evals/bin/run-baseline.mjs --atomic --commit 86fd6c9ce9cce15ed9a983753bb1762ff5eb2cb7 --variant primer-minimal-desc --models claude-sonnet-5-5 --tasks a9-env-retry,a11-inherited-flake --repetitions 10
```

Each run is 2 scenarios × 1 model × 2 arms × 10 = 40 sessions: the shipped arm beside its variant arm. Each writes its own `.atomic-variant.json`. `atomic-compare.mjs` compares each file on its own. It refuses to pool an E or F file with a `primer-minimal` file, because their variant arms differ.

## The full check: the skill form and the rewritten skill

The human, 2026-11-18: "Final texts and a full check", with `squeal checks` in the skill. The commit under test is new: main, W1's `skill` start-message form (`cez/c35f19fd`) and this row's commits. Its shipped arm keeps the shipped skill, so the skill's new text reaches the eval only through these variants. The wording is a draft under the human's review.

- `evals/variants/primer-skill.json`: the form switch to `skill` (`var PRIMER_FORM = "full";` to `var PRIMER_FORM = "skill";`, min 25), and the skill patches below.
- `evals/variants/primer-skill-noproof.json`: the same without the proof parts: the description without "to show that a test catches a bug … or to compare test results with an earlier commit", and no step 8.

**One text, one string.** A patch's `files` may now be a list (`evals/lib/variant.mjs`), so each text is written once for the skill's copies and the Codex seed. A wording change is an edit of one string in each of the two files. `test/evals/skill-form-variants.test.ts` fails when the two files differ in anything but the proof parts. I generated the files once from a list of the strings; that generator is not in the repository, so edit the JSON strings directly.

**The steps.** The skill's steps after the patch:
1. **Learn this repository's checks first** (new, (b))
2. Keep working, and read the reports (was 1)
3. On a FAIL (was 2)
4. **A failure you did not cause** (new, (c), the text of forms E and F)
5. Wait only when you need a result (was 3)
6. Before you say the task is done (was 4)
7. Run tests yourself only (was 5)
8. **Results at another commit, and red proofs** (new, (d); `primer-skill` only). It is the last step, so the version without proof has the same steps 1 to 7 and no gap.

References to step numbers moved with their steps: `(step 4)` became `(step 6)`; `use step 3's path wait instead` became step 5 (not in the seed); `not what step 3 or 4 expects` became `5 or 6`; in `references/commands.md`, `the skill's step 4` became step 6, twice.

**'The primer' replaced** ((e), every copy that holds it):
- intro: "It covers what the SQUEAL primer lists from `squeal.config.json`:" becomes "It covers the checks `squeal checks` lists from `squeal.config.json`:";
- step 2 (was 1): "where the primer says no test group runs after each edit, nothing ran: use `squeal run <group> <path>... --wait 60000`" becomes "where `squeal checks` shows no check that runs after each edit, nothing ran: use `squeal run <check> <path>... --wait 60000`" (the seed has no such clause);
- step 7 (was 5): "Done when the suites the primer does not list have run as the repository says" becomes "Done when what `squeal checks` says Squeal does not run has run as the repository says";
- the Codex and Pi CLI line, and the short `plugins/codex` copy: "run the command the SQUEAL primer names" becomes "run the command the SQUEAL messages name". The `skill` form names the CLI in its sentences, or with "These are commands of the CLI SQUEAL messages name.", and every FAIL report's last line names it;
- beyond the brief, the references: in `commands.md`, "Use it where the primer says no test group runs after each edit:" becomes "Use it where `squeal checks` shows no check that runs after each edit:". In `reports.md`, the glossary's "**revision**: as the SQUEAL primer defines it; not a git commit." points to a definition the `skill` form no longer gives, so it becomes "Squeal's number for each saved change to this worktree's files; every result names the revision it ran at. Not a git commit." No copy of the skill or its references names "primer" after the patch.

**Copies.** As for E and F: the steps are in `plugins/claude-code`, `plugins/codex-runtime`, `plugins/pi` and the Codex seed (min 4, 3 where the seed lacks the text). The description is in all five copies (min 5), the short `plugins/codex/skills/squeal/SKILL.md` included. On a copy of 86fd6c9ce's plugin tree, whose skill files equal main's and are not changed by W1, every patch matched exactly its minimum: `primer-skill` `[25,5,4,4,3,4,4,4,4,4,4,4,3,4,4,4,3,4,4]`, `primer-skill-noproof` the same without the last 4. The commit under test is not built yet: the test checks the switch on a text that holds `var PRIMER_FORM = "full";`, the line W1's build writes in 25 bundles.

**Commands** for the staged full check, from a checkout holding these variant files, with `C` the new commit under test. First Sonnet, then Sol:

```sh
node evals/bin/run-baseline.mjs --atomic --commit C --variant primer-skill --models claude-sonnet-5-5 --repetitions 10
node evals/bin/run-baseline.mjs --atomic --commit C --variant primer-skill --models gpt-6.1-sol --repetitions 10
```

Each run is 12 scenarios × 2 arms × 10 = 240 sessions. With `primer-skill-noproof`, replace the variant's name. The two runs of one variant pool through `atomic-compare.mjs <sonnet file> <sol file>`, which keeps each model in its own table.
