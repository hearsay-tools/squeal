# 011-76 notes: the test-file frame beside `location`

Worker e57963f3, 2026-10-21, brief W3 of `../wave-9.md`, base 598ffbd30 (reviewed `cand/0.1.239` plus docs).

## Seam map

- `src/core/status/test-frame.ts`: `testFileFrame(check, errors)`, pure. It reads `errors[0].stack` line by line: V8 frames (`at <fn> (<position>)`, `at <position>`, the position after the first ` (` so a route group's `app/(auth)/…` path parses), pytest long and short entries (`<path>:<line>: `) and native entries (`File "<path>", line <n>`). `atText` and `locationText` print `at <location>, called from <path>:<line>[:<column>]`.
- `src/core/delivery/attribution.ts`: `testFileFrames(store, worktreeId)` is a reader. It takes the key the state sink recorded for the failure (`readFailureKeys`, own and inherited), reads `results.byKey` once per key, and takes that check's failing row only when its `errors[0].location` equals the failure's `location`. `attribute` gives it to each failing entry. `withTestFileFrames` gives it to known failures. `withClosureChanges` calls it for the registration (and Stop's registration), so `delivery.ts` is unchanged.
- `src/core/status/snapshot.ts:143`: `status`'s known failures go through `withTestFileFrames`. This was not in the brief; the coordinator agreed to it (commit 5f1c1bc21).
- `src/core/status/why.ts`: the frame comes from `shown`, the result `shownResult` names as behind the known state, and only when it is a fail. `format-why.ts` prints it on `Location:`.
- Types: `TestFileFrame` in `src/core/types/common.ts` (`column?`, which pytest lacks); `testFileFrame?` on `TransitionEntry`, `KnownFailure` and `WhyReport`. All additive.

## Decisions the design did not settle

1. **pytest paths from a cwd below the root.** Real long and short reports name paths from pytest's cwd (`frames/test_frames.py:6:`). The check's test path is root-relative (`py/frames/test_frames.py`). The design's "the first line whose path is the check's test path" therefore misses every pytest project below the worktree root. `testFileFrame` reads the missing prefix from the stack position that names `location` (same line, a path that ends `location`'s path), then matches the test path with it. It never guesses: when no position names `location`, there is no frame, for any runner. Native reports are absolute, so stored root-relative, and match without a prefix.
2. **pytest's "first" frame is the outermost.** pytest prints the test function first, so the frame is the test's own line, not the nearest test-file line to the throw. That follows the spec's "the first frame in that file". V8 stacks list the innermost frame first, so there the frame is the nearest.
3. **A location in the test file gives no frame.** This holds even when the first test-file frame is on another line (pytest, a helper defined in the test file). The spec names the frame only for "a failure whose location is not in its check's own test file".
4. **The row must be the failure's.** The row at the failure key counts only when it fails at the failure's `location`. Another run's different failure, or a pass, at the same key gives no frame.

## For R3 (011-77) and 011-75

- `failures` is not in this row (`src/core/status/failures.ts` is 011-75's, then R3's). For its frame, call `testFileFrame(row.check, row.errors)` on each listed stored row. That row is the failure itself, so no key lookup is needed. Print it with `atText`.
- Test 4: `test/keys/key-format.test.ts` fails at the base 598ffbd30 as it does here. It names only `src/runners/vitest/run.ts:75-78` (review 0.1.239's B2 repair), not a line of this row. This was checked in a throwaway worktree at the base.

## pytest fixtures

`test/status/recorded/README.md` says how the four recordings were made: a real pytest 9.1.1 run on Python 3.13.14 per traceback style, from the repository's own `small` fixture synced with uv, with Squeal's `squeal_pytest` plugin, and the project in `py/` below the root.
