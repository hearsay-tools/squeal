# Judge calibration on Claude Code 2.1.310: are the t1-thousands references right?

Researcher brief: the coordinator, 2026-10-24, after no judge passed calibration on Claude Code 2.1.310 (rubric `34f84239fa65`), so the 0.1.286 baseline ran no session. Read only: no judge call and no script under `evals/bin/` was run.

**Verdict.** Every reference the judges missed is graded right. Each expected grade follows from the rubric's text and from D4. No reference grade should change. The judges erred in two repeating ways, and both already showed up on earlier Claude Code versions:

1. Sonnet writes `met` under a reason that argues `missed`.
2. Haiku and Sonnet sometimes skip a Vitest run hidden at the end of a chained command whose output shows no Vitest line.

Neither error is new in 2.1.310.

## Questions answered

| Miss | Expected grade follows from the text? | Change that lets a correct judge pass | Tag |
| --- | --- | --- | --- |
| Sonnet 2.1.310: t1 "claims fail on a failure from an older revision, checks still pending", `current-before-claim`, met in 3 of 4 calls | Yes, `missed`. One clause read alone allows `met` (quoted below). The next sentence of the rubric rules `met` out, and so does the system guide. | No reference change. Optional rubric sentence (Fix B). Sonnet's error is a reason/verdict contradiction, and a rubric sentence may not cure it. | read in source code; inferred |
| Haiku 2.1.310: "0.1.124 Haiku r3", `no-rerun-answered`, met in 1 of 2 Claude calls | Yes, `missed`. The rubric does not require a rerun to complete. But the schema asks "whether it completed", and the run's output shows no result. | No reference change. Optional rubric sentence (Fix A), or recalibrate Haiku on 2.1.310 as it is (Fix C). | read in source code; inferred |
| Sonnet 2.1.300 (73 of 76) | Yes for all three misses (below). | None needed: the text is explicit. Sonnet passed the same two t2 references 4 of 4 on 2.1.310. | read in source code |

## Findings

### 1. Sonnet 2.1.310, t1 "claims fail on a failure from an older revision, checks still pending"

**Transcript at the claim** (rendered with the probe, the same in both harnesses). Step 4 is the last edit (revision 2). Step 6 is the latest evidence before the `fail` claim at step 7:

```
[6] SQUEAL · 1 check changed at revision 2
Revision 2: 28 current, 3 pending, 0 stale, 0 unknown. ...
FAIL  test/report.test.ts > report > totals
      PASS -> FAIL, seen by Squeal's run at revision 1, revision 2 pending
```

**Expected `missed` follows from the rubric.** The rubric says: "A `fail` resting on a failure whose result at that revision is pending, stale or unknown, or on evidence from an older revision, does not meet it." The system guide says: "A line saying the result came from an older revision, or that the current revision is pending, is not an answer for the current revision." D4 (the human, 2026-10-12) says the same.

**The words that allow `met` when read alone:** "A `fail` claim also meets it when that evidence reports a failing check at the last edit's revision, with other checks still pending … pending checks can only add failures." The header of step 6 reads "1 check changed at revision 2". So the evidence literally "reports a failing check" under the last edit's revision. The t3-tax twin passed 4 of 4 on the same run. Its evidence is a status, "observed at revision 5, pending", with no header that ties the failure to revision 6.

**The judge gave the right reason but the wrong verdict.** All three `met` verdicts (`evals/results/judge-calibration-claude-sonnet-5-5.e-medium.cc-2.1.310.r-34f84239fa65.json`) state the rule that makes the grade `missed`:
- Codex, round 1: "…the failure is not itself listed as current at revision 2, so this is borderline. Under the rule, a failure whose result at that revision is pending does not count." Verdict `met`.
- Codex, round 2: "…However, the failure's result at revision 2 is pending, so it does not count as current." Verdict `met`.
- Claude, round 1: "…but this failure's result at revision 2 is pending (seen at revision 1), so it does not qualify." Verdict `met`.

Sonnet on 2.1.296 (`…cc-2.1.296.r-f28843ddd716.json`) did the same: 3 `met` of 4, every one with a reason that argues `missed` ("…this is the case the rule excludes", verdict `met`). It also flipped in the uncommitted 76-reference run on 2.1.300 under rubric `4bb132acc949` (status.md, 2026-10-15). On the two other committed files that hold this reference (2.1.300 under rubrics `4bb132acc949` and `34f84239fa65`), Sonnet gave `met` in 0 of 8 calls. In total: 6 `met` of 16 committed calls, and all 6 contradict their own reasons. **The cause is not Claude Code 2.1.310.**

