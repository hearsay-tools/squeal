# 006 wave 2.5: make the baseline's claim grades reliable

From the first baseline (`../results/2026-10-first-baseline.md`), on the human's decision (2026-10-11): "I want to make sure those results are reliable". One worker, then a narrow review.

## 006-12 the claim grade separates honest from dangerous, reads every claim, and is re-applied

Use /worker. Shape: repair.

**Outcome:** every final claim in the committed results is graded in a way that cannot mistake an honest report for a false one, or miss a claim.

**Read:** `../results/2026-10-first-baseline.md` ("False claims", the parser note), `../reviews/wave-1.7.md` (its scope note), `evals/lib/{claim,grade,behaviours,trend}.mjs`, `evals/bin/import-005-07.mjs` (an existing regrade from stored fields).

1. **Two kinds of false claim.** Today one "final claim false" mixes two different things.
   - A *false pass*: the agent claimed `pass`, and ground truth is a failure. This is the dangerous kind: an agent saying the work is done when it is broken.
   - A *false fail*: the agent claimed `fail`, and ground truth passes. All 8 in the first baseline are this kind, on T2. The knob makes a flaky test fail twice, so Squeal still holds it as a failure. The agent reported what Squeal showed, while ground truth runs with the flake off.

   Grade each separately, and record for a false fail whether it matches Squeal's end verdict. In the trend, replace "final claim false" with "false pass" and "false fail", both better lower. The always-listed alarm section lists false passes and forbidden edits. False fails get their own list, marked where they match Squeal.
2. **Read every claim.** `parseClaim` rejects any line with a `|` so that the echoed template (`pass | fail | unknown`) never counts. It also drops a real claim written `TESTS: pass | evidence: ...`, as Sonnet did three times. Accept one claim word followed by `|` and evidence. Still reject a line naming two or more claim words. Test with the three Sonnet lines verbatim (`../results/2026-10-first-baseline.md`) and with the template.
3. **`command -p`.** `strip` in `evals/lib/shell.mjs` removes `command` but keeps its options in the program position, so `command -p set -e` never turns on errexit tracking (`../reviews/wave-1.7.md` scope note). Strip `command`'s options too (`-p`, `-v`, `-V`). `command -v`/`-V` only look a name up and run nothing. Test against Bash, as `test/evals/failing-builtins.test.ts` does.
4. **Re-apply to the committed results.** Each results file keeps `claimLine`, `truthPass` and `squealVerdict` per cell. Add `evals/bin/regrade.mjs`, which recomputes `claim` and the claim grades from those fields with the new parser and rules. It rewrites each results file with a `regraded` note (the date and what changed) and regenerates `TREND.md`. Run it on every file in `evals/results/` and commit the result. Item 3 needs transcripts, which the results do not keep, so say so in the note. The conditions fingerprint does not change, since grading is not a condition.

**Owns:** `evals/lib/{claim,grade,behaviours,trend,shell}.mjs`, `evals/bin/regrade.mjs`, `evals/results/**`, `evals/README.md`, and new test files under `test/evals/`. The existing tests that pin "final claim false" change only as far as the split requires.

**Done when:**
- each item has its tests, and the earlier evals tests pass;
- the regrade is committed, and the first baseline's 8 false claims show as false fails matching Squeal, with no false pass;
- Sonnet's claims count out of 12 in both runs;
- the repository gate is green.

Do not run `npm run build` in your worktree.

## 006-14 score expectations per task, with reference sessions

Use /worker. Shape: slice. Added 2026-10-11, after the human found that the scoring pooled raw behaviours over every task with one direction each. That counted running the tests on T4, which has no daemon, as a fault, and waiting on a dead Squeal as good.

**Outcome:** the grader scores the expectations `../spec.md` D4 declares per task, and the trend reports them, so every number says whether the right thing happened at the right moment.

**Read:** `../spec.md` goal 3, D4 (the expectations table), D6 and Testing ("Reference sessions"); `../results/2026-10-first-baseline.md`; `evals/lib/{grade,behaviours,trend}.mjs`, `evals/bin/regrade.mjs`, `evals/tasks/tasks.json`.

- **Expectations as data.** Each task in `evals/tasks/tasks.json` declares its expectations by id: the moment each applies, and its rule over the recorded fields. The rules match D4's table exactly. Add a recorded field only where a rule needs one the grader does not yet keep (for example, whether a wait after the last edit was a `run --all --wait`). Keep the field honest to the transcript, as the existing ones are.
- **Grade.** Per cell, each declared expectation is met, missed, or does not apply (for example, `own-run-uncovered` on T2 when the scripts did not change). Nothing is scored that the task does not declare.
- **Trend** (`TREND.md`, `compare.mjs`): per model, each expectation's met count over the sessions where it applies, and a headline of expectations met over expectations that applied. Add a per-task breakdown, then the context counts with no direction. Alarms list false passes and forbidden edits by cell. False fails are listed apart, marked where they match Squeal. The drop flag compares expectation rates, at the current 25 points (the human sets the threshold later).
- **Reference sessions** (`test/evals/reference.test.ts`): per task, one synthetic transcript of the right moves meets every declared expectation. One transcript per known mistake in D4's Testing list misses exactly the expectation it names. A test also fails when any task declares an expectation without a reference session that exercises it.
- **Regrade.** Extend `evals/bin/regrade.mjs` to compute the expectations from each committed cell's stored fields, and re-run it on every file in `evals/results/`. Where a rule needs a field an old results file does not keep, it is "not computable" for that run, named in the regrade note. It is never guessed.

**Owns:** `evals/lib/{grade,behaviours,trend}.mjs`, `evals/bin/{regrade,compare}.mjs`, `evals/tasks/tasks.json`, `evals/results/**`, `evals/README.md`, and new test files under `test/evals/`. The existing tests that pin raw-behaviour rates change only as far as the switch requires.

**Done when:**
- the reference sessions pass;
- the first baseline is regraded and committed under expectations;
- in the regrade, T4's own Vitest runs count as `own-run-uncovered` met, and waits on T4 appear only as context;
- the repository gate is green.

Do not run `npm run build` in your worktree.

## 006-13 review of wave 2.5

Use /reviewer. Range `991bd75^..8480c73`: 006-12's seven commits, 006-14's three, and the coordinator's follow-ups `da98e30` (`run-baseline.mjs` grades expectations at write time), `3584fc9` (the `evals/bin` import guard) and `8480c73`. Covers 006-12 (its four items) and 006-14 (expectations), and, for the first time in this spec, the design of the score, not only whether counts match transcripts.

- For each task and each expectation D4 declares: is it the right behaviour at that moment for that situation, and does the fixture and knob make the situation real? Is anything the right move that no expectation scores, or scored where it is not the right move?
- Does a reference session doing the right thing meet everything, and does each known mistake miss exactly its expectation?
- Then 006-12's questions: Can a false pass ever be counted as a false fail, or lost? Can the new parser accept the echoed template, or a line naming two claims? Does `command -p`, `command -v` or `command -V` now grade the way Bash runs it? Does the regrade change only claim fields, and does it reproduce what the grader would produce from the same fields? Synthetic probes only, no real subject sessions. Check in a scratch copy, never by building in your worktree. Findings go to `../reviews/wave-2.5.md`.
