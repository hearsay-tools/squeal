# 011-79: `failures` marks history outside the active configuration

Board row 011-79, brief W2 of `tasks/wave-17.md`; R2 of `tasks/011-62/design.md` section 4.2; spec 011 C6 as amended for 011-62 and C10, *Projects at a reload*.

## What changed

- `FailureEntry` (`src/core/types/status.ts`) gains `active: boolean`, required. Additive in the JSON; no other producer of the type.
- `EntryContext` (`src/core/status/replaced-failures.ts`) gains `active(worktreeId, check)`. `storedEntry` and `replacedEntry` set the field from it. This file is outside the brief's list: the coordinator approved the edit (request 2f25d329).
- `readFailures` (`src/core/status/failures.ts`) passes `active`: one `testFileKeys.list(worktreeId, [{ project, path }])` for each listed row, in the row's own worktree. `mergeFailures` builds an entry only for a row it lists, so a read makes at most `limit` lookups, stored and replaced rows together.
- `formatFailures` appends `, not a test file here now` to the provenance line of an inactive row.

## Seam map

- The stored failing rows are selected and cut at `limit` in SQL (`store.failures.list`); the replaced ones are selected in memory (`selectReplaced`). Both reach `mergeFailures`, which sorts, cuts at `limit` and builds the entries lazily. A per-row field belongs in the entry builders, not in the query.
- `test_file_keys` is the set of test files a worktree's daemon lists. The ledger's commit removes a row for a file the listing no longer holds (`ledger.ts`, `removeFile`), at a start and at a reload. R1 (011-78) makes a reload do that for a removed `nodeTest` or `pytest` project; until R1 lands, a removed project's rows go at the next daemon start.
- `test/cli/failures-keys.ts`, `keyTestFiles`: seeds a row for each record's file, as a listing daemon holds it. The existing failures tests seed through it, so their rows stay active.

## Decisions the spec did not settle

1. **Where the mark goes.** At the end of the provenance line, after `run <id>`. That line names the worktree, so "here" reads as that worktree, also with `--all-worktrees`. The head line stays `FAIL  <time>  <check>`, which the tests and a reader split to get the check name.
2. **A row with `key: null` is a test file here.** The daemon lists the file but cannot key it now (an unknown environment, an untracked closure path). Its row stays until a listing loses the file, so it is active. The judge is the row, as design 2.6 says, not a non-null key.
3. **A renamed project's old failures are marked.** The lookup is by `(project, path)`, and a check id names its project (C10): `[gone]` at `gone/gone.test.mjs` is marked while `[gone2]` at the same path is not.
4. **A removed worktree's failures are marked.** It has no rows, so `removed worktree <id>, ..., not a test file here now`.
5. **No count in the header.** The header keeps its total and replaced count. A count of inactive rows would cover only the listed rows, not the total, and the brief keeps the total unchanged.

## Not covered

- A `setup` check has no stored result, so `failures` never lists one. If it did, it would be judged by its `globalSetup` path and read as inactive. *Inferred.*
- Between a configuration edit and its runner part's commit, a removed project's rows still exist, so its failures read active (design 2.3).

## Tests

`test/cli/failures-active.test.ts`: a deleted file's, a removed project's and a renamed project's failures are marked, and a keyed file's and an unkeyed listed file's are not; `--all-worktrees` judges each row by its own worktree, from either worktree; a replaced failure of a deleted file is marked; the cap and the total hold, and a read with 30 stored and 5 replaced failures makes 20 lookups.

Mutants run in a scratch copy, each failing at least one test: the cwd's worktree in place of the row's; a lookup by path in any project; no text mark; an entry built for every row before the cut; `key !== null` as the judge.
