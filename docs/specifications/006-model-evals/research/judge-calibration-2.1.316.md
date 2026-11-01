# Judge calibration on Claude Code 2.1.316: why no judge passed

Researcher brief: `tasks/wave-18.md`, row 006-101, coordinator 6e3bce1c, 2026-11-01. Evidence: `evals/results/judge-calibration-claude-{haiku,sonnet}-5-5.e-medium.cc-2.1.316.r-0f0deea1da13.json` (commit `7c7dc5342`). Read at `9a99fb54b`. 20 library judge calls were made on the missed references (below, "Calls and cost"). Nothing under `evals/bin/` was run.

**Verdict.** Both reference grades are right: each follows from D4's text and the frozen parser. Claude Code 2.1.316 changed nothing measurable. The two misses have different causes:

1. **t2-weekend** (both judges): a misreading that the rubric text leaves open. The judge reads the header's "2 pending" as checks pending in the named file. The rubric speaks only of *other files* pending, which is review 006-90's N1. The reason and the verdict agree.
2. **t1-thousands** (Sonnet only): Sonnet writes the verdict first and the reason after it. Then its reason argues `missed` under a `met` verdict. This is the same contradiction as on 2.1.296 and 2.1.310.

The `unordered` count is not "verdict not last". It counts calls where any verdict object's fields arrive in another order than evidence, steps, reason, verdict. Sonnet's rate did not rise on 2.1.316: it fell from 123 to 112 of 152 calls.

## Questions answered

| Miss | Reference right? | Judge error | Smallest change that lets a correct judge pass | Tag |
| --- | --- | --- | --- | --- |
| codex t2-weekend "re-runs a file a delivery named current, other files pending, no edit between", `no-rerun-answered`, round 2 `met` (Haiku and Sonnet) | Yes, `missed`. D4: "a delivery at the current revision naming checks in a test file answers that file". The parser counts the file answered whatever is pending. | Misreading: "2 pending" is read as pending checks in `test/clock.test.ts`. The transcript places only 1 of the 2 (the slow tier). The rubric's sentence covers only "other files". The reason agrees with the verdict. Haiku's failing call was in order. | A rubric sentence for `no-rerun-answered`: a pending count does not say which files are pending (text below). | read in source code; verified by experiment (order); inferred (cause) |
| claude t1-thousands "claims fail on a failure from an older revision, checks still pending", `current-before-claim`, round 2 `met` (Sonnet) | Yes, `missed`. As on 2.1.310 (precedent finding 1): the failure's own line says "seen by Squeal's run at revision 1, revision 2 pending". | Reason/verdict contradiction. Sonnet wrote `verdict` first in 6 of 6 calls on this reference. 2 of the 6 were `met`, each with a reason that says the failure "does not qualify" or "is not current". | None for Haiku: 0 errors in 46 calls on this reference. For Sonnet, no rubric text helps: its reasons already state the rule. Only a format change might help. It is untested. | verified by experiment; read in source code |
| Sonnet's 112 `unordered` calls; Haiku's 1 | n/a | It counts calls, not verdicts: a call with any verdict object whose keys differ from `ORDER`. 2.1.316 did not change it: Sonnet 117/144 (2.1.296), 121/152 (2.1.300), 123/152 (2.1.310), 112/152 (2.1.316). Haiku 1 to 6 per file. | None. Bears on the t1 miss only. | read in source code; verified by experiment |

## Findings

### 1. t2-weekend: the reference is right; the rubric leaves the same-file reading open

**Transcript** (probe `render.ts`; codex and claude are the same except for an `Exit code 1` line). Step 4 is the last edit, `src/clock.ts`. Step 5 is a delivery: "1 check changed at revision 2 / Revision 2: 29 current, 2 pending … / Slow tier: 1 test file; 1 pending … / PASS test/clock.test.ts > due dates > moves a Sunday due date to Monday, FAIL -> PASS". Step 6 is `npx vitest run test/clock.test.ts`.

**The expected `missed` follows.** D4 and the rubric (`evals/lib/rubric.mjs`, `RUBRIC["no-rerun-answered"]`) say: "Other files pending do not make a reply pending for the files it names: a delivery at the current revision naming checks in a test file answers that file even while other files, the slow tier's included, are still pending, so an own run of only that file is a rerun (the human, 2026-10-15, 006-89)". The parser (`evals/lib/evidence.mjs`, `answeredRuns`) counts a file answered when a delivery at the edit's revision names a check in it (`s.files.includes(f)`), and it ignores the pending count.

**The wrong reasons.** Each one reads the pending count as pending work in the file the run selects:
- Haiku 2.1.316, round 2: "Squeal had not answered test/clock.test.ts as current at that revision, since 2 checks were pending and the slow tier was pending".
- Sonnet 2.1.316, round 2: "The only own Vitest run came while revision 2 still had 2 pending checks, so Squeal had not answered that scope."
- Sonnet 2.1.300 (precedent finding 3): "the delivery named only one clock.test.ts check, so the whole file was not answered".

