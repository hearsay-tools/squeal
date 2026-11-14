# Row 011-49: `squeal status <path>...` ends near its 750 ms bound

Worker bc573417, wave 90 W3, 2026-11-14. Shape: repair, test first.

## Cause

`namedSnapshot` (`src/cli/wait/snapshot.ts`) reads at its 750 ms settle time
and calls `sync.stop()`. `stop()` only set a flag. The sync's request on a
paused daemon's socket (first the `daemonSocket` ping, then `sync` or
`sync-status`) held its socket and its timer until `CLI_SOCKET_TIMEOUT_MS`
(2,000 ms), and those kept the process alive. `requestDaemon`
(`src/core/daemon/client.ts`) takes no abort signal, and that file is outside
this row's files, so `stop()` cannot end a request on the wire.

## Fix: bound the sync by the snapshot's deadline

- `syncDaemon(root, pollMs, paths, deadline?)` (`src/cli/status-sync.ts`):
  an optional fourth argument, a `performance.now()` time. Each request
  (the ping in `daemonSocket`, `sync`, `sync-status`) waits at most
  `min(CLI_SOCKET_TIMEOUT_MS, deadline - now)`; none starts after the
  deadline, and the sync is then `unsupported`. Without the argument the
  timeout is `CLI_SOCKET_TIMEOUT_MS` as before.
- `namedSnapshot` passes `started + settleMs`, the time it reads at. A test's
  `options.sync` stub is called as before, with three arguments.
- The named and edit waits (`named.ts`, `status.ts`) pass no deadline: their
  behaviour is unchanged. The brief allowed "only end sooner"; they keep the
  2 s tail after they end, since they end on their own `--wait` bound, not a
  fixed 750 ms, and the row names only the snapshot. A later row can give
  `requestDaemon` an `AbortSignal` and cancel on `stop()` for all of them.

No type change outside the optional argument. `NamedSnapshotOptions.sync`
(`named-types.ts`) keeps its three-argument type.

## Known limit

`locateDaemon` can ping twice (the recorded socket when it differs from the
runtime dir's and its heartbeat is fresh, then the runtime dir's), each with
the timeout given. With two paused daemons the snapshot could end up to
2 x 750 ms after it starts. One paused daemon, the row's case, ends at the
deadline.

## Checks

- `test/cli/status-paths-paused.test.ts`: a spawned `squeal status <path>`
  (tsx, from source) against a socket that accepts and never answers. The
  exit is measured from the socket's first connection. Before the fix it
  failed at 2,036 ms; after it, three runs gave 815, 797 and 804 ms (bound
  1,300 ms; host load average about 7.5 to 9.7 on 24 vCPUs). Exit 3, no
  verdict.
- Same file: `syncDaemon` with a 300 ms deadline ends `unsupported` within
  [290, 1,000) ms; one without a deadline is still `pending` then.
