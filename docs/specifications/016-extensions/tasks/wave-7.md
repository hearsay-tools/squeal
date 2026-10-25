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

## Review of the wave 7 candidate (016-31)

Use /reviewer. The candidate branch and SHA are named in the spawn. The range is `origin/main..<SHA>`: three commits of worker 00f19154 (the failing test, the fix, notes), the coordinator's status line, and the version raise with the bundle commit. Write `docs/specifications/016-extensions/reviews/<version>.md` and commit it alone on your branch.

Read: the brief above; `tasks/016-31/notes.md`; `reviews/0.1.323.md` check 4; 011 C3 (the observed-paths sentence); the board rows 016-31 and 016-32.

Check, with proof where you can:
1. `test/scheduler/observed-regrow.test.ts` fails on `origin/main` and passes here.
2. After its own write, a view answers `of` and `see` without other worktrees' new paths until the next `refresh`. Find every product caller that keys from `of` or `see` after a write and before a `refresh`. Say whether any of them can store a result at a key that lacks a path the store holds (a missed re-run), or only an over-run.
3. Stored bytes are unchanged: compare-refs at `squeal--v0.1.323` gives equal keys for every case, uncovered 0, and `KEY_FORMAT_VERSION` is unchanged.
4. The two changed assertions in the 001-132 case of `test/keys/observed.test.ts` pinned the old read after a write, not a behaviour a caller needs.
5. Row 016-32: in main CI 40233841099, attempt 1 (Node 22, shard 1/3), `test/e2e/slow-vitest.test.ts` > claude-code > "reports the fast tests first, runs the slow file on idle and on run --slow" failed at `test/e2e/slow-shape.ts:129`. After the Stop, `test/strings.test.ts` ran again beside `test/e2e/cli.test.ts`. Can 016-29's writes of the shared observed sets, or this change, re-key the fast file there? Or what else runs a failing fast file again at idle? Run that e2e file 5 times here and report each result. Give the most likely cause, labelled proven, plausible or unverified.

Run lint, typecheck, `test/scheduler/observed-regrow.test.ts`, `test/keys/observed.test.ts`, `test/scheduler/one-write-path.test.ts`, `test/keys/key-format.test.ts` and `test/kit/*.test.ts` on Node 22 and Node 24, and the locked full suite: `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`. Label findings proven, plausible or unverified. Only a proven break blocks. Verdict: PASS or FAIL.
