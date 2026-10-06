# Wave 7 worker briefs

Ready to dispatch on the board's standing models. One worker.

## 001-53 targeted invalidation on add and delete

Use /worker. Shape: slice.

Outcome: an added or deleted file no longer drops every cached Vitest transform, so the first result after a save that adds a test arrives in about the time a plain edit takes (lessons.md defect 11: 9 to 12 s on a 516-file repository today, against 1 to 2 s for an edit).

Read: spec D4 (invalidate and affected), D3 (closures include absent resolution candidates), `lessons.md` defect 11 and the measurement table above it, `research/vitest-internals.md` Q5 (invalidation cases).

Seam: `src/runners/vitest/adapter.ts`, the `invalidate` branch that calls `invalidateAll` for `add` and `delete`. First edit: replace it with a targeted set. On delete: the deleted module and every importer of it in the module graph. On add: every module whose unresolved import has the added path among its resolution candidates, plus every module whose resolved specifier the added path would now shadow (the `resolve.extensions` and `index` rules the closure code already uses for absent candidates). Keep `clearSpecificationsCache()` for test-glob matches.

Own: `src/runners/vitest/`, `test/runners/vitest/`, `test/fixtures/vitest/`, and the D4 paragraph in `spec.md` plus one dated line in `status.md`. Leave the scheduler, keys and harness alone.

Done when: the three cases `invalidateAll` covered are tests (a missing import target appears; a resolved target is deleted; a new file shadows a resolved one); `affected` after an add on a fixture with at least 200 modules costs within two times the warm walk, measured and reported; the existing Q5 invalidation tests still pass; D4 is amended with the rule and the measurement.

## After 001-53 lands

001-53 landed as `a33d5b5..c481599`, bundles `e818a05`. Two rows run in parallel on disjoint files, both `--backend claude --model opus --effort high`, never Fable.

## 001-54 `cezar` probe re-run

Use /worker. Shape: survey.

Outcome: the "under 2 s add-to-run-start" line of 001-53 is measured on the repository that showed defect 11.

Read: `lessons.md` "Structural changes on a large repository" and defect 11, spec D4 as amended.

Seam: a throwaway copy of `/home/agent/projects/cezar` at `82dfae5` (`git clone` into your scratch dir; never touch the cezar checkout or its store). Repeat the table there with Squeal at your baseline: `invalidate` and `affected` for an edit, an added test file and a deleted test file, then a daemon probe on the copy giving revision-to-run-start and revision-to-delivery for an edit and an add, three rounds each. Stop the daemon on the copy before you finish.

Own: one dated subsection appended under "Structural changes on a large repository" in `lessons.md`. Nothing else.

Done when: the table and the daemon timings are recorded beside the old ones; add-to-run-start is under 2 s, or the subsection names a new defect with the step where the time goes.

## 001-55 wave 7 review

Use /reviewer. Range `64941df..e818a05`. Output `reviews/wave-7.md`.

Outcome: a fresh judgement of whether targeted invalidation can leave a stale transform that the old `invalidateAll` would have dropped, since that failure shows as a wrong pass, not an error.

Read: spec D3 and D4, research `vitest-internals.md` Q5, `src/runners/vitest/stale.ts`, `graph.ts`, the `invalidate` branch of `adapter.ts`, `test/runners/vitest/structural*.test.ts`.

Probe at least: aliased and bare specifiers (no longer covered; D4 says so, is that safe given D3?), `tsconfig` paths, a deleted directory, rename as delete plus add in one batch, multiple Vitest projects and environments, the read of Vite's internal `invalidationState` (what breaks if a Vite release renames it, and whether a test would catch that), and whether the timing asserts in `structural-cost.test.ts` are fit for CI.

Also: `test/harness/plugin.test.ts` reads `src` and `dist` at runtime, so Squeal inherited a stale FAIL for it across the bundle rebuild; propose whether a committed `squeal.config.json` `inputs` map is the fix.
