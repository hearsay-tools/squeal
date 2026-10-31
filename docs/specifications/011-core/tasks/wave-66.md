# Wave 66: one key-format release, rows 011-60, 011-270 and 011-105

Coordinator 63577e87, 2026-10-31. The human approved one release that raises the key format and carries all three rows (decision card "Key change: All three now"). Version 0.1.388 claimed (peers 6e3bce1c and e3814b62: no claim). Every project re-runs its tests once after this update.

Host policy, as in `wave-60.md`: no local full suite, no `squeal run --all`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on every test command; private `/tmp` fixtures; never make CPU load on purpose; no `pnpm run build`; no real harness session under the real HOME. Not yours: the board, `spec.md`, `status.md`, bundles, `package.json` version. Read affected results with `squeal status --wait 60000 <paths>`. The three rows run at once; `src/core/scheduler/keying.ts` is shared by W2 and W3 in disjoint regions, and the coordinator merges them.

## W1: row 011-60 (a failed run-time import records its absent target; gh-56)

Use /worker. Shape: finish (port).

Outcome: a Vitest file's child process that fails to import a missing script records the exact absent `file:` or relative target, so creating the script queues the file and its next result replaces the FAIL.

Read: `research/issue-56.md`; spec 011 C3 and C12; 013 V3 and V10; the board row.

Seam and lead: a worker wrote this on 2026-10-21 on origin `wip/011-60`: commits `b5207c826`, `0ad7c9b6c` and the raise `de730ec12`. They conflict with main in `src/runners/observe/recorder.cjs` and `test/keys/validity/cases/index.ts`. Port them onto this tree; review the old code as new work against today's recorder. `RECORDER_VERSION` (`src/runners/observe/runtime.ts`) is now 5: raise it to 6 in its own commit only if the alarm names the new case.

Owns: `src/runners/observe/**`, `test/runners/observe/**`, `test/keys/validity/cases/observe/failed-import.ts` and its one line in `cases/index.ts`. Leave alone: `src/core/**`, `src/core/keys/key-format.ts`.

Done when, red before and green after: the two observe tests (failed import records the path; creating the script queues the file and its next result replaces the FAIL); the validity case runs the recorder's no-parent branch; existing observe tests pass; lint and typecheck pass. Report what `test/keys/key-format.test.ts` prints in your tree (it may fail there; the format raise is W3's).

## W2: row 011-270 (a path git stops ignoring leaves the extra-file set)

Use /worker. Shape: slice, test first.

Outcome: when the same daemon sees a path stop being ignored (a `git add -f` and commit, or a removed ignore rule), the path leaves `#extra` at the revision that shows it, and listing keys equal what a restart gives.

Read: `reviews/0.1.379.md` B1 and its "Inputs" section; the board row; spec 011 C3 and C4 on listings.

Seam and lead: `src/core/scheduler/keying.ts`, the ignore check near `:894` and `#rejudge` (`:767`). Leaving needs, at that revision: the `Listings` count as an add (`src/core/keys/observed.ts`), removal from `#inherited` and `#unjudged`, a rekey of its directories' listing readers, and `onExtraFiles`. Removing it from `#extra` alone drops a tracked sibling's directory on a later delete.

Owns: `keying.ts` except W3's lines (the `formerReadAsOne`, `formerFiles` and `absentReadAsOne` imports and calls, about `:5`, `:13`, `:247-293`, `:770`); `observed.ts`; `src/core/scheduler/batch.ts` and `reconcile.ts` as needed; new tests under `test/scheduler/`. Leave alone: `src/core/keys/**` other than `observed.ts`, `src/runners/**`.

Done when, red before and green after: a same-daemon force-add-and-commit and an ignore-rule removal each move the path out of the extra-file set at the revision that shows it; listing keys equal a restarted daemon's on the same tree; a later delete of the path keeps a tracked sibling's directory in the listing. Existing `test/scheduler/ignored-leftovers.test.ts` and the runtime-files tests pass; lint and typecheck pass. Stop and report if this needs a store schema change.

## W3: row 011-105 (removals at the raise) and the raise itself

Use /worker. Shape: finish (removals), then the raise.

Outcome: the code the alarm kept until a format raise is gone, and `KEY_FORMAT_VERSION` is 21.

Read: the board row 011-105 (scope (a) to (e) and done-when); `tasks/011-101/notes.md`, `tasks/011-102/notes.md`, `tasks/011-154/notes.md`, `tasks/011-158/notes.md`; the comments in `src/core/keys/key-format.ts`; spec 011 C3 and C12; 011-37 D6.

Seam and lead: start with (c) `latestForCheck` (`src/core/store/repos/results.ts`) and its three test reads; then (a), (b), (d), (e) as the row lists them. Line numbers in the row are old; find the names. Last commit: raise `KEY_FORMAT_VERSION` 20 to 21, empty `KEY_FORMATS_READ_AS_ONE` (its reading code stays), and do what the alarm requires for a raise, in `test/keys/` only. Report whether `VITEST_ADAPTER_VERSION` moves with (d).

Owns: the files the row names, in `keying.ts` only the former and absent lines named under W2, `src/core/keys/**` except `observed.ts`, `src/core/store/**`, `src/core/types/{store,runner}.ts`, `src/runners/vitest/{environment,adapter}.ts`, `src/runners/vitest/version.ts`, `test/keys/**` except `cases/observe/`, and the tests the row names. Leave alone: `src/runners/observe/**`, the rest of `keying.ts`.

Done when: the row's grep checks find nothing; `test/store/opening.test.ts`'s rollback test and the three `listForCheck` reads pass; `test/keys/key-format.test.ts` and `test/version-sensitive.test.ts` pass under 21 in your tree; lint and typecheck pass. Tests that only exercise removed code are deleted, named in your final message.
