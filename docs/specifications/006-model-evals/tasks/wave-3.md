# 006 wave 3: the judge

The human, 2026-10-11: a hybrid judge for the four judged expectations, run through Claude Code. Read `../spec.md` D4 ("Who grades what") and D9, and `../reviews/wave-2.8.md`, whose B3 and N1 are the judge's first cases.

## 006-23 the judge, its calibration, the retained transcript

Use /worker. Shape: slice.

**Outcome:** `no-rerun-answered`, `own-run-uncovered`, `current-before-claim` and `no-overclaim` are graded by the judge D9 describes, calibrated on the reference sessions, with the frozen parser beside it as a cross-check.

- `evals/lib/judge.mjs`:
  - builds the rubric from D4's text and the verdict schema;
  - runs `claude -p` with D9's isolation, taking the runner as an argument;
  - validates the citations;
  - caches by transcript hash and judge identity.
- Each cell keeps the numbered, trimmed transcript D9 describes, secret-scanned. `run-cell.mjs` calls the judge after grading.
- `behaviours.mjs` takes the four from the judge's verdict. The parser's verdict is kept as `parser`, and `TREND.md` lists disagreements.
- `evals/bin/judge-calibrate.mjs` judges every reference session in both harnesses twice and writes `evals/results/judge-calibration-<identity>.json`. Run it with Haiku 5.5, and with Sonnet 5.5 if Haiku fails. Commit the result either way.
- Add reference sessions for `reviews/wave-2.8.md` B3 (the `|` exclusion, from its real output) and N1 (a `--config` exclusion), so the judge is calibrated on them.
- `regrade.mjs` re-judges from retained transcripts when the identity changes.

**Owns:** `evals/lib/{judge,behaviours,grade,results,evidence}.mjs`, `evals/bin/{run-cell,regrade,judge-calibrate}.mjs`, `evals/tasks/tasks.json`, `evals/results/**`, `evals/README.md`, and new test files under `test/evals/` named `judge-*`. Add export lines to `evals/lib/index.mjs` and `index.d.mts` additively.

**Rules:**
- No subject sessions.
- Judge calls only through D9's isolated `claude -p`, never with a real `HOME`, never Opus or Fable. Calibration costs well under a dollar.
- Never run or import `evals/bin/run-baseline.mjs`. Never run `npm run build` in your worktree.
- The Vitest suite never calls a model.
- Never commit a credential or a private URL.

**Done when:**
- unit tests cover the judge with a fake runner (citations, `cannot tell`, cache hits, isolation flags, schema);
- a calibration file is committed and its judge passes the gate, or the report says neither model passed;
- the repository gate is green.

## 006-24 review of the judge

Use /reviewer. Range `be6aaaf9^..9250fb4e`: 006-23's commits on main and the coordinator's 006-25 (`9250fb4e`, calibration as a step of every run). Also check that no unit test can reach a model. Review the design and the evidence, not parsing:
- Does each rubric say the right behaviour at the right moment for its task?
- Is the isolation real: no user plugins, hooks or memory reach the judge, and it has no tools?
- Can a judge verdict become `met` without cited evidence?
- Does the calibration file show the gate met, both times?
- Are disagreements with the parser listed and not hidden?

Is the rubric change between the failed (`c15eba47`) and passing (`ecc9d69f`) Haiku calibrations a real correction of the rule, or a fit to the one failing reference session? Check D9's calibration-per-run rule as specified (`run-baseline.mjs` wiring follows 006-23 as row 006-25). Spot-check five judge verdicts against their transcripts yourself. Probes may make at most 10 judge calls, in a scratch `HOME`. No subject sessions. Never run or import `evals/bin/run-baseline.mjs`. Findings go to `../reviews/wave-3.md`.
