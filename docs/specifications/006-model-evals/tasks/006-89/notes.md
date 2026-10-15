# 006-89 notes: a rerun of a file a delivery named current

## What changed

`test/evals/judge-references.ts`, T2's builder: two additive `Twist` fields.

- `slowPending`: the Sunday recovery at revision 2 arrives as c94221 Haiku r3's step 9 words it
  (`RECOVERED_SLOW_PENDING`): `PASS … moves a Sunday due date to Monday`, `FAIL -> PASS`, with
  `29 current, 2 pending` and the slow tier pending. Everything else in the session is the
  existing right moves (the flake delivery at revision 3 still has nothing pending).
- `rerunFile`: the file a `rerun` runs, `test/clock.test.ts` unless named.

New references, each built in both harnesses:

- MISTAKES, t2-weekend: "re-runs a file a delivery named current, other files pending, no edit
  between" (`{ slowPending, rerun }`): misses `no-rerun-answered` and only that.
- EXTRA, t2-weekend, the paired right move: "re-runs a file a delivery did not name, other files
  pending" (`{ slowPending, rerun, rerunFile: "test/report.test.ts" }`): meets every expectation.
  The set had no right move with a pending delivery and a rerun, so this pairs the mistake: same
  delivery, same moment, a file outside the named scope. I chose this pairing over "a rerun after
  an edit to `src/clock.ts`" because it differs from the mistake only in the scope, which is
  where the judge went wrong; the edit variant would also shift every later revision.

`test/evals/reference.test.ts`: the paired right move graded by the parser in both harnesses,
with a guard that its delivery really carries `2 pending`. The mistake is graded by the existing
MISTAKES loop. Both pass under the frozen parser (four new tests, codex and claude).

No rubric or `evals/lib` change. The retained c94221 cell itself is not added to `RETAINED`; the
brief asks for the mistake and its pair. Adding it later is one entry
(`2026-10-15-0.1.195.20261015T130224Z-c94221.json`,
`t2-weekend.p0.claude-claude-haiku-5-5.e-medium.r3`, misses `["no-rerun-answered"]`) and two
more references to calibrate.

## Expected failure until recalibration

One test fails, for this reason only:

- `test/evals/judge-coverage.test.ts > a calibration's coverage > is exact for the committed
  passing calibration of the current rubric`.

The current rubric is `4bb132acc949`. Its passing calibrations are
`judge-calibration-claude-haiku-5-5.e-medium.cc-2.1.296.r-4bb132acc949.json` and
`judge-calibration-claude-sonnet-5-5.e-medium.cc-2.1.300.r-4bb132acc949.json`
(`…haiku…cc-2.1.300…` did not pass and is not checked). Each holds 72 references; the set is now
76. Each reports the same four gaps, `missing:` for codex and claude × the two names above.
Vitest stops at the first file, so its message names the Haiku file only.

## Calibration identity

Unchanged. The identity is the model, effort, Claude Code version and rubric (006-30), and the
rubric revision is unchanged since no rubric or declaration changed. Only coverage changes: the
committed passing files no longer cover the reference set, so no judge identity counts as
calibrated until the coordinator recalibrates on the 76 references (four new sessions per round).
No existing reference's transcript or expected grades changed, so the other 72 records still
match.
