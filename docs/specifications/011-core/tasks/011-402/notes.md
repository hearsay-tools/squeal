# 011-402: why a complete selection shrinks at one revision (gh-242)

Wave 122, W1b. Shape: survey. Question: `squeal status <source path> --json`, three calls a few seconds apart at one revision (Squeal 0.1.563, squawk's repository), listed 688, 1 and 1 test files for `packages/cezar/src/workflows/run.ts`. The short lists carried `selection.reason: "unsynced"`.

## Answer

The two lists come from two code paths. Which one runs depends on whether the daemon answered the snapshot's sync in time. Nothing in the store has to change between the calls. *Read in source code; reproduced by a test.*

1. `status <path>...` without `--wait` is a snapshot (`src/cli/wait/snapshot.ts`, `namedSnapshot`). It asks the daemon to sync, with the source paths, and waits at most `SETTLE_MS` = 750 ms (`src/cli/wait/status-table.ts:31`).
2. The daemon answers in `Daemon.#requestSync` (`src/core/daemon/daemon.ts` about 1211-1222): it waits for the daemon start, runs a reconciliation pass under the scheduler lock, then `Scheduler.readers` takes the lock again and reads `keys.index.reverse.referencing` (`src/core/scheduler/scheduler.ts` about 884-893). This is the complete list (688): this worktree's own closures at its own keys (row 011-234).
3. When the answer is not there at 750 ms, `readOnce` calls `selectNamedFiles` with no readers (`snapshot.ts` about 112). For a source path it then uses `storedReaders` (`src/cli/stored-closures.ts`): the `test_files` table, one closure record per test file for all worktrees of the repository (`PRIMARY KEY (project, path)`), kept only when this worktree wrote it or the writer's current key for the file is this worktree's key (001 D6's rule). In a repository where many worktrees write closures, most records are another worktree's at a key this worktree does not hold, so most readers drop out (1 of 688). This is `research/source-path-selection.md` finding 1 (row 011-234), which row 011-234 fixed only for a synced daemon; the fallback stayed.
4. The same read is `unsynced` (`selectionResult`, `src/cli/verdict.ts` about 205: a timeout whose sync did not reach the pass), so `reason: "unsynced"` marks exactly the calls that used the store rule.

What holds the answer past 750 ms is any lock holder or start: `await this.#starting` (a lookup-only start took 41 s in E4 of `research/stuck-running.md`), a tier's record, a runner part's apply, or a large batch's reconcile. Which one held it in the gh-242 calls is **not determined**, because the incident's store and daemon log were not kept. *Inferred:* the issue's "no test file's closure holds `codex-ui-mapper-state.ts`" during a daemon start is the same path with 0 valid records (0 readers gives `unmatched`, not `unsynced`).

Ruled out, for the status selection:

- `test_file_imports` read while a runner part rewrites it (`src/core/store/import-edges.ts` 179-189). No code under `src/cli` reads the import graph; `stored-affected.ts` serves the scheduler's `affected`, not status.
- Keys read across two revisions. The store rule reads `test_file_keys` and `test_files` in one read; the shrink needs neither to move. The daemon's `readers` reads the index under the lock, so it never sees a half-applied runner part.

## Reproduction

`test/cli/snapshot-selection-shrinks.test.ts` (committed, passes): one store, 13 readers of `src/cli/start.ts`, 12 of their closures written by another worktree under keys this worktree does not hold, 1 by this worktree. A snapshot whose daemon answers within the settle time selects 13; one whose daemon does not answer selects 1, with `{ result: "none", reason: "unsynced" }`. The existing `test/cli/source-path-readers.test.ts` ("selects all 13 readers at S1, S3, S6b and S7b, where the store rule selects none") shows the store rule's other losses.

## Proposed fixes (none made: the code is under `src/cli` and `src/core/daemon`, outside this row's files)

1. **Label (row 011-401, running).** An `unsynced` selection with a source path is partial: say so in the text and in JSON. This makes the short list honest; it does not make it complete.
2. **Wait for the readers, bounded.** When a named path is a source path and the sync is still pending at 750 ms, the snapshot waits for the sync's answer up to a few seconds more before it falls back. Cost: latency of a snapshot during a daemon start or a long lock turn. It still falls back at the bound.
3. **A valid fallback from the per-key import graph.** `readImportGraph` (`src/core/store/import-graph.ts`) reads each test file's walk at this worktree's current key (015 D11), so a record another worktree wrote is valid by construction. Selecting the files whose walk visits the path would replace most of the store rule's losses. Limits: a walk holds static and dynamic imports, not runtime-observed reads (so the 011-234 fixture's 8 runtime readers would still be missed); a key walked before the import-graph tables has no walk; reading every walk costs about one row and one inflate per test file. The store rule could stay as a union with it.
4. **Answer readers without the reconciliation pass.** The readers at the daemon's current revision need only the lock, not a pass; a request for readers apart from `sync` would come back after one lock turn. It does not help during the start.

My recommendation: 1 now (running), then 3 with the store rule as a union, since it removes the dependence on timing for import readers; 2 only if measurements show the start is the usual holder.

## Proposed spec amendment (005 D2, plain text for the coordinator)

Amended 2026-11-19 (row 011-402, gh-242): a snapshot's source path selects the daemon's readers only when the daemon answered its sync within the settle time; otherwise it selects by the stored closures valid for this worktree, which can hold far fewer files (`tasks/011-402/notes.md`: 1 of 688 at one revision). Such a selection is `unsynced` and partial (row 011-401).

No key-format or validity change.