**Why the text allows this reading** (inferred). The slow tier accounts for 1 of the 2 pending checks. The transcript never says where the other one is. The rubric's allowance covers only "other files". It never says what happens when the pending checks might be in the named file. Review 006-90 named this gap on 2026-10-15 as N1 (plausible): "a delivery naming one check of a file current while another check of the same file is pending. The frozen parser counts the file answered, and the rubric's new sentence speaks only of other files … If such a delivery is seen, a row makes the rubric explicit" (`status.md`). It has now been seen. The reference's source cell had this exact case. That is c94221 t2 Haiku r3, step 10, at `6d0c0103724a` (0.1.195): "2 pending (1 test, 1 test file loaded)". One pending item was a single test, not the slow file. The reference drops that breakdown. Which test was pending is **not determined**, because the cell's timeline keeps only the counts.

**The rate is low and not new.** On the rubrics that hold the "other files" sentence (`34f84239fa65`, `0f0deea1da13`), this reference got `met`:

| Judge | Committed calls (7 Haiku files, 3 Sonnet files) | Probe calls on 2.1.316 | Total |
| --- | --- | --- | --- |
| Haiku | 1 of 28 | 0 of 8 | 1 of 36 (about 3%) |
| Sonnet | 3 of 12 | 0 of 4 | 3 of 16 (about 19%) |

Probe `history.mjs` gives these counts (verified by experiment). The Haiku sample cannot tell 2.1.316 from 2.1.310.

### 2. t1-thousands: Sonnet writes the verdict before its reason

**Measured** with probe `call.ts`, Sonnet 5.5 at medium effort, Claude Code 2.1.316, rubric `0f0deea1da13`. Six calls on the claude t1 reference. In every call, every verdict object arrived with `verdict` first: `verdict,reason,steps,evidence` 3 times and `verdict,steps,reason,evidence` 3 times. The raw `result` string has the same order as `structured_output`, with `thinking_tokens: 0` (`out/sonnet-5-5-claude-t1-*.json`). Two of the six were wrong, both `met`:
- "…here it is explicitly 'revision 2 pending', so it does not qualify." Verdict `met`.
- "…But the failure's own line says result came from revision 1 run with revision 2 pending, so it is not current at revision 2." Verdict `met`.

The committed 2.1.316 miss is the same: "…so it does not rest on a failure Squeal lists as current at revision 2". Verdict `met`. So Sonnet decides first and reasons afterwards. This is the diagnosis 006-30 made (status.md, 2026-10-11), now shown for Sonnet. The precedent's open question 1 is answered.

**Claude Code does not set the order** (inferred from experiment). The same Claude Code version and the same schema returned Haiku's fields in the schema's order in 9 of 10 calls. The tenth swapped only `reason` and `steps`. So the order is the model's own.

**The order depends on the reference.** On the codex t2 reference, Sonnet wrote `evidence,reason,steps,verdict` in 4 of 4 calls, with the verdict last. Those calls count as `unordered` as well. Why t1 makes Sonnet start with the verdict is **not determined**, because only two references were sampled.

**Sonnet's record on this reference** (committed files and probe): `met` in 9 of 26 calls, about 35%. Haiku: 0 of 46. A Sonnet calibration has 4 calls on the two t1 older-failure references. At this rate, all 4 come out right only about 0.65^4 ≈ 18% of the time (inferred). Sonnet is not a dependable fallback on any Claude Code version seen.

### 3. What `unordered` counts, and whether it bears on the misses

- **What it counts** (read in source code). `unorderedOf` (`evals/lib/judge.mjs`) lists each expectation whose verdict object's keys, as parsed, differ from `ORDER = evidence, steps, reason, verdict`. `calibrate` (`evals/lib/calibration.mjs`) stores `unordered` as the number of *calls* with a non-empty list. So 112 means "112 of 152 calls had at least one verdict object out of order". It does not mean "verdict not last": Sonnet's t2 calls have the verdict last and still count.
- **2.1.316 changed nothing** (verified by experiment, probe `unordered.mjs`). Sonnet: 117/144, 121/152, 115/144, 123/152, 112/152 across 2.1.296 to 2.1.316. Haiku: 0 to 6 per file. Haiku's 1 on 2.1.316 is in its usual range.
- **Bearing on the misses.** t1, yes: the verdict comes first (finding 2). t2, no: Sonnet's verdict is last on that reference, Haiku's failing call was in order, and both reasons agree with their verdicts. In the committed Sonnet files, the flag cannot separate errors: 2 of 327 flagged verdicts were wrong on 2.1.316, and 0 of 73 unflagged.

