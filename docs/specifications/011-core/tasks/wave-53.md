# Wave 53: every reader tells a starting daemon from a stopped one (row 011-251)

Coordinator 04a258b0, 2026-10-26. One worker. Follows row 011-250 (0.1.350, issue #1).

## W1: row 011-251

Use /worker. Shape: slice.

Outcome: while a daemon starts, a wait, plain `squeal status`, `squeal start`'s printed status and the hooks' texts say it is starting, not that it stopped, and none of them takes the daemon lock.

Read: spec 011 C9 (the 2026-10-26 amendment: the start mark) and C15; `tasks/011-250/notes.md` (F1, F2, F4, "Follow-ups after the repair"); `reviews/0.1.350-r2.md` N2; the board row 011-251.

Seams, each a lead:
- F1: the window before a spawned daemon takes the lock. `src/harness/shared/ensure.ts` writes a spawn mark beside the start mark (never over it) when it spawns; a wait reads a cleared record with a fresh spawn mark (`DAEMON_START_GRACE_MS`, `src/core/delivery/liveness.ts`) as starting.
- F2: plain status. `src/core/status/next-step.ts:117` and `src/cli/status-wait-lines.ts:248` end with `squeal start` starts one; with a live start or spawn mark they use `LOCKED_TEXT` (`src/core/status/outstanding-text.ts`). A stale record with the lock held is a busy daemon, not a starting one.
- F4: `src/core/status/died.ts`, `stopping.ts` and `src/cli/stop.ts` (`daemonGone`): read the mark where a cleared record can be met, not the lock.
- N2: refresh the store read before deciding that both the mark and a serving record are absent.

Before you commit a new user-visible line, send me the exact lines, rendered by the real formatters, as a request.

Owns: `ensure.ts`, `wait-liveness.ts`, `start-mark.ts`, `next-step.ts`, `status-wait-lines.ts`, `outstanding-text.ts`, `died.ts`, `stopping.ts`, `stop.ts`, and their tests. Not yours: the board, spec text, `status.md`, bundles, version, the daemon's version arbitration in `open.ts`. No `npm run build`.

Done when: a wait right after a hook spawn, plain status and the hooks name a starting daemon as starting; a test with an older spawned daemon beside a status probe still starts; N2's mixed read gives no stopped verdict; no `--json` field is removed; lint, typecheck, `squeal status --wait 60000 <changed paths>` and `test/keys/key-format.test.ts` pass. Notes in `tasks/011-251/notes.md`.
