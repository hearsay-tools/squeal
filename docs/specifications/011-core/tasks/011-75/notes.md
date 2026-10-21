# 011-75: `failures` by test file, directory and check, with a limit, worker notes (2026-10-21)

Brief W1 of `../wave-9.md` (on main at `b3ab9e004`, not in the base). Base `cand/0.1.239` at `5216be24c`. Design `../011-64/design.md` sections 1 and 5 (R1); spec 011 C6 as amended 2026-10-21 for 011-64. Commit `7b9a1e4a1` (code and tests); this file and `timings.ts` in the next commit.

## Seam map

- `src/core/store/repos/failures.ts` (new): `createFailureRepo`, wired as `store.failures` in `store.ts`. `FAILURE_STATEMENTS.list`, `count` and `failingChecks` build each query from one `FailureSelection`; the test reads their plans. Each reads `results r INDEXED BY results_by_failure CROSS JOIN checks c`. The `CROSS JOIN` keeps the failing rows the outer loop, and `c` is found by its primary key.
- The path filter is `EXISTS (SELECT 1 FROM json_each(?) p WHERE c.test_path = p.value OR substr(c.test_path, 1, length(p.value) + 1) = p.value || '/')`. It is case-sensitive, unlike the design probe's `LIKE`, which matched `src/Auth/` for `src/auth`. It runs per failing row, not over all of `checks`.
- The check filter is `r.check_id IN (SELECT k.id FROM json_each(?) j JOIN checks k ON …)` over `checkParams` arrays, through the `checks` unique index. One parameter, so no SQLite variable limit, however many checks match.
- `src/core/status/failures.ts`: `failurePaths(cwd, paths)` reads each path from `cwd` (or its real path), root-relative, `.` for the root, as `status <path>` reads it. It returns `{ outside, root }` for the first path outside the worktree. `readFailures` takes `paths`, `checks` and `limit`. With `--check`, it reads `failingChecks` of the rest of the selection, keeps those whose `formatCheck` name holds a text, and lists and counts by them. All three reads are in one read transaction (`withStatusStore`). `.` among the paths drops the path filter.
- `src/cli/failures.ts`: positionals are paths. `--since`, `--check` and `--limit` take `<value>` or `=<value>`. Exit 2 on a path outside the worktree, an empty `--check`, and a `--limit` that is not a whole number of at least 1. It imports `failurePaths` from `core/status/failures.js` directly, because the status barrel (`index.ts`) is not in this row's ownership.
- `src/cli/main.ts`: the `squeal failures` lines of `HELP`.

## Type changes (all additive)

- `src/core/types/store.ts`: `FailureSelection` (`worktreeId`, `since`, `paths`, `checks`), `FailureRepo` (`list`, `count`, `failingChecks`), and `Store.failures`. `FailureFilter` and `ResultRepo.listFailures`/`countFailures` stay, unused (design section 4, consequence 1).
- `src/core/types/status.ts`: `FailuresSelection` (`paths`, `checks`) and `FailuresReport.selection`. `--json` grows `selection`, with no `schemaVersion` raise. `limit` now carries `--limit`.

## Decisions the spec did not settle

1. The header names the selection: `Failures in every worktree for src/auth, checks holding "autosave" since <time> (…)`. Several `--check` texts read `holding "a" or "b"`. An empty result reads `No stored failures in every worktree for checks holding "x".`
2. A path that resolves to the root, `.` from the root, selects every test path. The design did not say. `status <path>` treats the root as unmatched.
3. A path outside the worktree is reported as `"<path>" is outside the worktree <root>`, exit 2, and the store is not opened. Outside any git worktree, the paths are not judged, and the read says the store is unavailable (exit 1), as before.
4. `--check ""` exits 2. An empty text would match every check.
5. The row-to-record mapping `toResult` is copied into the new repo from `results.ts`. Sharing it would change `results.ts`, which is on the alarm's path. It goes with the unused `listFailures`/`countFailures` at the next key-format raise.
6. The path resolver is copied in small form from `src/cli/status-wait-paths.ts` (`worktreePath`), which is not this row's file and lives in the CLI layer. A `/quality` scan can move both to `src/core/fs`.

## Brief defect

`docs/commands.md` does not exist on this base, and no other user doc names `squeal failures` outside the spec and the board. The `HELP` text is the only command reference changed.

## Tests (R1's 1 to 7)

