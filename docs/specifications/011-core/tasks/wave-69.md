# Wave 69: row 011-294 (daemon presence: the writers)

Coordinator 48454288, 2026-11-04. After 011-293 lands (0.1.403). Row 011-295 shares `harness/shared/ensure.ts`, `cli/start.ts` and `delivery/liveness.ts` with this row, so it runs after this row, in wave 70.

Host policy, as in `wave-60.md`: no local full suite, no `squeal run --all`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on every test command; private `/tmp` fixtures; never make CPU load on purpose; no `pnpm run build`; no real harness session under the real HOME. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version. Read affected results with `squeal status --wait 60000 <paths>`.

## W1: row 011-294 (the writers report presence events)

Use /worker. Shape: slice, test first, one commit per step.

Outcome: the daemon, hooks and CLI report presence events to `src/core/presence/`; only the module knows the stored keys and formats; every stored byte and write moment stays as it is.

Read: the board row 011-294; `research/daemon-presence.md` decision 2; `GLOSSARY.md` (Presence event); `tasks/011-293/notes.md` ("For 011-294" and R1); `reviews/0.1.403.md` ("Inputs for the repair and next wave"); spec 011 C9.

Seam and lead: a new `src/core/presence/events.ts`, one function per event: registered, beat, exiting, rested, spawned, start marked and cleared, stopped by request, handoff claimed and ended, feed delivered. First edit: move `markStart`, `clearStartMark` and `markSpawn` from `daemon/start-mark.ts`. Then, in order:

1. The rest, stop, handoff claim and short-handoff marks and the feed row. Their keys, parsers and `WORKTREE_META_ROWS` owners (`types/store.ts`; `test/store/worktree-meta.test.ts` follows) move to presence. Also move the exit and rest keys from `types/daemon.ts`.
2. The callers: `delivery/liveness.ts` (`markRest`, the overdue rest's delete), `delivery/stopped.ts`, `cli/stopped-mark.ts`, `cli/stop.ts`, `delivery/handoff.ts`, `status/feed-late.ts`, `harness/shared/ensure.ts`, `cli/start.ts` (claim), `daemon/lifecycle.ts` and `daemon/open.ts`.
3. `daemon/daemon.ts`'s 8 sites, in one commit. The record and heartbeat events call the store's worktree repository, which stays the storage layer (ADR 0002).
4. Importers of moved functions import from presence. The re-exports that 011-293 left go when their file empties.
5. The table test's fixture writes through events, not raw keys.

Keep the moments: the start mark is written after the lock is taken; start and spawn marks are cleared after registration; the exit mark is written before the exit path awaits. Keep the claim's compare and write in one transaction, and the stop mark's reread after Git. Callers keep their transactions.

Owns: `src/core/presence/**`, `test/presence/**`, the writer files above, the presence keys in `types/daemon.ts` and `types/store.ts`, the importers that follow a move, and `test/store/worktree-meta.test.ts`. Leave alone: the views' text and decisions, `livenessTold`, `revisionTold`, `daemonUsed`, `daemonToken`, `daemonBootstrapped` and the store schema.

Done when: the row's done-when holds. A grep shows no presence meta key and no lock-mark path written outside `src/core/presence/`. A test per event proves that the stored bytes match the old writer's bytes. The handover tests across versions pass unchanged (`test/harness/handoff*.test.ts`, `test/daemon/handoff-claim.test.ts`, `test/daemon/died*.test.ts`, `test/version-sensitive.test.ts`). The I/O, parity and expected-reads tests of `test/presence/` pass unchanged; the expected-reads trace also logs `runs.inFlight` reads (review `0.1.403-r3.md`, should-fix). Lint and typecheck pass. Write notes in `tasks/011-294/notes.md`. Your final message lists decisions, type changes and each writer left out, with its reason.
