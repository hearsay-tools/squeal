# Wave 7 worker briefs

Ready to dispatch on the board's standing models. One worker.

## 001-53 targeted invalidation on add and delete

Use /worker. Shape: slice.

Outcome: an added or deleted file no longer drops every cached Vitest transform, so the first result after a save that adds a test arrives in about the time a plain edit takes (lessons.md defect 11: 9 to 12 s on a 516-file repository today, against 1 to 2 s for an edit).

Read: spec D4 (invalidate and affected), D3 (closures include absent resolution candidates), `lessons.md` defect 11 and the measurement table above it, `research/vitest-internals.md` Q5 (invalidation cases).

Seam: `src/runners/vitest/adapter.ts`, the `invalidate` branch that calls `invalidateAll` for `add` and `delete`. First edit: replace it with a targeted set. On delete: the deleted module and every importer of it in the module graph. On add: every module whose unresolved import has the added path among its resolution candidates, plus every module whose resolved specifier the added path would now shadow (the `resolve.extensions` and `index` rules the closure code already uses for absent candidates). Keep `clearSpecificationsCache()` for test-glob matches.

Own: `src/runners/vitest/`, `test/runners/vitest/`, `test/fixtures/vitest/`, and the D4 paragraph in `spec.md` plus one dated line in `status.md`. Leave the scheduler, keys and harness alone.

Done when: the three cases `invalidateAll` covered are tests (a missing import target appears; a resolved target is deleted; a new file shadows a resolved one); `affected` after an add on a fixture with at least 200 modules costs within two times the warm walk, measured and reported; the existing Q5 invalidation tests still pass; D4 is amended with the rule and the measurement.
