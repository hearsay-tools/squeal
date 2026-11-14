# Wave 22.6: repair of `cand/0.1.495` (review `reviews/0.1.495.md`: FAIL)

Each worker repairs on its own branch; the coordinator replays both repairs onto the merged candidate (`w22ab/land`, rows 020-59 and 020-60 together). Read the review's "Inputs for the repair wave". Same check rules as `tasks/wave-22.md`; pin the host load.

## R1 (row 020-59, B1 and B3)

Use /worker. Shape: repair. Read `reviews/0.1.495.md` B1 and B3, with their probes and worker-sized fixes.
- B1: an early pass with no usable writer (the worktree's singleton lock held for a moment, no fresh daemon record) drops a completed file for good. Keep the whole unwritten run (grown-key files and pending reads included) and try it again through the early-writes queue; no terminal note for an early failure; revalidate inputs and the merge hold on the later try.
- B3: `openingCheck` (`keep-pass.ts:107`) runs outside the pass's failure boundary, so an input read error escapes to `Keeper.flush`. Move it inside; keep the queue when opening fails, retry during the run, and give the bounded final not-kept note if it still fails after the report. No early-pass promise may escape.
- Keep one active pass, 20 ms local write slices, deferred notes, and a fresh 30 s final busy bound after the report; retried queues keep their lookup snapshot and every write-time check.
Owns: `src/core/code/gate/{keep-pass,keep-queue,keep,keep-write,keep-here}.ts`, keeper tests.
Done when (tests): the review's B1 probe keeps the file once the lock frees before the flush; the B3 probe recovers on retry, and a failure that lasts past the report gives the not-kept note; `flush` never rejects.

## R2 (row 020-60, B2)

Use /worker. Shape: repair. Read `reviews/0.1.495.md` B2.
- With `--rerun-stored-failures`, a run whose only files are stored-failure reruns prints "none to run" before the run and omits the global setup that does run. Make the pre-run summary count files marked for a stored rerun as files that will run (apart from those read from the stores) and include their projects and the root in the global-setup disclosure (D14.4). Keep them out of the duration estimate and the early stop (D3.4); never make them an ordinary first run, drop their fallback failure, or rerun them twice.
Owns: `src/core/code/gate/{prerun,stored}.ts`, `src/cli/code-gate-prerun.ts`, their tests.
Done when (tests): a stored-only rerun prints a correct count and its global-setup line; a mixed case (stored reruns beside ordinary files) counts both right; estimates and early stop unchanged.
