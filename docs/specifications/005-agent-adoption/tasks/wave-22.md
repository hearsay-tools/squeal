# 005 wave 22: Pi says its registration once; the wake-trace helper test does not depend on a sign

Row 005-107, a repair of 0.1.541 (row 005-98, decision C), found in main CI on 2026-11-18. Coordinator: session 4d2ecbfc. One worker.

Rules: no version raise, no `pnpm run build` in your worktree, no full suite. `test/e2e/**` is outside Squeal's coverage here: run each e2e file that reads a path you change directly, one at a time, `timeout 900`. A check that needs a commit ID is read from CI. Before you report, read Squeal's complete verdict on your changed paths. Write `~`, never a `/home/<user>/` path; the private-material check also rejects the company name and local project folder names.

## W1: 005-107

Use /worker. Shape: repair. Outcome: a Pi session reads its registration text exactly once when nothing was killed; and `test/helpers/pi-wake-trace.test.ts` passes whatever the sign of a 0 ms offset.

Evidence 1 (product). Main CI 44114276401, attempt 1, Node 22 (2/3): `test/e2e/pi.test.ts:116`, "the shipped Pi package, installed with pi install > print: starts the copy's daemon, which passes a baseline, and a PASS -> FAIL reaches the next request": `expect(mentions("registered at revision", start)).toBe(1)` received 2. So the first request carried the registration twice. Since 0.1.541 the Pi session start and the Pi run start register owing their header and clear it "through the held hand-off"; a registered run start says an owed header before `startTurn` (`tasks/005-98/notes.md`, review `reviews/0.1.541-r2.md`). Lead: in print mode the run start can find the header still owed while the session start's own text is on its way (the hand-off not yet taken), and says it again. Find the exact interleaving from the code and a test that forces it; do not guess from timing.

Contract (decision C, unchanged): the registration text reaches the session once; twice only when a start was killed between its output and its mark; never zero times. A run start replays an owed header only when no session-start text for this registration was handed to the host. Check OpenCode's register path for the same interleaving, and say what you found.

Evidence 2 (test only). Main CI 44109737206, Node 26 (2/3): `test/helpers/pi-wake-trace.test.ts:220`, "awaitArmed at its deadline > records a worker that Pi ends with terminate(): its exit code and time": the report read "thread 1: Pi saw it exit with code 1 at +0 ms" and the test expects `/thread 1: Pi saw it exit with code 1 at -\d+ ms/`. The offset can be zero or positive. Fix the assertion (a signed offset) and every other assertion in that file that fixes a sign or an exact time; also review N1 of `../../009-pi-adapter/reviews/009-30-r3.md` (line 235 passes the serialized trace to `expect`: compare a boolean).

Owns: `src/harness/pi/{session,run}.ts` and the Pi delivery path they call, their tests, `test/e2e/pi.test.ts` only if a helper needs it (do not loosen line 116), `test/helpers/pi-wake-trace.test.ts`. Leave alone: `src/core/**`, `src/harness/shared/**` unless the cause is there (then ask first), `src/harness/opencode/**` unless you prove the same defect there (then ask first).

Done when: a deterministic test that fails on main with the registration twice and passes with the fix; the kill cases of 0.1.541 still hold (`test/harness/registration-owed-harnesses.test.ts`); `test/e2e/pi.test.ts` run directly 5 times, each `timeout 900`, all passing; the helper test passes with offsets of -1, 0 and +1 ms forced.

Final message: the interleaving, with file and line; what OpenCode does; check results.
