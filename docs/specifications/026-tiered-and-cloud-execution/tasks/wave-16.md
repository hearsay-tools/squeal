# Spec 026 Wave 16: delete a remote machine nobody has used for a day (row `026-43`)

From Triage row `remote-parked-machines` (the human started coordinator 09786adb on it, 2026-11-28). One worker.

## W1: row `026-43`. Shape: **slice**. Use /worker.

**Outcome.** A tracked remote machine that no daemon has used for `deleteUnusedHours` (default 24) is deleted and forgotten, by the background prune at daemon start and by `squeal remote prune`.

Spec: D6 (release reasons), D7.3 item 4, D12.3, D12.5. Evidence: the board's Triage row `remote-parked-machines` (22 `detached` agent37 machines of worktrees still on disk, about $40 a month).

1. `machine-share.ts` `releaseOnce` writes `status: "detached"`; also write a new `detachedAt` (`EpochMs`, `machines-store.ts` `updateMachine` patch, `isMachineRecord` keeps it optional).
2. `prune.ts` `sorted`: besides a gone worktree, a record is unused when (a) `status` is `detached` and `detachedAt` (else `lastUsedAt`) is older than the limit, or (b) of this scope, `status` `awake`/`sleeping`, `liveDaemonRecorded(worktreeRoot)` false (`daemon/ensure.ts`) and `lastUsedAt` older than the limit (a daemon that crashed). Read liveness only for records already past the limit. The manual prune on a foreign-scope record uses (a) only.
3. `current()` rechecks before release: same id, same `status` and timestamps, no live daemon. Release with a new `ReleaseReason` `"unused"`: agent37 deletes; `command` passes it in `SQUEAL_RELEASE_REASON`; `ssh` does nothing. Forget the exact record as today.
4. `settings.ts`: `deleteUnusedHours` on the `remote.json` lane, default 24, `0` never deletes; read through `reattach`'s lane.
5. `cli/remote.ts`: `remote list` shows `no daemon for 3 h 10 min` for detached machines (`--json` field too); `prune --dry-run` names unused machines and why.

**Owns:** `src/core/runner-host/remote/{prune,machines-store,machine-share,provider,settings}.ts`, `providers/{agent37/machine,command,ssh}.ts`, `src/cli/remote.ts`, the prune log wording in `src/core/daemon/daemon.ts`, their tests (`test/runner-host/remote/prune*.test.ts`, `test/cli/remote.test.ts`), the squeal skill's remote section if it describes prune. Do not edit `docs/`. Do not run `pnpm run build`.

**Done when:** tests cover: detached past the limit deleted and forgotten; under the limit kept; `0` keeps; an old record without `detachedAt` timed by `lastUsedAt`; crashed-daemon record deleted, live-daemon record kept; a record reattached (status or id changed) between read and release kept; a daemon that starts after its machine was deleted acquires a new one (agent37 mock: 404 then create); no liveness read for records under the limit; `remote list` text and JSON. Lint, typecheck, `squeal status --wait 60000 <changed paths>`. No key-format change. Benchmark cells: none (the prune already runs off the daemon thread at start; no store, scheduler, hook or delivery change).
