# Wave 23 (coordinator, 2026-11-14: a defect in row 020-59, shipped in 0.1.495)

One row, from main. Targeted tests only (pin the host load), no full suite, no `pnpm run build` in a worker tree. Notes in `tasks/wave-23-020-64/notes.md`.

## 020-64: a file whose input moves while a busy store refuses its write is never kept

Use /worker. Shape: repair. Read spec D17.3 and D17.5 (as amended by rows 020-59 and its repair R1), `reviews/0.1.495.md` and `0.1.495-r2.md`, and `test/code/gate/keep-early.test.ts` "does not write a file whose input moved after a busy store refused it" (line 146 failed once on CI 43620018937: the file was kept).
- The test moves the input at a fixed 100 ms while the keeper retries a refused write on its own backoff, so a retry can check the input just before the move and write just after the hold ends. Decide from the spec which is right: D17.5 says a refused file is checked again after every pause and before each write; if the keeper can write after an input moved during the busy wait, close that window (check under the same write that keeps the file, or check again right before the write transaction); if the spec allows it, say so and make the test deterministic.
- Either way the test must not depend on timing: drive the order with the keeper's own seams (a clock, a hook between the check and the write), never with sleeps.
Owns: `src/core/code/gate/{keep-pass,keep-queue,keep,keep-write,keep-here}.ts`, `test/code/gate/keep-early*.test.ts`, their tests.
Done when (tests): a deterministic test where the input moves between the busy refusal and the retry shows the file not kept; a deterministic test where it moves after the write shows it kept; the test passes 20 times in a row under load with no sleeps deciding the order.
