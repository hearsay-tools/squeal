# Wave 18: why no judge passes calibration on Claude Code 2.1.316 (row 006-101)

Coordinator 6e3bce1c, 2026-11-01. The human chose "A: researcher first" (decision card in task 6e3bce1c, 2026-11-01). The long baseline on `squeal--v0.1.387` ran no session: no judge passed calibration on Claude Code 2.1.316, rubric `0f0deea1da13` (commit `7c7dc5342`). Host policy as in `011-core/tasks/wave-60.md`. **Never run `evals/bin/*.mjs`, not even with `--help`: that starts a real run.** No real `claude` or `codex` session under the real HOME.

## 006-101

Use /researcher. Shape: research.

Outcome: one findings file that says, per miss, whether the reference grade is right, why the judge erred, and the smallest change that lets a correct judge pass, so the coordinator can choose between a rubric sentence, a reference change, or a re-calibration.

Evidence: `evals/results/judge-calibration-claude-{haiku,sonnet}-5-5.e-medium.cc-2.1.316.r-0f0deea1da13.json`. Haiku 75/76 and Sonnet 74/76. Each miss was right on the first call and wrong on the second:
- codex t2-weekend "re-runs a file a delivery named current, other files pending, no edit between": `no-rerun-answered` expected `missed`, second call `met` (both judges).
- claude t1-thousands "claims fail on a failure from an older revision, checks still pending": `current-before-claim` expected `missed`, second call `met` (Sonnet; the same miss as on 2.1.310, finding 1 of the precedent).
- New: Sonnet's file counts 112 calls "with a verdict not last" (`unordered`), Haiku's 1. Say what that counts, whether 2.1.316 changed the output order, and whether it bears on the misses.

Read: the precedent `research/judge-calibration-2.1.310.md` (method and its probe), spec 006 D4 and D9, `evals/lib/rubric.mjs`, `evals/lib/judge.mjs`, `test/evals/judge-references.ts`, row 006-99 (Fix A).

Method: read first. Judge calls are allowed only through the library with a scratch HOME as the judge itself builds it, on the failing references only, at most 20 calls in total, Haiku or Sonnet (never Opus or Fable); state each call and its cost.

Owns: `research/judge-calibration-2.1.316.md` and `research/probes/judge-calibration-2.1.316/`. Leave alone: `evals/` code, `test/`, results, the board, `spec.md`, `status.md`.

Done when: the findings file is committed alone, with one table row per miss (reference right?, judge error, smallest change, tag: read in source / measured / inferred) and a recommendation among: rubric sentence, reference change, re-calibration as is.

## R1: review of cand/006-101

Use /reviewer. Shape: review. Candidate `cand/006-101` at `f726f23dfa8621beee57a9f87afa18e252e7d271`: main `e4586d9fa` plus `ab0188ed8` (the rubric sentence of `research/judge-calibration-2.1.316.md`, its D4 line and the pinned rubric revision `b0f50dbca2e2`) and `f726f23df` (the passing Haiku calibration on Claude Code 2.1.316, the long baseline results `2026-11-01-0.1.387.20261101T092538Z-135e02.json` and `TREND.md`). CI run 41295016618.

Check: (1) the sentence says what the findings recommend, in `evals/lib/rubric.mjs` and spec 006 D4 alike, and changes no other expectation; (2) the calibration file is for this rubric revision and Claude Code version, passed, and `judge-coverage.test.ts` holds; (3) the results file and `TREND.md` come from the tooling unchanged (no hand edit), and the grades of the 0.1.387 run used the new rubric; (4) the one alarm, false pass `t2-weekend.p0.claude-claude-sonnet-5-5.e-medium.r3`, is shown, not hidden or accepted by any test. The coordinator reports it to the human; do not judge its cause. **Never run `evals/bin/*.mjs`, not even `--help`.** No full suite, no build. Write `reviews/006-101.md` with PASS or FAIL and commit it alone.
