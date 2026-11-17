# 011 wave 121: no whole-store check at a daemon start; damage marks the store when it is hit

Row 011-391, chosen by the human 2026-11-18 (option A). Coordinator: session 4d2ecbfc (the scheduler coordinator's task ended). One worker.

Why: a daemon start runs `PRAGMA quick_check` on the whole shared store before it serves: 82.7 s cold and 12.6 s warm on a copy of one 4.9 GB store, 36.3 s and 2.9 s on a 4.2 GB one, at about 230 and 450 starts a day (`../../005-agent-adoption/research/session-start-cost.md`, section 7). The full `integrity_check` already runs once per store per 24 h after serving and leaves a mark that stops every daemon within a heartbeat (row 011-226). What is missing today: a corruption error on a normal read or write is only logged; nothing marks the store.

Rules: no version raise, no `pnpm run build` in your worktree, no full suite. A new line under `src/core/store/**` needs a validity case (`test/keys/key-format.test.ts`). `test/e2e/**` is outside Squeal's coverage here: grep ALL of `test/`; run each e2e file that reads a path you change directly, one at a time, `timeout 900`. Before you report, read Squeal's complete verdict on your changed paths. Write `~`, never a `/home/<user>/` path; the private-material check also rejects the company name and local project folder names.

## W1: 011-391

Use /worker. Shape: slice. Outcome: a daemon start runs no whole-store check; a store found damaged at any time is marked, every daemon on it stops, and the next start moves it aside, as after a failed full check today.

Read: `src/core/store/open.ts` (`checkIntegrity`, `connect`, `integrityProblem`, `isCorruption`, `markStore`, `recover`, `moveAside`); `src/core/daemon/open.ts` (`openStoreFile`, about lines 221 to 248); `src/core/daemon/full-check.ts`, `full-check-claim.ts`; `src/core/daemon/lifecycle.ts` (`attempt`, the heartbeat's `storeCondemned`); `src/harness/shared/context.ts` (a corrupt open returns null: hooks stay silent); spec 011 "store failures" with its 2026-10-25 amendment, and 001 D12.

Build:
1. The daemon's open passes no whole-store check. It still acts on the mark a failed check left, and on a corruption error thrown by the open itself (both move the store aside, as now).
2. One place classifies a thrown store error as corruption (`isCorruption`) for the daemon's timers and request handlers: on corruption the daemon writes the mark (`markStore`, with what it saw) and a persisted note, then stops as `store-unusable`. Other daemons on the store stop at their next heartbeat, as after a failed full check.
3. A hook that meets a corrupt store (an open or a read that throws corruption) writes the same mark when it can, and stays silent as now; it never moves the store.
4. The first full check of a store (no `META_FULL_CHECK` yet) still runs after serving; say in the notes how long a new store goes unchecked.
5. The note status prints after the move says what found the damage (a start's open, the full check, a read or write while running).

Owns: `src/core/daemon/{open,lifecycle,daemon}.ts` and the daemon's error paths, `src/core/store/open.ts` (the `checkIntegrity` option and the mark only), `src/harness/shared/context.ts` (the mark on a corrupt open), their tests, the validity cases. Another worker (row 005-105) adds a call in the daemon's open that makes additive store objects: keep your change to `openStoreFile` small and say in your notes exactly which lines you touched. Leave alone: `src/core/store/schema.ts`, `src/core/delivery/**`, `src/core/scheduler/**`.

Done when: tests with a really damaged store file (overwrite pages of a copy): a start on it with no mark serves until a read hits the damage, then marks, stops, and the next start moves it aside with the note; a start on a store whose header is damaged moves it aside at once; a failed full check behaves as before; a hook on a damaged store marks it and prints nothing; a daemon start on a large synthetic store no longer reads every page (assert no `quick_check` statement is issued; do not assert a time); two daemons on one store both stop. The spec text for 011 "store failures" and 001 D12 as a proposed amendment in your notes (`tasks/011-391/notes.md`); the coordinator lands it.

Final message: what a damaged store does now, case by case; the lines touched in `openStoreFile`; the proposed spec amendment; check results.
