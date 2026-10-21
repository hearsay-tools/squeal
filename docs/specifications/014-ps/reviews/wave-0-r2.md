# Wave 0 re-review, round 2

PASS ab817c04e10e4eb4bd0bbd0ae588e79f23670c35

Zero blockers, zero remaining should-fix items, zero new findings.

## Verification output

Pinned candidate: `cand/014-04` at `ab817c04e10e4eb4bd0bbd0ae588e79f23670c35`. This re-review is bounded by B1 and S1 in `reviews/wave-0.md` and the repair delta `4b5d200a7..ab817c04e`.

The delta contains only repairs `3589079a2` and `85f2fc629`, plus the unchanged first-round report cherry-picked as `ab817c04e`. The changed files are `shape.ts`, `model.ts`, two `test/ps` files, the D8 spec block, its amendment log, and that report. `proc.ts`, `source.ts`, bundles, dependency files and all other product files are unchanged.

Dependencies from the earlier `npm ci` remain installed. `package.json` and `package-lock.json` have no delta, so another install was not needed. All checks below ran at the exact candidate with a clean tracked tree. Only this report was written afterward.

```text
$ git rev-parse HEAD
ab817c04e10e4eb4bd0bbd0ae588e79f23670c35
$ git status --short
(no output)

$ npm run lint
> biome check .
Checked 1588 files in 930ms. No fixes applied.
(exit 0)

$ npm run typecheck
> tsc --noEmit
(exit 0)

$ npx vitest run test/ps --maxWorkers=4
Test Files  3 passed (3)
     Tests  32 passed (32)
  Duration  1.56s (transform 81%, tests 14%, import 5%)
(exit 0)
```

The focused test run started at 2026-10-21 10:57:04 UTC and ended at 10:57:07 UTC. Load was `26.36 32.81 39.37` at start and `27.21 32.88 39.36` at end. No new full run or build was requested for this narrow repair. This report makes no new full-suite, CI or macOS runtime claim. The earlier full run and its isolated recovery remain recorded against the earlier commit in `wave-0.md`.

## Findings

### B1 resolved, proven: the shared types now carry unflagged counts

Locations: `src/core/ps/shape.ts:31`, `src/core/ps/shape.ts:232`, `src/core/ps/model.ts:199`, `test/ps/shape.test.ts:172`.

`PsSnapshot.unflaggedFiles` is a collection of `{ kind, count }`, or `null` without `--full`. The four kinds cover D7's harmless files: `lock`, `waiter-lock`, `surplus-permit`, and `session-root`. These entries require neither a flag nor an end command. `FlagFindings.unflagged` carries the same typed counts to the snapshot assembler. `Render` can still consume only the snapshot and its options.

The amended D8 block matches the types, and `status.md` records the amendment. The tests preserve `null` without `--full`, check the new JSON keys, and express the exact prior failure case: four waiter lock files, no file flags, zero total flags, and no end command on the counts. That case passes. The interface no longer requires a change for this requirement in wave 2.

### S1 resolved, proven by source inspection and the focused suite

Location: `test/ps/proc.test.ts:127`.

The privacy loop filters out the `"unreadable"` fixture when `isRoot` is true. It uses the same filtered list both to read marks and to calculate expectations. Thus root cannot enter the former incorrect null assertion for that fixture. Non-root coverage remains. The separate permission test still skips root, and the no-output assertions remain in place. No production environment reader changed.

An actual root run was not performed. The repaired branch condition directly removes the previously identified failure path; all 32 focused tests pass under the current non-root user.

### N1 resolved outside this candidate

Commit `2cf8e9be6` changes the board's 014-04 row to `review` and 014-05 to `running`. Its diff was checked. The candidate retains its pinned board snapshot; this re-review does not reopen the documentation nit or edit the board.

No new issue was found in the bounded repair delta. The first-round findings outside this delta remain settled.
