# Row 011-310 notes: a malformed stored observed path cannot stop the daemon

Worker 8176bb3a, 2026-11-09. Brief: `../011-310.md`. Research: `../../research/issue-166.md`.

## Validation point

`WorktreeKeys.effectiveObserved` (`src/core/scheduler/keying.ts`) keeps only the observed paths `isClosurePath` (`src/core/keys/closure.ts`) accepts: a listing path, or a path `normalizeRelativePath` accepts. It is the one read every keying consumer uses:

- `setClosure`, the closure every key is built from;
- `keysAlike` in `src/core/scheduler/import-rewalk.ts`, which assembles the same closure;
- `observedGrowth` in `src/core/scheduler/observed.ts`, the record-time growth: a refused path is never tracked, hashed or checked for stability;
- `#release`, the release of inherited extra files.

`ObservedSets` and the store stay unchanged. The shared set keeps every entry (C3: never pruned), so the mark is the same on a restart and in every worktree. `edit-cut.ts` and `runtimeApplication` call `observedOf(...).includes(path)`. They compare strings and cannot throw.

## Mark: the key differs, it is not reused

`RefusedObserved.keyed` (`src/core/scheduler/refused-observed.ts`) gives `KeyIndex.setClosure` its `runtime` argument. With no refused path, that argument is `runtimeIdentity(...)` as before, so no valid key moves. With refused paths, it is `JSON.stringify(["squeal-refused-observed/1", refused, runtime])`. The key then differs from the key over the valid paths, so a result stored before the path appeared is not current. A non-empty `runtime` also turns off `keysReadAsOne` for the file. `keys.runtimeIdentity(ref)`, which tiers compare as `runtimePolicy`, is unchanged, so store decisions stay as they were.

Why not drop the path: a dropped path keys as the valid-only key and reuses a result stored before the path was observed. Why not refuse it at `see`: the next restart would lose the mark and move the key back. Why not move the recorder fix: the recorder is right under C12. `\home\...` read on POSIX is a file name under the worktree; Squeal's normalizer reads its backslashes as separators.

A run that observes a refused path: `add` holds the path and `growth` does not. `recordCompleted` calls `addObserved`, which stores the path and marks the key, then stores the run's result under the marked key (`store`, `at: "grown"`). Later runs of the same file store under the same key. There is no re-run loop.

## Note

One daemon note per test file, per change of its refused set. A restart skips a text an earlier daemon of the same worktree persisted. Text for one path:

`observed path left out of <project>:<test path>: "<path>" is not a worktree-relative path; the file's key marks its closure incomplete, so no result stored before the path was observed is reused`

## Key-format alarm

Every earlier validity case agrees with squeal--v0.1.418. The new case `test/keys/validity/cases/assemble/refused.ts` ("a stored observed path that is not worktree-relative, left out of the closure") throws at 0.1.418. Its `lastThrows` is `expected a worktree-relative path, got "\home\agent\AppData\Local\Hearsay Squawk\cache"`. The verdict reports such a case instead of asking a raise, only while the candidate throws nothing (`threwAsExpected` in `test/keys/validity/verdict.ts`; the coordinator approved option A). The field goes inert once the last release keys the input. Whoever releases after 0.1.419 sees the case compare normally.

## Tests

- `test/scheduler/observed-malformed.test.ts`: keying over a shared store. It covers a clean control, a persisted entry, a restart, a second worktree and a run's own record.
- `test/daemon/observed-malformed.test.ts`: real in-process daemons. It covers a control, a first start, a restart and a `git worktree add` second worktree. On the pre-fix source it failed with the incident's `start-failed` error. It is listed in `test/version-sensitive.txt`.
- `test/scheduler/refused-observed.test.ts`, `test/keys/closure.test.ts`: the mark, the note and `isClosurePath`.

## Open

- `observedDirect`, `observedModules` and `observedStartup` are not validated. None of them reaches `assembleClosure` or `normalizeRelativePath`, so none can throw this way.
