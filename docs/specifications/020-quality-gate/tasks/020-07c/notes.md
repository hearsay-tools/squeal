# 020-07c notes: `--base` reads the stores

Worker 2d004d44, 2026-11-10. For a reviewer, 020-10b and whoever continues D11.7.

## Seam map

- `gate/collect.ts`: `CollectOptions.stored` (agreed with the coordinator, request dbb281f6). Called once per runner after `select()`, before its run and inside the budget. The files it returns do not run; their evidence is kept as given.
- `gate/types.ts`: `TestFileEvidence.fromStore?: true` (same agreement). `gate/report.ts` `runsOf` lists those paths as `runs[].fromStore`, present only when a run has one, so the 020-01 golden reports are unchanged.
- `gate/stored.ts` `openStored(options)`:
  1. `readStores`: `store.sqlite` and `code.sqlite` over `node:sqlite` `readOnly: true` connections, wrapped with the existing `createStore`/`createCodeStore`, so any write throws. Either missing, unreadable, or at another schema version than this Squeal's: `null`, and every file runs.
  2. `openKeyer`, at the first lookup: the adapters (given by the CLI), their environments, a scratch store under `$TMPDIR`, a copy of the real store's observed rows for the adapters' projects, `WorktreeKeys` over the scratch store bootstrapped as at a daemon's start, `setEnvironments`, and a map from each listed test file to its adapter.
  3. `keyFiles`: each file's runner closure, `setClosure`, `trackUntracked`, `index.key`.
  4. `evidenceAt`: results at the key (`byKey(key, 0)`: a read that moves no last-used time) for that file, and the record at `(key, COVERAGE_RECORD_VERSION)`. Both present: evidence with `completed: true`, failed names (`FILE_ERROR` for the file-level check), `skipped` from a `skip` outcome, and `fromStore: true`. Either missing: the file runs.
  5. A lookup that throws (an adapter that cannot start, a record that does not decode) gives no stored file, told once on stderr.
- `cli/code-gate-stored.ts`: `collectWithStores` wraps `collectEvidence` with the stores and tells `N of M selected test files read from the stores`. `storedFiles` skips the stores when there is no git common dir or the worktree's policy has coverage off (no daemon here stored a record). `daemonAdapters` builds the adapters as `daemon.ts` does.

## Decisions the spec did not settle

- **Keying adapters are the daemon's, not the gate's run adapters.** The gate's Vitest does not observe runtime inputs, and `VitestObserver.adapterVersion` adds `+observe.N` to the adapter version in every environment hash. So the gate's own adapter can never give the daemon's key. Proven by mutation: with `observe: () => false` in `daemonAdapters`, every key of the fixture differs. Cost: one more Vitest start (and one node:test adapter per project) when a store exists and a file is selected. The keying Vitest takes `cache: false`; the key test shows it keys the same.
- **Observed reads: a copy of the rows, not a full overlay.** The brief asked whether a read-only overlay over the real store is needed to keep observed reads in the key. Measured on this repository's store (2026-11-10, read-only): 1,035 test files have an `observed.` row (3.3 MB), 99 an `observedModules.` row and 81 an `observedDirect.` row (0.4 MB each); reading them takes about 0.1 s. A scratch store without them keys each such file without its observed paths, so it misses. Chosen: the scratch store gets a copy of `observed.`, `observedDirect.`, `observedModules.` and `observedStartup.` for the adapters' projects: of the store rows the key reads, these are the ones daemons' runs grow. The CLI test's `test/reads.test.ts` reads `data/input.txt` at run time: without the copy its key differs from the daemon's (mutation run, 2026-11-10).
- **Reuse needs both results and a record at the key.** D11.7's "runs only the files with neither" is read as the research's Q5.3 and the brief's done-when: a file with results and no record runs.
- **Read-only, and what that leaves.** `store.sqlite` and `code.sqlite` keep their bytes and mtime (tested). SQLite creates empty `-wal` and `-shm` side files when none exist, as any reader of a WAL database does (probe: a read-only connection beside a live writer and with none; the database file's hash and mtime did not change).
- **Environment.** The keys read allow-listed variables from the command's own environment, as a daemon reads its own. A variable that differs only costs a hit.
- **stderr note** `N of M selected test files read from the stores`, only when one is. The text report is unchanged (`code-gate-text.ts` is not this row's).

## Measurements

This worktree (`1e9715c11aa208ce`, revision 32, load 31 to 33 on 24 vCPUs), probe `real-keys.mts` in the worker's scratch, not kept: a sample of 60 of the 1,579 keyed test files gave 60 keys equal to the daemon's, 0 different, 0 unkeyed; 43 of 60 (72%) have a record at the key and are taken from the store. Keying cost: 2.3 s fixed (hashing 11,252 tracked files, one Vitest start, one closure), then about 0.16 s a file for its closure. The lookups take about 1 s for 60 files.

## For whoever continues

- node:test keying is built as the daemon builds it but has no test against a daemon (no fixture with a node:test project here).
- `stored.ts` `openKeys` repeats `core/ci/export.ts`'s private `openKeys`; a later quality row can share one.
- `cli/ci-export.ts` `daemonVitest` passes no `children`. With `coverage.children: true` its keys would differ from the daemon's (020-10a's marker). Not this row's file; worth a check in 020-10b.
- The 22% of keys with results and no record (research Q5) still run.