| R1 test | Where | Red before |
| --- | --- | --- |
| 1, issue 67: 32 failures, the file's 2 the oldest | `test/cli/failures-selection.test.ts`, first test | yes: exit 2 |
| 2, directory, subdirectory, two worktrees, outside, deleted file | same file, second test | yes: exit 2 |
| 3, `--check`, across worktrees, with a path | same file, third test | yes: exit 2 |
| 4, `--limit 50` of 60, bad limits | same file, fourth test | yes: exit 2 |
| 5, `EXPLAIN QUERY PLAN` names `results_by_failure` | `test/store/failure-repo.test.ts`, plan test | yes: no module |
| 6, every fail from `recordsForFile` gets a text | `test/store/failure-repo.test.ts`, premise test | the file failed to load; the premise itself held before, as the design says |
| 7, `key-format.test.ts`, alarm silent | unchanged test | passes before and after; no line on the path changed |

The most likely false line, test 2's `--all-worktrees` reading from a subdirectory, is the second test: `auth/login.test.ts` typed in `<b>/src` lists the failures of `src/auth/login.test.ts` in both worktrees. A fresh copy of cezar's store held the premise too: 1,497 fail rows, all with `failure_id`; 635,355 pass and 409 skip rows, none.

`test/cli/failures.test.ts` changed in two places: the `--json` schema gains `selection`, and the help line is the new usage.

## Timings on a copy of cezar's store

Copy: `snapshot.mjs` (011-64 probes, a read-only `VACUUM INTO`) of `/home/agent/projects/cezar/.git/squeal/store.sqlite` at 2026-10-21T16:08:42Z, load 59.7 on 24 CPUs, into `/tmp/t75/repo/.git/squeal/store.sqlite` (not committed: it holds cezar's test names and texts). 637,261 results, 1,497 failing; 22,779 checks; 31 worktrees; 6,244 runs; 410 failure texts. Run: `timings.ts` beside this file, through `tsx`, with `HOME`, `XDG_*` and `TMPDIR` under `/tmp/t75`, at 16:09:02Z. Median of 7, one-minute load beside each. The host was loaded by other coordinators (59.6 to 60.6 on 24 CPUs), so every figure is high against the design's run at 10.6.

| Query, cezar's store (worktree `b7555ac0d0f19f40`, cezar's main) | Today (`results.ts`) | R1 (`store.failures`) | Load |
| --- | --- | --- | --- |
| list 20, this worktree | 98.4 ms | 1.7 ms | 59.6 |
| count, this worktree (115) | 123.9 ms | 1.2 ms | 59.6 |
| list 20, every worktree | 0.8 ms | 6.7 ms | 59.6 |
| count, every worktree (1,497) | 203.9 ms | 3.7 ms | 60.6 |
| one test file, `harness-parity.test.ts`, list 20 of 27 | exit 2 | 8.0 ms | 60.6 |
| the same file, count | exit 2 | 4.7 ms | 60.6 |
| a directory, `packages/web`, list 100 of 366 | exit 2 | 9.4 ms | 60.6 |
| the same directory, count | exit 2 | 4.3 ms | 60.6 |
| the failing checks (1,286) | none | 7.5 ms | 60.6 |
| `--check autosave`, 13 failures: failing checks, the JS match, list 100 and count, in one read | exit 2 | 20.7 ms | 60.6 |
| list 1,000, every worktree | 173.7 ms | 38.6 ms | 60.6 |

`readFailures` end to end (open the copy, one read transaction, map the rows; no formatting):

| Call | Median | Load |
| --- | --- | --- |
| `--all-worktrees` | 10.5 ms | 60.6 |
| `--all-worktrees harness-parity.test.ts` | 8.5 ms | 60.6 |
| `--all-worktrees packages/web --limit 100` | 15.4 ms | 60.6 |
| `--all-worktrees --check autosave` | 19.9 ms | 60.6 |
| `--all-worktrees --limit 1000` | 76.2 ms | 60.6 |

One row is slower than today: the every-worktree list of 20, 0.8 ms against 6.7 ms. Today's plan walks `results_by_time` newest first and stops at 20 failures; cezar's newest results now hold many failures, so it stops at once. The design's copy took 21 ms there, because its failures were older. R1 reads all 1,497 failing rows and sorts them. The command pays the count in the same call, so the whole `failures --all-worktrees` goes from about 205 ms of SQL to about 10 ms. The JS match of `--check` costs about the failing-checks read again; it grows with the failing checks (1,286 here), not with the results.

## For the next rows

- 011-76 (R2) adds `testFileFrame` to `FailureEntry` in `readFailures`' map; `store.failures.list` returns the whole `ResultRecord`, errors and their stacks included, so no store change is needed.
- 011-77 (R3) adds `failingAt(key)` to `FailureRepo` (design section 5), and its merge in `readFailures` after `list`. The `limit` and `total` then count replaced failures too (C6: "with the total and how many are replaced").
- 011-79 marks rows whose test file this worktree no longer keys; it owns `src/core/status/failures.ts` after this row.
