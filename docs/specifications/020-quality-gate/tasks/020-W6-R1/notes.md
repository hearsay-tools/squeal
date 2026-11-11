# 020-W6 R1 notes: repair of review 0.1.433 (B1, B2, S1)

Worker 8c485439, 2026-11-11, on `ab79dba30` (the `w6/int` head with the wave 6.5 brief). Notes for whoever reviews the repair or continues it.

## Seam map

### B1: a touched input keeps the file out

- `src/core/code/gate/keep.ts` `#keepable`: the stability check is `changedSince(snapshot, paths, hasher)`, which gives `changed` (content differs) and `touched` (written since and ended as it was, `touchedUnchanged`). A candidate whose `stabilityPaths` meet either set is not kept. That is the daemon's completion barrier (`barredByTouch`), applied before any write. The checks for observed growth and environment files are unchanged.
- The daemon also bars on touched paths of observed growth (`prepareObserved`). The keeper does not need that: a file with any growth is never kept.
- Test: `test/cli/code-gate-keep-touched.test.ts`. The input test has its declared input in record-form `inputs`, so the steady sibling's keys do not hold it. It writes `good`, reads, and writes `bad` back only while an "armed" file outside the worktree exists. So the second gate run uses the same bytes, without a handshake or timing. Observation is off, as in the review, so this is independent of observed growth.
  - Case 1: nothing is stored at the input file's key; the steady file is kept.
  - Case 2: a daemon with `lookup-only`, started after the run, holds no current state of the input file once the steady file is current.
  - Case 3: the next gate run on the same bytes runs the input file and fails at the bytes it reads (exit 3); the steady file comes from the store.

### B2: one expectation per lookup

- `src/core/code/gate/keep-expected.ts` (new, split from `keep.ts` to stay under 300 lines): `Expectations` holds one `Pending` per `add` call, that is, per stored lookup of one opened runner. Each `Pending` has its own snapshot and its own `beginRun`. It is indexed by each of its files, as `runner kind + \0 + testFileId`. A node:test ref's project is the entry name, and the policy loader drops repeated names, so two entries never share an index key.
- `take(run)` returns the lookups that expected one of `run.files`, and removes each one whole. A second completion of the same files finds nothing. `Keeper.#keep` ends each taken lookup's run once, after `#keepable`, as before.
- `close()` ends the run of every lookup no run took, for example a runner reached after the budget ended (`tellRan` is not called when the report is `null`). `Keeper.close()` calls it. `openStored`'s `close` calls `keeper.close()` first. Before this, such a `beginRun` was never paired.
- `collect.ts` did not change. Its order (scope, stored and parts, print, estimate and order, prepare, run, keep) and the `StoredEvidence` and `GateRun` types stay the same. `GateRun.files` already carries the run's files, and the keeper reads them.
- Tests:
  - `test/cli/code-gate-keep-node-test.test.ts`: two node:test entries `a` and `b`. Case 1: both kept, and the second run reads both from the stores. Case 2 (mixed): `b`'s test changes, so `a` is found, `b` runs and is kept, and the next run reads both. This file is in `test/version-sensitive.txt`, since it runs real `node --test`.
  - `test/code/gate/keep.test.ts`, "keeps each lookup of one runner kind apart": three lookups of `node-test` and one empty lookup. A completion reaches the write for its own lookup only, and a repeated completion reaches nothing. `close()` ends the lookup that never ran. The root is `tmpdir()`, so the write reaches `head` (`worktreeIdFor` needs a real path) and stops there.

### S1: fresh controls on stores of their own

- `test/cli/code-gate-parts-cases.test.ts`: `clearStores(root)` removes a repository's `.git/squeal`. It runs after each case for all three fixtures (`fixture`, `probe`, `none`). It also runs between `fromParts` and `fresh` in the environment case and in the snapshot-update case. Both controls now assert `fresh.ran`. Before the fix, both read `[]`, so the review's "plausible" was real: each control compared the gate with what it had just kept.
- The file is 319 lines (306 before).

## Decisions the brief did not settle

- **Identity.** Expectations are indexed per test file (runner kind and `testFileId`), with one `Pending` per lookup. No identity is added to `GateRun` or `StoredEvidence`, so the types do not change.
- **Unpaired runs.** `Keeper.close()` ends a lookup that no run took. This is the only change in `stored.ts`.
- **Daemon check in B1.** Case 2 starts a real daemon (`lookup-only`) instead of only reading the stores. That proves the stated outcome: "no later daemon reads the result". The cost is one daemon start.

## Type changes

- Additive: `Keeper.close(): void`. New module `keep-expected.ts`, which exports `Expected`, `Pending` and `Expectations`. These were private interfaces of `keep.ts` before.

## For the next step

- The bundles (`plugins/claude-code/dist`, the Codex runtime, the OpenCode package) are not rebuilt; this row does not own them. Three bundle-drift tests fail until the coordinator's bundle commit.
- No key meaning, `KEY_FORMAT_VERSION` or `QUALITY_POLICY_VERSION` changed. The store transactions, the lock and the bounded busy retry are unchanged.
