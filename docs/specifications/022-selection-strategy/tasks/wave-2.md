# Wave 2: stop storing loaded lists (row 022-05)

Approved by the human, 2026-11-21: "Lists: Stop storing, keep keys". Evidence: `../status.md`, the two 2026-11-21 lines.

## 022-05 stop storing loaded lists; remove the reach estimate

**Outcome.** No release writes a `loaded_modules` row, prune empties the table an older release left, and `squeal reach` has no narrowing section, while a run's loaded list still joins its key and its CI part.

**Read.** `../spec.md` D2, D3 (amended 2026-11-21), D4 (removed); `../status.md` 2026-11-21 lines.

**Shape.** Slice (subtraction).

**Starting seam and leads.**
- `src/core/scheduler/record-tier.ts`: remove `storeLoaded` and its call. First edit.
- `src/core/store/loaded-modules.ts`: keep the table name, `hasLoadedModulesTable` and a sliced delete. Change `dropOrphanLoadedModules` to delete every row (no `NOT EXISTS` search), keep the row 021-33 shape (keys read outside the write lock, deletes in `DELETE_BATCH` slices). Rename it to say that. Remove `writeLoadedModules`, `LOADED_MODULES_SQL` and the record types when nothing else uses them. Dropping the empty table is your call; an older daemon recreates it on its next write either way.
- Remove the reach narrowing: `src/core/reach/narrowing.ts`, `read-loaded.ts`, its parts of `read.ts`, `report.ts`, `report-types.ts`, `types.ts`, `inputs.ts`, and `src/cli/reach-narrowing.ts`, `reach-format.ts`. Bump reach's JSON `v` only when other readers need it; say which in the notes.
- Keep: `src/core/code/coverage/provider.mjs`, `src/runners/vitest/coverage.ts` `loadedLists`, `adapter.ts` `#withLoaded`, `src/core/ci/loaded-inputs.ts`, `PartFile.loaded`, `RunReport.loaded`. Keys must not move: no `KEY_FORMAT_VERSION` raise.

**Owns.** The files above and their tests: `test/store/loaded-modules.test.ts`, `test/store/prune-keyed.test.ts`, `test/store/prune-plans.test.ts`, `test/reach/narrowing*.test.ts`, `test/scheduler/loaded-modules.test.ts` (keep its key cases, drop the stored-list asserts), `test/keys/validity/cases/prune/slices.ts`, `test/keys/validity/harness/prune.ts`, and the `PruneInput.loadedLists` part of `test/keys/validity/case.ts`.

**Leave alone.** `bench/` (the coordinator updates the `@lists` cells), `docs/`, `plugins/*/dist` (no `pnpm run build` in your tree), `package.json` version.

**Done when.**
- A Vitest run with coverage on writes no `loaded_modules` row; its key still holds a runtime-loaded module (existing union cases pass).
- Prune on a store holding 3 × `DELETE_BATCH` list rows empties them over several slices; a store without the table is untouched.
- `squeal reach` text and JSON have no narrowing section; reach tests pass.
- `pnpm exec vitest run test/keys/key-format.test.ts test/version-sensitive.test.ts` passes with no raise.
- Lint, typecheck, and `squeal status --wait 60000 <changed paths>` clean. A short `tasks/022-05/notes.md` lists what was removed and anything left.

Use /worker.