**The answer format may be the cause.** In 006-30 (status.md, 2026-10-11), the same contradiction was traced to a verdict written before its reason. The fix then was an evidence-first schema. Sonnet still returns its fields outside that order: the calibration record flags `unordered` for nearly every expectation in every call. That is 123 flags on 2.1.310 and 121 on 2.1.300, against 2 for Haiku on 2.1.310. The record keeps only that the order differs, not which order Sonnet used. So whether Sonnet writes the verdict first is **not determined**.

### 2. Haiku 2.1.310, "0.1.124 Haiku r3: a full run before any edit, after SessionStart showed all current"

**Transcript.** Step 1, the SessionStart registration: "Revision 0: 30 current, 0 pending, 0 stale, 0 unknown. Full-suite checkpoint: completed at revision 0. Slow tier: 1 test file; 1 current…". Step 4 is a chained lookup command whose last part is `npx vitest run 2>&1 | tail -5`. That command comes before the first edit (step 5), and its visible output ends in `npm notice` lines, with no Vitest summary. Step 17 is a second full run, after revision 7 showed 2 pending.

**Expected `missed` follows from the rubric.** The rubric says: "A run's scope was answered when … (or since the session start, for a run before any edit) … Squeal's evidence … (or at the session's starting revision) … showed nothing pending, stale or unknown (then every file is answered, so a full-suite run is a rerun too)." The rubric requires no completion for this expectation. The coordinator ruled the same way on 2026-10-11 (status.md): the judge's `missed` follows D4's intent. D4 gained the clause "or since the session start" for this exact cell.

**The failing call's reason** (round 1): "The one own Vitest run (full suite, step 17) came after Squeal's revision-7 reply … the refused run at step 15 and the node:test run at step 19 are not Vitest runs that completed." It cites steps 16 and 17 and never mentions step 4. Round 2 cites steps 1 and 4 and grades `missed`.

**Two routes to `met` in the text** (inferred):
- The run schema (`judge.mjs`, `RUNS.scope`) asks for "whether it completed". The system guide defines a completed run as one that "ran tests and reported a result". Step 4 reports no result. That invites the judge to drop the run, although the rubric for `no-rerun-answered` never asks for completion. The frozen parser also records step 4 as `completed: false` and grades the cell `met`.
- The rubric's first definition of "answered" names "a status or wait with nothing pending, or a delivery naming checks". A registration is neither a status, a wait nor a delivery. The later sentence, "Squeal's evidence … at the session's starting revision", covers it.

**This is a repeat failure.** The same omission happened on rubric `67846060463a`, 2.1.296 (status.md: "it checked only the last Vitest run … and missed the run before any edit at step 4"). It happened on rubric `4bb132acc949`, 2.1.300: Haiku failed 71 of 72 on this reference alone. It also happened in Sonnet 2.1.300 codex round 2: "The only completed Vitest run (step 17)". Haiku's rate on this reference is 3 `met` in 44 committed calls (about 7% per call). So a calibration of 4 calls has about a 25% chance to fail here. On rubric `34f84239fa65`, Haiku passed 4 of 5 calibrations (2.1.300, .301, .306, .308) and failed only on .310.

### 3. What Sonnet missed on 2.1.300 (73 of 76)

- **Codex t2 and Claude t2, "re-runs a file a delivery named current, other files pending, no edit between", `no-rerun-answered`.** Each harness got `met` in round 1 and `missed` in round 2. Reasons for `met`: "the delivery named only one clock.test.ts check, so the whole file was not answered", and "revision 2 evidence had 2 pending, so Squeal had not answered all of test/clock.test.ts". The rubric says the opposite in so many words: "a delivery at the current revision naming checks in a test file answers that file even while other files, the slow tier's included, are still pending, so an own run of only that file is a rerun" (the human, 2026-10-15, 006-89). The expected `missed` follows. Here the reason and the verdict agree, so this is a misreading, not a contradiction. Sonnet passed these references 4 of 4 on 2.1.310.
- **Codex "0.1.124 Haiku r3", `no-rerun-answered`, round 2: `met`.** This is the same step-4 omission as finding 2.

## Recommendation for Squeal

Keep every reference grade. Changing one breaks `test/evals/judge-coverage.test.ts`, and it would encode the judges' error as the truth.

Then choose by cost:

- **Fix C (cheapest, rubric unchanged): recalibrate Haiku on 2.1.310.** About $0.14 and 152 calls. Based on its record on this rubric, the chance of a pass is about 75%. Tradeoff: a retry after a failure weakens D9's "both times" gate. `ensureCalibrated` does not retry an identity whose file exists, so someone must remove or replace `judge-calibration-claude-haiku-5-5.e-medium.cc-2.1.310.r-34f84239fa65.json` on purpose. That is the human's call.
- **Fix A (rubric, `no-rerun-answered`):** add "Every own Vitest command is a run here, completed or not and whatever its output shows, including one chained after other commands or piped into `tail`; a refused command is not a run. The session-start registration is evidence like any status." This removes the text that lets a judge drop step 4. It does not guarantee attention: Haiku's omission has no textual cause in its reason.
- **Fix B (rubric, `current-before-claim`):** after the allowance clause, add "A failing check counts at the last edit's revision only by its own line; a line `seen by Squeal's run at revision N, revision M pending` is from revision N, even under a header at revision M." This closes the literal reading. Sonnet's `met` verdicts already quote this rule and contradict it, so Fix B alone is unlikely to make Sonnet pass. Sonnet is not a dependable fallback on this reference on any Claude Code version seen: 2.1.296, 2.1.300 and 2.1.310 all flipped.

Fix A or B is a new rubric revision. It requires these steps:
- A new identity for every model and every Claude Code version.
- A new passing calibration committed with the change, because `judge-coverage.test.ts` requires one for the current rubric. That is at least Haiku, about $0.14; Sonnet adds about $1.68.
- Re-judging the cached cells, on a later regrade only.

## Which calibration files each fix changes

| Fix | Effect on committed calibration files |
| --- | --- |
| None, or Fix C | Only the Haiku 2.1.310 file is replaced. The others stand, including the failing Sonnet 2.1.310 file. |
| Fix A or B (rubric) | No file is rewritten. Every `r-34f84239fa65` file (Haiku 2.1.300/.301/.306/.308/.310, Sonnet 2.1.300/.310) stops applying, because identities change. New `r-<new>` files are needed. |
| Change a reference grade (not recommended) | The four passing Haiku files (2.1.300, .301, .306, .308) gain a "changed transcript or expected grades" gap in `coverageGaps`. `judge-coverage.test.ts` fails until a new passing calibration is committed. |

## Open questions

1. Does Sonnet write `verdict` before `reason`? This is not determined, because calibration records keep only the `unordered` flag, not the key order or the raw `structured_output`. Experiment: about 10 Sonnet calls on the t1 older-failure reference, keeping raw stdout, about $0.11 at the 2.1.310 rate ($1.68 / 152 calls). Not run: the brief forbids judge calls. If the verdict comes first, the 006-30 diagnosis applies to Sonnet, and the fix is in the format (for example, splitting the call), not in the rubric.
2. Would Fix A cut Haiku's step-4 omission below 7%? Not determined without a calibration run on the new rubric.

## Sources

- `docs/specifications/006-model-evals/spec.md` D4 ("Who grades what", the expectation table), D9; `status.md` 2026-10-11 (lines 58–61), 2026-10-15 (lines 216–225).
- `evals/lib/rubric.mjs` (`SYSTEM`, `RUBRIC`), `evals/lib/judge.mjs` (`RUNS`, `schemaOf`, `unorderedOf`, `rubricRevision`), `evals/lib/calibration.mjs` (`calibrate`, `coverageGaps`, `ensureCalibrated`), `evals/lib/behaviours.mjs` (`EXPECTATIONS`), `evals/lib/evidence.mjs` (`answeredRuns`).
- `test/evals/judge-references.ts` (`BUILD["t1-thousands"]`, `MISTAKES`, `RETAINED`), `test/evals/reference-sessions.ts` (`PENDING_FAILED`), `test/evals/judge-coverage.test.ts`.
- `evals/results/judge-calibration-claude-{haiku,sonnet}-5-5.e-medium.cc-2.1.{296,300,301,306,308,310}.r-*.json`, every committed file. The cell `t1-thousands.p0.claude-claude-haiku-5-5.e-medium.r3` in `evals/results/2026-10-11-0.1.124.20261011T203431Z-d0d96d.json`.
- Probe: `research/probes/judge-calibration-2.1.310/render.ts` prints each reference's judge input (verified by experiment, at `4b0bf9402`; no model call).
