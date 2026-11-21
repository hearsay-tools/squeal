# 022-05 notes: stop storing loaded lists; remove the reach estimate

## Removed

- The list write: `storeLoaded` in `src/core/scheduler/record-tier.ts`, and
  `writeLoadedModules`, `LOADED_MODULES_SQL`, `LoadedModule`,
  `LoadedModulesRecord` in `src/core/store/loaded-modules.ts`.
- The reach estimate (D4): `src/core/reach/narrowing.ts`, `read-loaded.ts`,
  `inputs.ts` (only the estimate used it), `src/cli/reach-narrowing.ts`; the
  `narrowing` field of the reach report and its text section; the `loaded`
  facts of `ReachTestFile` and `recordedAt` in `read.ts`; the
  `NoList*`, `Unproved`, `Narrowing*` report types.
- Tests: `test/reach/narrowing*.test.ts`; the stored-list cases of
  `test/store/loaded-modules.test.ts`, `prune-keyed.test.ts` (the race case
  "keeps a loaded list a result came to be stored at" has no meaning now)
  and `test/scheduler/loaded-modules.test.ts`.

## Changed

- `dropOrphanLoadedModules` is `emptyLoadedModules`: `deleteByKey` with
  search `1`, so every row goes, `DELETE_BATCH` keys per slice, keys read
  outside the write lock (row 021-33 shape). A store without the table is
  untouched and takes no slice.
- The empty table is not dropped. An older daemon sharing the store makes it
  again on its next write, and a `DROP TABLE` would take the write lock for
  no saving once the rows are gone.
- `test/store/loaded-lists.ts` (new) makes the old table and rows by SQL for
  the prune tests.
- The validity prune case "loaded lists beside expired and kept results"
  keeps its name and input; its `loadedLists` wording is now `[]` against an
  older release's kept lists. That is wording, never a failure.

## Kept

- `RunReport.loaded`, `PartFile.loaded`, the provider, `loadedLists`,
  `#withLoaded`, `src/core/ci/loaded-inputs.ts`: a run's list still joins its
  key and CI part (D2). No `KEY_FORMAT_VERSION` raise.

## Reach JSON `v`

Not bumped (`REACH_REPORT_VERSION` stays 1). The `narrowing` field is gone;
no reader in `src`, `test`, `evals`, `scripts` or the plugins reads it. A
reader that wanted it would get `undefined`, which the estimate already
gave without history.

## Left for the coordinator

- `bench/` `@lists` cells, `docs/` (spec, board), dist rebuild.
- The scheduler test file keeps its name `loaded-modules.test.ts`; it now
  holds only key cases.
