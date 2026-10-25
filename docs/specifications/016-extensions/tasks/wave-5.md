# Wave 5: the quality scan after the ship

One row, read-only. Spec 016 shipped at 0.1.320 on 2026-10-25.

## 016-28 `/quality` over spec 016

Use /quality. Row 016-28 in `docs/board.md`.

Scan spec 016's landed work from `5cc9d1ca5` (016-12's first commit) to `squeal--v0.1.320` against `docs/vision.md` and `docs/styleguide.md`. Leave out the commits of specs 011 and 015 in that range (their releases 0.1.309 to 0.1.312, 0.1.314, 0.1.315, 0.1.317 to 0.1.319). 016's rows: 016-12, 016-14 to 016-17, 016-20 to 016-24, 016-26 (releases 0.1.308, 0.1.313, 0.1.316, 0.1.320; tests and docs only: 016-12, 016-21). Read `spec.md`, `status.md`, `lessons.md` and `reviews/`.

Look in particular at:
- open question 4's answer (`status.md`, 2026-10-25): each adapter-suite case under `test/runners/**` or `test/scheduler/**` that a kit scenario (`test/kit/**`) already proves on the same runner is a drop candidate. Name the case, the scenario and the runner. Name any fixture kept twice;
- the legacy `nodeTest.observed*` and `pytest.observed*` store rows that no daemon reads since 0.1.313 (`lessons.md` section 6): is a delete on open worth its code?
- `src/core/keys/observed.ts` after 016-23, 016-24 and 016-26: rules that one rule could replace;
- spec and `status.md` text that no longer says what the code does.

Write `docs/specifications/016-extensions/quality/2026-10-25.md` with drop candidates, proposed rows and slices. Commit it. Never edit the board. Run nothing under `evals/bin/` or `tasks/*/probe/`.
