# 006 wave 11: the quality scan's findings

The human (2026-10-13) took every finding of `../quality/2026-10.md` ("All, with 006-50"). One worker does both rows in order, 006-51 first. They share `grade.mjs`, `results.mjs` and `index.d.mts`. Each finding gets its own commit.

Rules for both rows:
- Never run `run-baseline.mjs`, `run-cell.mjs`, `judge-calibrate.mjs` or `regrade.mjs`.
- `atomic-regrade.mjs` is allowed (006-50 only). It calls no model: confirm that by reading it first, and stop and ask if it would.
- No `claude` or `codex` session, and no `npm run build`.

## 006-51 the scan's slices and drops

Use /worker. Shape: repair.

Apply:
- slices 1 to 9 as the file states them;
- slice 10's description edit in `evals/variants/d8-deny.json`;
- both drop candidates: `evals/bin/import-005-07.mjs`, and the variants `skill-desc.json` and `slow-step.json`.

Leave slice 11 alone: the coordinator applied it. Regenerate `TREND.md` with `node evals/bin/trend.mjs` after slice 2.

Done when:
- each slice's own test exists where it changes behaviour: slice 3 (regrade reads only `baseline` and `variant` files), slice 4 (`atomic-regrade` writes `ATOMIC.md`) and slice 2 (`tools` named in a break);
- `npm run lint`, `npm run typecheck` and `npx vitest run test/evals` pass.

## 006-50 one rule for a rerun after Squeal answered

Use /worker. Shape: slice.

Do the row exactly as the scan states it: read `../quality/2026-10.md`, "Board rows". `../spec.md` D10's `a1-break` line is already amended, and `../status.md`'s last entry records the human's decision.

Regrade the four `.atomic.json` files with `atomic-regrade.mjs`, then regenerate `ATOMIC.md`.

Done when: the scan's done-when holds, with the gate green.

**Owns:** `evals/**` and `test/evals/**`, except `evals/results/*.atomic-variant.json`.
