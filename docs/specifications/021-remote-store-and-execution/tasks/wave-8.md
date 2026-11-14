# Spec 021 wave 8: a daemon log that is kept

One worker. The human approved the row on 2026-11-14 (task 7e314503, "Go with the small row"). Read `docs/process.md`, `docs/styleguide.md`, spec 001 D10 (the spawn), spec 021 D3 (the 250 ms long-write line) and D16. No version bump, no `pnpm run build`. Verify with `squeal status --wait 60000 <paths>`, `pnpm exec biome check`, `pnpm run typecheck`; no full suite. The host is shared: no load on purpose. Ask the coordinator before any file outside your list.

## 021-32 a daemon log that is kept (shape: slice)

Outcome: every line a spawned daemon logs (the long-write line included) lands in a bounded file per worktree, not `/dev/null`, and a hook still returns in about 70 ms.

Why: `ensureDaemonProcess` spawns with `stdio: "ignore"` (`src/core/daemon/ensure.ts:235`), and the daemon logs to stderr (`src/cli/daemon.ts:27`). On 2026-11-14 all five live daemons on this host had fd 2 on `/dev/null`. Rows 021-17 and 021-19 measure on 2026-11-19 and need the long-write and ceiling-refusal lines.

Contract (the coordinator writes the spec text from it; ask before you change it):
- Path: `<commonDir>/squeal/logs/daemon-<worktree id>.log`, the 16-hex id of `lockFileFor`; a helper beside it in `src/core/store/paths.ts`. One previous file, `daemon-<worktree id>.log.1`.
- Line: `<ISO 8601 UTC with ms> [<pid>] <line>`, for example `2026-11-14T13:50:00.123Z [41234] squeal daemon: long write ...`. Text Node or a crash writes outside `log` (stack traces, warnings) still reaches the file, unprefixed if it must be.
- Bound: 4 MiB per file, one previous file, so at most 8 MiB per worktree, while the daemon lives and across restarts. A fixed constant, nothing host-derived.
- The spawn stays detached and unref'd. When the directory or file cannot be made or opened, it spawns with `ignore` as today. A failed log write never throws into the daemon.

Seam: `ensureDaemonProcess` in `ensure.ts`; first edit: open the file for append and pass it as stdout and stderr. The rotation mechanism is your choice (spawner, daemon, or both); say in your notes why it is bounded while one daemon runs for days.

Owns: `ensure.ts`, `src/cli/daemon.ts`, `src/core/store/paths.ts` (the helper only), a new `src/core/daemon/log-file.ts` if you need one, `src/cli/ps.ts` only to name the log path if that is cheap, the user docs that describe the daemon (name the path there), and tests. Leave spec files, `docs/board.md`, `package.json` and bundles alone. If the store already deletes a gone worktree's lock file somewhere, delete its log files at the same place; otherwise say so in your notes.

Done when tests show: a daemon spawned through `ensureDaemonProcess` writes its lines, with timestamp and pid, to the file, a long write over 250 ms included (a real or forced `logLongWrites` line); the file rotates at the limit and keeps one previous file; an unwritable `logs` directory still spawns the daemon; the spawn does not wait for the daemon. Notes in `tasks/021-32-notes.md`. Use /worker.
