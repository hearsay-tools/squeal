# Wave 61.5: repair of review 0.1.383 (B1, S1)

Coordinator 339e9539, 2026-10-31. Review `reviews/0.1.383.md` FAIL on `cand/0.1.383` `539ce6844`: B1 proven, S1 plausible. Host policy as in `wave-60.md`. No `pnpm run build`; not yours: board, spec, `status.md`, bundles, version.

## RP1: B1 (row 011-277) and S1 (row 011-276's e2e test)

Use /worker. Shape: repair, two commits, B1 then S1, on the candidate.

Read: `reviews/0.1.383.md` B1 and S1 (B1 has the reproduction and the bounded fix); `tasks/011-277/notes.md`, `tasks/011-276/notes.md`; spec 011 C1.

B1: `src/cli/stop-removed.ts` pings only `socketPathFor(id)` from the caller's environment and reads the saved row only as a Boolean (`rowKept`). Apply C1's rule: the recorded socket first when its heartbeat is fresh and a daemon answers there with this root and id, else the computed one. Reuse the existing `daemonSocket` / `locateDaemon` logic where it fits. Never say "No daemon running" while a recorded socket was not examined; then the result is unknown, exit 1. Keep: the exit-1 refusal for a path never recorded, the ban on the enclosing checkout, the root, id and start checks. Add the review's different-`XDG_RUNTIME_DIR` regression, with worktree B still running.

S1: `test/e2e/lifecycle.test.ts` expects the plain recovery headline after a no-daemon reading. The reviewer says `formatLiveness` (`src/core/delivery/format.ts:485`) always adds ": its heartbeat is current"; the coordinator saw the plain headline in one e2e run at `539ce6844`'s parent. Read the formatter and settle which is true; make the test assert what the formatter writes in each branch, and say in the notes how you know.

Owns: `src/cli/stop-removed.ts`, `src/cli/stop-waits.ts`, `src/cli/daemon-access.ts` where needed, `test/cli/stop-removed.test.ts`, `test/e2e/lifecycle.test.ts`, a section R1 in each row's notes.

Done when: the B1 regression fails before and passes after; the existing stop tests pass; S1 settled with evidence; lint and typecheck pass; affected results read with `squeal status --wait 60000 <paths>`. The e2e file needs built bundles; say if you could not run it.

Stop and report if B1 needs a change to how a daemon records its socket.
