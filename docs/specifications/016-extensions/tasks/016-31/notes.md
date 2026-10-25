# 016-31 another worktree's observed path reaches this daemon's key after its own write: notes

Worker 00f19154 (resumed after 016-29), 2026-10-25. Brief: `tasks/wave-7.md`. Shape: repair. Code read at `ead6d6db0` (main, after squeal 0.1.323). The coordinator approved the design before the fix (request f77f728d, reply 89d802f3), with 011's agreement: design D1, not D2, and the two assertions changed. No C3 change is owed.

## Cause

`SharedPaths.write` (`src/core/keys/observed.ts`) set `#read` to `undefined` after it wrote. So the next `of` or `see` read the key again through `refresh` and dropped the list of entries that grew. Later, `WorktreeKeys.refreshObserved` found the stored text unchanged, got no entries and put nothing into `#grownElsewhere`, so `regrowObserved` re-keyed nothing. A file whose observed path another worktree stored kept a closure and a key without the path. An edit of that path then left the file current at its old result: a missed re-run. The 016-29 notes recorded this as residue; review 0.1.323, check 4, proved it. It was the same on main before 016-29.

## Changes

| Commit | What |
| --- | --- |
| `f7203a4ed` | The failing test, `test/scheduler/observed-regrow.test.ts`: the reviewer's probe at the `WorktreeKeys` level. Two worktrees' keys over one store, a module-load environment, A and B keyed in both. The other worktree stores `data/y.txt` for B; this one stores `data/x.txt` for A, reads A, then regrows. B's closure must hold `y`, and an edit of `y` must re-key B. |
| `d20127ac7` | D1: `write` keeps `#read`. `of` and `see` read the key only at the first ask; after that only `refresh` reads it and reports each entry that grew. The doc comments of `#read` and `SharedPaths` state the rule. The 001-132 case of `test/keys/observed.test.ts` changes two assertions, as agreed. |

## The test on main

- With the read of A: FAIL at `observed-regrow.test.ts:107`, `expected [ 'test/b.test.mjs' ] to include 'data/y.txt'`.
- Control, without the read of A: PASS on main. So the read after this worktree's own write is the cause, not the fixture.
- With D1: PASS.

## The rule now

A view reads its key at the first ask (`of`, `see` or `refresh`) and then only at `refresh`, which parses only when the stored text changed. After this worktree's own write, the stored text holds the other worktrees' paths that the write merged. The view does not hold them yet, so the next `refresh` reports their entries as grown. This worktree's own paths are already in the view, so they are not growth. The rule is the C3 sentence as it stands: "a worktree reads it when it first keys a project's files and again before it records a tier" (`observedGrowth` calls `refreshObserved`).

Effects on the other callers:

- The start-up view: `#withStartup` already calls `refresh` before `of`, and `regrowStartup` calls `refresh`.
- The direct marks: `ObservedSets.refresh` refreshes the direct view too and ignores its growth, as before.
- A first ask still reports nothing, as before. No closure was assembled from an older view of that key, except in one edge: a project whose `observes` turns true after its closures were set. That edge is unchanged.

D2 was not built: a set of grown entries that any read fills and `refresh` empties. It leaves two read paths into the view, and 011 preferred one.

## The changed assertions (the 001-132 case "merge across worktrees, never drop, and read another worktree's additions on refresh")

Before, `a.of(t)` right after `a`'s own write returned b's `data/y.txt`, and `a.refresh(["p"])` returned `[]`. Those two assertions pinned the missed re-run. Now `a.of(t)` returns `["data/", "data/x.txt"]`, `a.refresh(["p"])` returns `[t]`, and then `a.of(t)` returns all three paths. 016-29's union, rollback and restart tests are unchanged and pass.

## Checks

- `node --import tsx test/keys/validity/compare-refs.ts squeal--v0.1.323 HEAD` at `d20127ac7`, load average 37.62 on 24 CPUs: exit 0, fired global (20->20), 64 of 64 cases keys equal and outputs equal, wording `[]`, uncovered 0. `write` writes the same bytes as before: only the line after its `meta.set` went.
- `test/keys/key-format.test.ts`: passes at revision 23, with no version raised.
- These pass at revision 23: `test/scheduler/observed-regrow.test.ts`, `test/keys/observed.test.ts`, `test/scheduler/{one-write-path,observed-direct,observed-growth,observed-inputs,ignored-observed,pytest-observed,absent-paths,ignored-leftovers}.test.ts`, `test/kit/*.test.ts` and `test/policy/repository-inputs.test.ts`.

## Type changes

None. `SharedPaths`, `ObservedSets`, `StartupSets` and `WorktreeKeys` keep their methods and types; `keying.ts` is unchanged.

## For the next worker

- The cost went down: a view no longer parses its key at the ask after each own write. For this repository's 1.7 MB `observed.` row, that is one `JSON.parse` fewer per record that wrote.
- What is left: the first-ask exemption above. Fixing it would mean a first read that reports every entry as grown, so the next regrow assembles every closure again once per daemon start. Nothing measured asks for that.
