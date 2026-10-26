# 011-242 notes: dead helpers gone, one owner for repeated rules

Worker 9e9705ba, 2026-10-26. Wave 48 W2. Row 011-242; `quality/2026-10-26-b.md` slices 1, 2, 4 to 8, 10 and 12. Baseline `9622b9ed0`. No line, JSON field, key or adapter version changes.

## Slices

| Slice | Commit | What changed |
|---|---|---|
| 1 | `20cd7a2b7` | `publishedYields` and `yields.ts`'s `ENDED_WRITE_MS` re-export removed. The five test callers read `publishedYieldRow(...).tiers`; the scan named four, and `tier-yields-text.test.ts` was a fifth. `tier-yields-ended-count.test.ts` imports `ENDED_WRITE_MS` from `yield-history.ts`. |
| 2 | `6991a32ca` | `next-step.ts`'s `laneText` re-export removed. |
| 4 | `f29f0b581` | `pendingAt(testFile, key)` in `records.ts`, a predicate. `cancelRetries`, `endRetries` and `markGateClosed` call it, as the scan asks. `claimRetries` and `askNoResultRun` in the same file wrote the same rule as `retriesAt(...)` with `r.end === null`, and call it too. `askNamedRun` is not touched: slice 3 (row 011-241) changes it. |
| 5 | `e802fa448` | `loadRetryDue(since, now)` in `gate.ts`, `now - since >= LOAD_RETRY_WAIT_MS`. `scheduler/retries.ts`, `outstanding-text.ts` (twice) and `retry/text.ts` call it. `retry/index.ts` exports it beside `LOAD_RETRY_WAIT_MS`, since `scheduler/retries.ts` imports from the barrel. New case in `test/retry/gate.test.ts`: false 1 ms before the bound, true at it. |
| 6 | `49bb804d7` | `durationText(ms, round = Math.round)` in `src/core/text.ts`. `slow-text.ts`'s copy is removed; `slot-holders.ts` imports from `core/text.ts`, and `state/index.ts` no longer exports it. `retry/text.ts`'s `waitedText` is one line, `durationText(ms, Math.floor)`, so the retry texts keep `floor` in one place. New case in `test/text.test.ts`: 599.6 s reads "10 min" rounded and "9 min 59 s" floored. |
| 7 | `be7a4513f` | `IntegrityCheck` is `"quick"` only; `integrityProblem` runs `quick_check`. The `"full"` half of `test/store/open.test.ts`'s index-fault case is removed, with a comment that names the two tests that cover it. |
| 8 | `7844bb14a` | `sameFile` exported from `store-file.ts`; `openDaemon`'s copy is removed, and `storeCondemned` calls it. |
| 10 | `c486b6d40` | `test/scheduler/model-plans.ts` (135 lines): `Ev`, `SLOWS`, `P`, `Q`, `ALL`, `E2E`, `Plan`, `rng`, `pick`, `plan`, `backlogPlan`, `slowPlan`. `test/scheduler/model-checks.ts` (203): `Violation`, `Closed`, `Checks`, `slow`. `model-fixture.ts` is 383 lines (was 510), `model-scheduler.test.ts` 266 (was 469). |
| 12 | `59170a8cf` | `RunReport.completedFiles` states 001 D12's rule with the two proofs (011-137, 011-232). The comments of `runNodeTest`, pytest's `completedOf` and Vitest's `buildReport` cite `RunReport.completedFiles`. Comments only. |

## Evidence

- Lint: `npm run lint`, "Checked 2228 files ... No fixes applied." Typecheck: `npm run typecheck`, no errors.
- Slice 10, same sequences: a scratch script (outside the tree) printed the JSON of every seeded plan the test plays (`plan(173, 12, "vitest")`, seeds 1 to 24 and 60, backlog seeds 1 to 6, slow-lane seeds 1 to 8, and the file constants). sha256 `187077391f36669039505d6cffbc89e9a65874ad3929ac60209bafc89925372a`, 19,601 bytes, from `model-fixture.ts` before and from `model-plans.ts` after.
- Slice 10, same code: `diff` of each moved block against `HEAD~` is empty: the plans exactly, the checks except `export` on `Violation`, `Closed` and `Checks`, and the two files' remaining parts.
- Slice 10, same outcome: Squeal gave `model-scheduler.test.ts` a current pass at revision 15 (before the move) and at revision 18 (after). `squeal code test/scheduler/model-checks.ts` shows the `Checks` lines run by one test file.
- Slice 12, comments only: `esbuild --loader=ts --format=esm` gives the same output for the three `run.ts` and `types/runner.ts` at `HEAD~` and `HEAD`.
- `test/keys/key-format.test.ts`: PASS, run in this worktree at revision 18 (slice 12 in the tree), 719 ms, no version moved.

## For the next worker or the coordinator

- Bundle drift, expected: the OpenCode and Pi package tests fail, "cli/ps.mjs differs from the build". The row may not run `npm run build`; the coordinator's build at integration closes it. The other plugin bundle tests read the same drift.
- `squeal code` reports `Checks.#add` (`test/scheduler/model-checks.ts`) as reached by no test. It runs only when an invariant breaks, and none breaks. It was the same in the test file, where Squeal judges no coverage.
- The scan named four test callers of `publishedYields`; there were five (`tier-yields-text.test.ts`).
- A host defect, not this row's: `test/ps/proc-live.test.ts`, "ss -xle ties a listening socket file to its inode", fails on this host in every worktree, directly (`npx vitest run test/ps/proc-live.test.ts`: 1 failed, 4 passed) and under Squeal (a retry with reason `environment` failed again). `ss` prints the socket inode as a signed 32-bit number once the kernel's counter passes 2^31: a fresh socket here reads `u_str LISTEN 0 511 <path> -2068677298 * 0 <-> ino:74585546 ...`. `unixListeners`'s regex (`src/core/ps/proc.ts:168`) has `\s+\d+\s+\*` there, so it rejects the minus sign and finds no listener. The fix is `-?\d+`. Sent to the coordinator for a row; this row's only link to the test is a comment in `src/core/types/runner.ts`.
