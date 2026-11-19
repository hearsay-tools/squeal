# 011-403: an unsynced snapshot selects from the stored import graph (gh-242)

Wave 122, W1c. Shape: repair. Cause: `tasks/011-402/notes.md`.

## What changed (commit 127cd5d84)

- `src/cli/stored-walks.ts` (new): `StoredWalks.readers(store, rows, rel)`, the rows whose stored walk at the row's own key visits `rel` (the path is in the walk, or a walk entry imports it, statically or dynamically).
- `src/cli/named-selection.ts`: when the daemon gave no readers for a source path, `selectNamedFiles` selects the union of `storedReaders` (the store rule, unchanged) and `StoredWalks.readers`, in the worktree's listing order.
- `src/cli/stored-closures.ts`: `StoredClosures.walks`, so a named wait keeps the walks it read across its polls, as it keeps the closures.
- `test/cli/snapshot-selection-shrinks.test.ts`: 13 of 13 while unsynced when walks are stored at this worktree's keys (red without the union: 1); a path no walk visits still selects by the closures alone (1, `unsynced`); walks at keys this worktree no longer holds are not used.

No added wait. The selection stays `unsynced`, so 011-401's partial label applies to it unchanged.

## Decisions

1. **Walks are read at the row's key, not through `readImportGraph`.** `readImportGraph` reads the worktree's keys again on its own. A key that moves between that read and the selection's `test_file_keys` read would pair a row with another key's walk, and the per-wait cache would keep the wrong pair. The query is the one `readImportGraph` and `stored-affected.ts` (`readWalk`) make, at the row's key.
2. **Only the test file's walk counts, not its environment's.** A config or setup file in the environment walk would select every test file of the project. Whether the daemon's reverse index (the synced path) selects by such a file was **not checked**; a reviewer may want the environment walk added if it does.
3. **Cache.** A walk found is kept per (test file, key) for the life of one wait or snapshot: one key's walk is written once and never changes (`writeImportGraph`, `ON CONFLICT DO NOTHING`). A walk not found is asked again at the next poll, since the daemon may store it meanwhile.
4. **Cost.** The first unsynced selection of a wait reads one row and inflates one walk per listed test file with a key. Not measured on a large store; the closures read beside it is the larger read (about 45 MB of JSON on cezar's store, row 011-44).

## Limits (why the selection stays partial)

- A walk holds static and dynamic imports, not reads a test makes at run time (the runtime readers of 011-234's fixture).
- A key with no stored walk (walked before the graph tables, or its runner part not applied yet) is not found.

## Proposed spec amendment (005 D2, plain text for the coordinator)

Amended 2026-11-19 (the human approved, row 011-403, gh-242, `tasks/011-402/notes.md`): when the daemon did not answer a selection's sync, a source path selects the test files whose stored closure is valid for this worktree (001 D6's rule) and the test files whose import walk stored at their current key here visits the path (015 D11). The selection stays unsynced and partial (row 011-401).

No key-format or validity change.
