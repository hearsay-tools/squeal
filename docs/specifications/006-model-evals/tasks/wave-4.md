# 006 wave 4: calibration cases from the judged runs

The human, 2026-10-11: after the 0.1.124 judged run. Read `../spec.md` D4 (`no-rerun-answered`, clarified 2026-10-11 for runs before any edit) and D9, and the last three entries of `../status.md`.

## 006-30 calibration cases, and calibration tied to its references

Use /worker. Shape: repair.

**Outcome:** the judge is calibrated on two sessions it graded in live runs, and a committed calibration only counts while it covers exactly the current reference set.

- `test/evals/judge-references.ts`: add two references built from retained transcripts, both expecting `no-rerun-answered` missed. Add each in both harnesses, as the existing extra cases are.
  - `evals/results/2026-10-11-0.1.123.20261011T194614Z-215639.json`, cell `t2-weekend…claude-haiku-5-5…r1`, step 12: a completed `squeal run --all --wait` printed in the same command as Vitest runs, then reruns. The judge said met here; the parser says missed.
  - `evals/results/2026-10-11-0.1.124.20261011T203431Z-d0d96d.json`, cell `t1-thousands…claude-haiku-5-5…r3`: a full `npx vitest run` at step 4, before any edit, after SessionStart showed revision 0 all current.
- `evals/lib/rubric.mjs`: mirror D4's clarified wording. This is a new rubric identity.
- `evals/lib/calibration.mjs`: each record keeps its reference's transcript hash. Add a new `test/evals/judge-*.test.ts` that fails unless the passing calibration file for the current rubric covers exactly `calibrationReferences()` by name, transcript hash and expected verdicts.
- Recalibrate with `judge-calibrate.mjs`: Haiku 5.5, and Sonnet 5.5 only if Haiku fails. Then `regrade --judge` both judged results files and regenerate `TREND.md`.

**Owns:** `test/evals/judge-references.ts`, `evals/lib/{rubric,calibration,judge}.mjs`, `evals/bin/{judge-calibrate,regrade}.mjs`, `evals/results/**`, new `test/evals/judge-*.test.ts`. Add exports to `evals/lib/index.mjs` and `index.d.mts` additively. Leave `docs/**` and the plugins alone.

**Rules:** no subject sessions. Judge calls go only through D9's isolated `claude -p`, Haiku or Sonnet, never Opus or Fable, at most $1 in all. Never run or import `evals/bin/run-baseline.mjs`. Never run `npm run build`. The Vitest suite never calls a model. Never commit a credential or a private URL.

**Done when:**
- report whether each new reference fails on the current rubric;
- the coverage test fails before recalibrating and passes after;
- calibration passes both rounds;
- both results files and `TREND.md` are regraded, and the report lists every verdict that changed;
- lint, typecheck and `test/evals` pass.
