# Wave 24 (coordinator, 2026-11-14: two repo-local test rows)

One worker, from main. Targeted tests only (pin the host load), no full suite, no `pnpm run build` in a worker tree. Notes in `tasks/wave-24/notes.md`.

## 020-62 and 020-66

Use /worker. Shape: repair (test-only unless the evidence shows a product fault; ask the parent before any product change).
- 020-62: `test/cli/ci-record.test.ts` "exits with the command's code" (line 205) failed on main CI 43609758910 and 43616683145: the bare Vitest run of the crashing fixture (`setTimeout(() => { throw }, 0)` inside the test) exited 0, because the timer had not fired before the worker ended. Make the fixture fail the same way every run (for example an error the test itself throws or awaits, or an unhandled rejection the test waits for) while the test still proves that `ci record` passes on the command's exit code. If the evidence shows `ci record` itself can drop a real error, stop and ask.
- 020-66 (review 0.1.499 S1): with an injected pause, releasing the pause and calling `stop` in the same turn lets `EarlyWrites` (`src/core/code/gate/keep-queue.ts`) start one more pass with `stopped` set. Make `stop` after a pause's release start no pass, with a test that orders it through the pause seam.
Owns: `test/cli/ci-record.test.ts` and its fixtures, `src/core/code/gate/keep-queue.ts`, `test/code/gate/keep-early*.test.ts`.
Done when (tests): the ci-record test passes 20 times in a row on Node 26 and keeps its exit-code assertion; the stop-after-release test fails before the fix and passes after; no other behaviour changes.
