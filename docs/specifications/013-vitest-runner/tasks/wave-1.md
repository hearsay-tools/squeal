# 013 wave 1 brief (2026-10-20)

One row, from the design the human accepted on 2026-10-20 (`013-01/design.md`, D1 to D3). Dispatch after the 011 coordinator's cand/0.1.226 (011-22, 011-23) is on main, since D2 changes the scheduler's barrier code it touches, and while the one-minute load is below the CPU count. Leave `docs/board.md`, `spec.md`, `status.md`, `package.json` versions and `plugins/*/dist` to the coordinator, and do not run `npm run build` in your tree.

## 013-02: a touch withholds only what the Vitest instance could have read

Use /worker. Shape: slice. Outcome: a touch no instance could have read withholds nothing and keeps the instance; a counting touch withholds only the test files that reach it; the completion barrier withholds only the files whose keys name the touched path.

Read: the board's 013-02 row; V5's Touched files bullet and 011 C2 as amended 2026-10-20; `013-01/design.md` sections 2, 3 and 6; `../../011-core/research/issue-33-dist.md` with its probes.

Seams, from design section 6: a new `src/runners/vitest/touched.ts` (the sort and start set); `moved.ts` (the touch walk, `withoutTouched` taking the files); `adapter.ts` at run end and in `#instance`. First edit: regression 1 of section 6 in a new `test/runners/vitest/touched-scope.test.ts`, red today. D2 (`src/core/scheduler/stability.ts` `withheldForTouch`, `scheduler.ts`'s withheld files) goes in its own commit after the adapter's.

Owns those files, the two new test files of section 6 and `test/integration/touched-in-flight.test.ts` as section 6 says. Leave alone: stamps, keys, refinement, the slow-instance wrapper, node:test, pytest.

Done when: regressions 1 to 11 of section 6 pass; the other `touched-*` tests unchanged and passing; lint, typecheck and `squeal run --all --wait` green but for bundle drift and 001-390, its output pasted, any file that fails only under load named. Raise `KEY_FORMAT_VERSION` as the guard asks and say so; the coordinator settles the number at integration.