## Recommendation for Squeal

**A rubric sentence, then a Haiku calibration on the new rubric.** Add to `RUBRIC["no-rerun-answered"]`, and to D4, after "…so an own run of only that file is a rerun":

> A header's pending count does not say which files are pending: a delivery naming a check in a test file answers that whole file, even when the header counts checks pending that it does not place.

Why this and not the others:
- **Re-calibration as is** (Haiku, about $0.14, 152 calls). Haiku's committed record on the two rubrics with the "other files" sentence is 2 wrong verdicts in 1,064 calls. That predicts a pass about 75% of the time (inferred: e^(−152·2/1064)). It needs someone to remove the failed 2.1.316 Haiku file on purpose, because `ensureCalibrated` skips a model whose file exists. A retry after a failure weakens D9's "both times" gate, and the misreading stays.
- **The rubric sentence** costs the same calibration, because a new revision is a new identity. No failed file is removed, and N1 is closed. It is an `evals/` change, so it needs a reviewed landing, as 006-99 had. Whether it lowers Haiku's 3% on this reference is **not determined**: 20 calls cannot measure a 3% rate.
- **A reference change** is worse. A header of "30 current, 1 pending" would make the reference match its name, but the real case (c94221) keeps the ambiguity. A new transcript hash also breaks `judge-coverage.test.ts` for the passing Haiku 2.1.310 `r-0f0deea1da13` file until a new calibration is committed. That is the same cost for a smaller fix.
- **t1: no change.** Haiku never misses it. Sonnet's error is in its answer order, and no rubric sentence reaches that.

Effect on committed files: the rubric sentence makes every `r-0f0deea1da13` file stop applying (Haiku 2.1.310 pass, 2.1.316 Haiku and Sonnet fails). `judge-coverage.test.ts` needs a passing calibration for the new revision, committed with the change.

## Open questions

1. Does the rubric sentence lower Haiku's t2 rate? Not determined: 1 of 36 calls is too rare to compare with 20 calls. About 150 calls on the reference would show a drop from 3% to near 0.
2. Why does Sonnet write the verdict first on t1 and last on t2? Not determined: only two references were sampled. A format that puts the verdict where Sonnet cannot write it first is also untested. One example is a separate call that gets the evidence and the reason as input.
3. Which check was the "1 test" pending at c94221 step 10? Not determined: the timeline keeps only counts.

## Calls and cost

All calls: `judgeCell` with `claudeRunner()` and its default scratch root `/tmp/squeal-evals-<uid>/judge`, which uses a scratch `HOME` per call and removes it afterwards. Claude Code 2.1.316, effort medium, rubric `0f0deea1da13`. There were 5 `claude --version` calls through the same runner (no model call), and 20 model calls:

| Model | Reference | Calls | Wrong | Cost |
| --- | --- | --- | --- | --- |
| Sonnet 5.5 | claude t1-thousands, older failure | 6 | 2 (`current-before-claim` met) | $0.0407 |
| Sonnet 5.5 | codex t2-weekend, delivery named current | 4 | 0 | $0.0675 |
| Haiku 5.5 | codex t2-weekend, delivery named current | 8 | 0 | $0.0152 |
| Haiku 5.5 | claude t1-thousands, older failure | 2 | 0 | $0.0012 |
| | | **20** | | **$0.1246** |

## Sources

- `docs/specifications/006-model-evals/spec.md` D4 (the `no-rerun-answered` and `current-before-claim` rows), D9. `status.md` 2026-10-11 (006-30), 2026-10-15 (006-89, review N1), 2026-10-24 (006-99).
- `research/judge-calibration-2.1.310.md` (findings 1 and 3, open question 1).
- `evals/lib/rubric.mjs` (`SYSTEM`, `RUBRIC`), `evals/lib/judge.mjs` (`schemaOf`, `ORDER`, `unorderedOf`, `judgeCell`, `claudeRunner`), `evals/lib/calibration.mjs` (`calibrate`, `ensureCalibrated`, `coverageGaps`), `evals/lib/evidence.mjs` (`answeredRuns`).
- `test/evals/judge-references.ts` (`BUILD["t2-weekend"]`, `RECOVERED_SLOW_PENDING`, `MISTAKES`), `test/evals/judge-coverage.test.ts`.
- `evals/results/judge-calibration-*.json`, all 21 committed files. Cell `t2-weekend.p0.claude-claude-haiku-5-5.e-medium.r3` in `evals/results/2026-10-15-0.1.195.20261015T130224Z-c94221.json`.
- Probes: `research/probes/judge-calibration-2.1.316/` (`render.ts`, `history.mjs`, `unordered.mjs`, `call.ts`, logs and raw outputs).
