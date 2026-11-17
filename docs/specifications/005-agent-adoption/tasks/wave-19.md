# 005 wave 19: a session start that must start a daemon registers first

Row 005-98, option A, chosen by the human 2026-11-17. Coordinator: session 4d2ecbfc. One worker.

Rules (lessons of `status.md`, 2026-11-17): no version raise, no `pnpm run build` in your worktree, no full suite. A text change greps ALL of `test/`, `evals/lib` and the skill copies. `test/e2e/**` is outside Squeal's coverage here: run each e2e file that reads a path you change directly, one at a time, `timeout 900`. A new line under `src/core/store/**` needs a validity case (`test/keys/key-format.test.ts`). Before you report, read Squeal's complete verdict on your changed paths (`squeal status --wait 60000 <paths>`, repeated until none is pending). Write `~`, never a `/home/<user>/` path.

## W1: 005-98, register first, then start the daemon

Use /worker. Shape: slice. Outcome: a SessionStart that has to start a daemon registers the session before it starts the daemon, so the hook's 2 s timeout can no longer leave the session unregistered.

Read: row 005-98; `tasks/005-95/notes.md` (the chain, with times, and option A); `src/harness/shared/session.ts` (`startSession`), `ensure.ts` (the 750 ms heartbeat wait), `plugins/claude-code/hooks/hooks.json`.

Starting seam: `startSession` in `src/harness/shared/session.ts`. First edit, offered as a lead: move the registration before the ensure; the registration then says a daemon is starting (`startingSince`), as it does after a settle that timed out.

Also in this row:
- A resumed session keeps 0.1.527's rule: its registration carries no primer.
- If the hook is killed after the registration and before its output, the first tool boundary must not register again with the primer; say in the notes what that boundary delivers, with a test.
- Split the transaction in `registerNow` (`src/core/delivery/delivery.ts`): its complexity is 22 against the limit of 20 since the 0.1.538 repair. No behaviour change; `test/delivery/late-paths.test.ts` holds.
- Every harness that shares the start path behaves the same, or the notes say why not.

Owns: `src/harness/shared/{session,ensure}.ts`, their tests and the harness latency tests, `registerNow` in `src/core/delivery/delivery.ts` (the split only). Leave alone: `plugins/*/hooks` timeouts, `src/core/scheduler/**`, `src/core/daemon/**`, `src/core/delivery/{edits,header,format,late*}.ts`, `primer.ts`.

Done when: a test where the daemon start takes longer than the hook's timeout and the session is registered when the hook is killed; a test for the boundary after such a kill (no second primer); a resumed session's registration has no primer; the hook's latency tests hold; `registerNow` at or under 20; the rules above.

Final message: the order as built; what each harness does; the boundary case; check results.
