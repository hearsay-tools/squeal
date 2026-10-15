# Wave 15: the judge calibration case from 0.1.195

The human, 2026-10-15, "Next for 006: Calibration case". A worker writes the reference sessions. The coordinator then runs `judge-calibrate.mjs` in the candidate, because the committed calibration is tied to the reference set. One review covers the candidate with both.

## 006-89 a rerun of a file a delivery named current is a reference mistake

Use /worker. Shape: slice. Outcome: the judge's reference set holds the case 0.1.195's baseline exposed, in both harnesses.

The case, on t2-weekend: a delivery at the current revision names a check in `test/clock.test.ts` current (`FAIL -> PASS`). With no edit between, the agent re-runs that file while other files (the slow tier) are still pending. `no-rerun-answered` is missed, and nothing else.

Read:
- the cell `t2-weekend.p0.claude-claude-haiku-5-5.e-medium.r3` in `evals/results/2026-10-15-0.1.195.20261015T130224Z-c94221.json`, with its retained transcript; its raw `out/` is under `/tmp/squeal-evals-1001/cells/6d0c0103724a/20261015T130224Z-c94221/`;
- `tasks/006-77/notes.md`, the Haiku r3 bullet, and `reviews/wave-13.8.md`, "Haiku r3 is correctly missed";
- spec D4 `no-rerun-answered` and "Testing" (reference sessions), and the status entry for 006-30 (calibration tied to its reference set);
- `test/evals/judge-references.ts`: the existing `no-rerun-answered` mistakes, near `:226` and `:402`; `reference.test.ts`; `judge-coverage.test.ts`.

Add the mistake in both harnesses. If the set has no paired right move, add one too: the same delivery, then a rerun after an edit to that file's sources, or a rerun of a file the delivery did not name, which meets. The parser grades both as declared in `reference.test.ts`.

`judge-coverage.test.ts` will fail: the committed calibration does not cover the new references. That is expected. State in notes exactly which tests fail for that reason, and what the change does to the calibration identity.

**Owns:** `test/evals/judge-references.ts`, `test/evals/reference.test.ts` if needed, `tasks/006-89/notes.md`. No rubric or `evals/lib` change.

**Done when:** `reference.test.ts` passes with the new cases; lint and typecheck pass; `squeal run --all --wait` is green apart from the named coverage failures. Name any file that fails under load and passes alone.

Never run `judge-calibrate.mjs`, `run-baseline.mjs`, `run-cell.mjs` or any regrade. No model call; no `npm run build`.
