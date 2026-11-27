# Spec 026 Wave 14: delete remote machines of removed worktrees without a manual prune (row `026-37`, `#301`)

Spec: `spec.md` D7.3 (agent37 release), D12.5 (`squeal remote prune`). Issue: [#301](https://github.com/hearsay-tools/squeal/issues/301). Shape: **slice**. Use /worker.

## Outcome

A tracked remote machine whose worktree no longer exists is released with `worktree-removed` (agent37: deleted) without anyone running `squeal remote prune`, also when no daemon ran at the moment the worktree was removed.

## Cause

An orchestrator removes the worktree after its daemon stopped. The daemon exit released the machine as `daemon-exit` (sleep). `machine-share.ts` `releaseOnce` uses `worktree-removed` only for the slow-disk case, even when the daemon itself exits because its worktree was removed. Only the manual `squeal remote prune` deletes. 381 VMs leaked in 3 days.

## Changes

1. Move the prune loop out of `src/cli/remote.ts` (`prune`, `reattach`) into one core function, e.g. `src/core/runner-host/remote/prune.ts`: `pruneRemovedWorktrees({ env, log, dryRun, signal? })` returning what it released and what failed. The CLI calls it; its output stays byte-identical.
2. Daemon start runs it once in the background: never delays start or any run, never throws, logs one line per machine released or failed, and stops at the daemon's exit (abort the HTTP calls; do not hold the exit — peer task `5f4078c5`, #302, is fixing exit hangs). Lead: the daemon's start in `src/core/daemon/daemon.ts`, after the lock is held. It runs whether or not this worktree has a remote lane.
3. `releaseOnce` in `machine-share.ts`: when the machine's worktree root no longer exists at release time, release with `worktree-removed` and forget the record on success (same as the slow-disk branch). Keep this edit small; the peer may touch the lines around it.
4. Concurrent prunes from several daemons are safe: a machine already deleted (agent37 `404`) counts as released; forgetting twice is a no-op. Do not add a cross-process lock unless a test shows a real failure without one.
5. `squeal remote list` (text) ends with one line naming the count of machines whose worktree is gone and `squeal remote prune`, when the count is above 0.

## Owns

`src/cli/remote.ts`, new `src/core/runner-host/remote/prune.ts`, `src/core/runner-host/remote/machine-share.ts` (only `releaseOnce`), the daemon start call site, and their tests under `test/` (existing remote CLI tests, machine-share tests, a new prune test). Leave `plugins/*/dist` alone; do not run `pnpm run build`.

## Done when

- Tests: daemon start with a tracked record of a removed worktree releases it with `worktree-removed` and forgets it (fake provider); a still-existing worktree's record is untouched; a failing release keeps the record and logs; start is not delayed by a hanging release; exit aborts a pending prune.
- Test: `releaseOnce` with the worktree root removed calls `release("worktree-removed")` and forgets the record.
- Existing `squeal remote prune` / `list` tests pass unchanged except the new `list` line.
- Lint, typecheck, `squeal status --wait 60000 <changed paths>` green.
- No key or schema change. Benchmark cells: none (no run, store or scheduler path changes).
