# Optimizer-start marker race review

PASS 4cb5ebd8a588607440af8f6ff48067632753a2b2

Counts: 0 blockers, 0 should-fix findings, 0 nits.

## Verification

Reviewed candidate `cand/optimizer-start-race` at exactly
`4cb5ebd8a588607440af8f6ff48067632753a2b2`, against parent
`62748fc8c10055b3fc2475a5a514a13684e58d9c`. `git rev-parse HEAD`
returned that candidate. `git status --short` was empty before and after
all code checks, including the build. The candidate changes one file:
`test/integration/optimizer-start.test.ts`, four inserted and two removed lines.

Dependencies were installed by Squawk with `pnpm install --frozen-lockfile`
before this session (reported duration 1 s). Per the brief, installation was
not repeated. This is setup evidence supplied by the launcher.

Commands run on the clean candidate:

| Command | Actual result |
| --- | --- |
| `pnpm run lint` | Exit 0. `Checked 3618 files in 1089ms. No fixes applied.` |
| `pnpm run typecheck` | Exit 0. `tsrs --fast --noEmit`, no diagnostics. |
| `pnpm run build` | Exit 0. TypeScript and all four plugin builds completed. No tracked drift. |
| `pnpm run check:private` | Exit 0. `private: 4 added lines in 1 files over 62748fc8c10055b3fc2475a5a514a13684e58d9c, ok`. Warning: `SQUEAL_PRIVATE_DENYLIST is empty; the private denylist rule is skipped`. |
| Squeal `status --wait 60000 test/integration/optimizer-start.test.ts` | Revision 0: `no known failures; 1 test file, each with a current result`. Worktree: 61 of 1923 test files unknown; no claim is made about those files. |

The brief explicitly requires five direct runs. Each command was
`timeout 600 pnpm exec vitest run test/integration/optimizer-start.test.ts`.
They ran sequentially on the clean candidate:

| Run | Actual output | Duration | Exit |
| --- | --- | --- | --- |
| 1 | `Test Files 1 passed (1)`; `Tests 2 passed (2)` | 13.03 s | 0 |
| 2 | `Test Files 1 passed (1)`; `Tests 2 passed (2)` | 12.75 s | 0 |
| 3 | `Test Files 1 passed (1)`; `Tests 2 passed (2)` | 14.02 s | 0 |
| 4 | `Test Files 1 passed (1)`; `Tests 2 passed (2)` | 12.81 s | 0 |
| 5 | `Test Files 1 passed (1)`; `Tests 2 passed (2)` | 14.76 s | 0 |

CI queried with `gh run list --commit 4cb5ebd8a588607440af8f6ff48067632753a2b2`:

- [Private material 44113577299](https://github.com/hearsay-tools/squeal/actions/runs/44113577299): completed, success.
- [CI 44113577262](https://github.com/hearsay-tools/squeal/actions/runs/44113577262): in progress at the review observation. Full-suite success remains **unverified**, not a blocker against this diff. No local full suite was run.

## Scope and findings

No blockers, should-fix findings or nits.

The task is a narrow test-harness repair after main CI 44107971129. The
candidate does not implement or change spec 023's command contracts.
The review checks the brief's requirements: remove the marker race, retain
the assertions, and add no other behavior.

## What fits

At `test/integration/optimizer-start.test.ts:99`, successful `mkdir` is the
claim. Concurrent calls cannot both create the same directory. The winner
keeps it until the existing `afterAll` removes the shim directory recursively.
There is no interval between checking marker absence and creating the marker.
Only the winning call can wait for NEW, restore OLD, append its newline and
write `planted`. Later calls run the real git, as before. Expected losing
`mkdir` errors are redirected to avoid new output. The cache-directory guard,
optimizer wait, timeout, restore bytes, planted marker and git arguments are
unchanged. Each shim has its own new UUID directory, so its claim starts absent.

The diff leaves the test body byte-for-byte unchanged. All three outcome
assertions remain: restored bytes equal OLD, stored state equals `current fail`,
and the fresh adapter reports `fail`. The separate planted-marker precondition
also remains unchanged. Both `observe` values still run. All ten test cases
across the five runs passed. These runs support the repair; filesystem claim
semantics explain why multiple git calls cannot enter the restore block.

The vision's provenance rules remain intact: the test still compares daemon
results with a fresh adapter on the restored bytes. No product interface,
status, delivery, dependency, timeout or assertion changed.

## Inputs for the next wave

No fix wave is needed for this diff. Keep the atomic claim for the full shim
lifetime. The coordinator must read the pending candidate CI result before
landing under the repository's process. This review does not claim a passing
full suite or release approval.
