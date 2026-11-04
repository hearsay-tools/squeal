# Wave 68: row 011-293 (daemon presence: the readers)

Coordinator 48454288, 2026-11-04. The human approved rows 011-293 to 011-295 (architecture review task 4fac6c7f, "Land and start coordinator"). This wave is 011-293 alone; 011-294 (writers) and 011-295 (consistency) follow it in wave 69. Version 0.1.403 is planned for it.

Host policy, as in `wave-60.md`: no local full suite, no `squeal run --all`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on every test command; private `/tmp` fixtures; never make CPU load on purpose; no `pnpm run build`; no real harness session under the real HOME. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version. Read affected results with `squeal status --wait 60000 <paths>`.

## W1: row 011-293 (one daemon presence module, the readers)

Use /worker. Shape: slice, test first, one commit per step below.

Outcome: every reader of daemon liveness takes a named view from one new module, `src/core/presence/`, which reads the facts once and decides one presence state; no text or payload changes.

Read: the board row 011-293; `research/daemon-presence.md` (Decisions 1, 3, 4 and the coordinator's calls); `GLOSSARY.md` (use its terms in names and comments); spec 011 C5, C6, C8, C9.

Seam and lead: the two identical heartbeat checks, `src/core/delivery/liveness.ts:37` (`daemonLiveness`) and `src/core/status/snapshot.ts:283` (`liveness`). First edit: a `src/core/presence/` reader of the record, meta marks and lock marks, and one function that decides the presence state and notes in the design's priority order. Then, in order:

1. The module and its table test (`test/presence/`): stored facts and a clock in, each view's output out, over a scratch store and lock directory. 011-294 will turn the inputs into presence events.
2. The status, header, news and JSON views replace the stacks in `delivery/liveness.ts`, `status/daemon-facts.ts`, `status/died.ts`, `status/stopping.ts`, `delivery/stopped.ts` and `status/snapshot.ts`.
3. The wait view. The socket probe and the dead-socket timer stay in `cli/wait-liveness.ts`; their results are inputs.
4. The `ps`, hook spawn, `start` and open-run views: `ps/discover.ts`, `ps/flags.ts`, `harness/shared/ensure.ts`, `cli/start.ts`, `status/open-runs.ts`. Each keeps its own decision and text exactly; 011-295 makes them consistent later.
5. Delete the agreement tests the table covers (the row names them). Map each deleted case to its table row in your notes.

Owns: `src/core/presence/**`, `test/presence/**`, the reader files above, the read halves of `daemon/start-mark.ts` (`daemonStart`) and of `delivery/liveness.ts` and `delivery/stopped.ts`, the presence types in `types/status.ts`, the consumers that must follow a renamed type, and the tests the row deletes. `cli/stop.ts`, `cli/stop-removed.ts` and `scheduler/claims.ts` also read heartbeat age or lock marks. Move each, or say in your notes why it stays.

Leave alone: every write site (011-294): `daemon/daemon.ts`, `daemon/lifecycle.ts`, `daemon/open.ts`, `markSpawn`, `markRest`, `handoff.ts`, `cli/stopped-mark.ts`, the stop-mark writes. Leave the meta key functions in `types/daemon.ts` and `types/store.ts` too; the module imports them.

Done when: the row's done-when holds. A grep for `heartbeatAt`, `HEARTBEAT_GRACE_INTERVALS` and the presence meta key and lock mark readers outside `src/core/presence/` shows only writers, the store repository and the cases your notes name. The status JSON `daemon` field is byte for byte as before; the table test proves it for every state the old flags could express. Wording and real-daemon tests pass unchanged (`squeal status --wait 60000 <paths>`). Lint and typecheck pass. Write notes in `tasks/011-293/notes.md`. Your final message lists decisions the spec did not settle, type changes, and each reader left out with its reason.
