# Wave 87.5: repair of row 011-336 after review 011-336

Coordinator cdd216e5, 2026-11-14. Review `reviews/011-336.md` FAIL on `cand/011-336` at `401fed822`: blocker B1; S1 nonblocking, folded in here because it is the same helper. Checks 1, 2 and 4 passed (`removeTree` passed 5 of 5 against a live writer on Node 22, where a plain `rmSync` failed 5 of 5).

## W1: repair B1 and S1

Use /worker. Worker 398af59b, resumed in its own worktree. Shape: repair, test first. Tests only.

- **B1.** `awaitBridges` (`test/harness/opencode/real.ts`) takes any process whose command line mentions `<dist>/hooks/`, and `awaitGroups` (`test/helpers/process-groups.ts`) kills its whole group: an unrelated `tail -f` on a hook file was killed. Establish a bridge's identity before taking its process group: the Node executable running a hook entrypoint under this run's built dir, leading its own detached group, and tied to this run (for example its environment's private `HOME` or `TMPDIR`, read from `/proc/<pid>/environ`). A process that is not this run's is never waited on or signalled.
- **S1.** After its final wait, `awaitGroups` reports the members still alive; the caller fails with them, keeping the first error as the cause, and does not remove the folder as if they had exited.

First edit: the review's negative test (a disposable unrelated process that mentions the hook path stays alive and does not use the bridge grace), and a positive test (an owned bridge and its surviving child are still waited for). Then the change.

Owns and leave alone as in `wave-87.md` W1. Done when: both tests pass, the existing helper tests pass on the Node versions available, lint and typecheck pass; the notes say what changed. One commit for the tests, one for the change.

## R2: narrow re-review

Use /reviewer (codex gpt-6.1-sol high), pinned to the repaired candidate: B1 and S1 only, and that checks 1, 2 and 4 still hold. Write `reviews/011-336-r2.md`.
