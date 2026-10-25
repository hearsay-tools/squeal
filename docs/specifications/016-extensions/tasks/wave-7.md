# Wave 7: another worktree's observed path reaches this daemon's key

One worker, row 016-31, from review `reviews/0.1.323.md` check 4. Spec 016 shipped at 0.1.320; this is a follow-up. Workers do not run `npm run build`.

## 016-31 growth that a read consumes still re-keys its file

Use /worker. Shape: repair. Outcome: when a daemon's view of a shared observed set merges paths another worktree stored for a test file, that file is re-keyed, whatever read did the merge, so an edit of such a path re-runs the file.

Read: the board row 016-31; `reviews/0.1.323.md` check 4 and its next-wave input; `tasks/016-29/notes.md`; 011 C3 (the observed-paths sentence).

Starting seam: `SharedPaths.of` and `refresh` in `src/core/keys/observed.ts`, where a read after `write` merges the project's map and discards the grown entries, and `WorktreeKeys.refreshObserved` / `regrowObserved` in `src/core/scheduler/keying.ts` (`#grownElsewhere`). First edit, as a lead: the reviewer's probe as a test in `test/keys/observed.test.ts` or `test/scheduler/`: two views over one store key files A and B; the second stores `y` for B; the first stores `x` for A, then reads A before `regrowObserved()`; changing `y` must re-key B. It fails on main. Lead for the fix: keep grown entries until the keying layer consumes them, even when `of` or `see` refreshes first. First step: send me a request with the test's result on main and your design before you build past it.

Owns: `src/core/keys/observed.ts`; in `src/core/scheduler/keying.ts` the observed-set members only; `test/keys/observed.test.ts`; `test/scheduler/one-write-path.test.ts` and one new file under `test/scheduler/` if you need it.

Leave alone: `src/runners/**`; the validity harness; other scheduler files; spec text.

Done when:
- the new test fails on main and passes;
- 016-29's union, rollback and restart tests pass unchanged;
- `test/keys/key-format.test.ts` passes with no version raised, and compare-refs at `squeal--v0.1.323` shows equal keys, uncovered 0;
- `squeal run --all --wait` is green, except the bundle drift a worker tree always shows.
