# Row 011-344: the named and edit waits end without the 2 s socket tail

Worker 7d9aa85a, wave 94 W2, 2026-11-14. Shape: repair, test first.

## Cause

Two pings stayed on the wire after `status <path> --wait` or `status --wait`
decided, against a socket that accepts and never answers. Each held its
socket and its timer until `CLI_SOCKET_TIMEOUT_MS` (2,000 ms):

1. The sync's ping, in `locateDaemon` (`src/core/daemon/ensure.ts`), which
   `daemonSocket` calls. `DaemonSync.stop()` only set a flag. The sync's
   later `sync` and `sync-status` requests would hold the process the same
   way.
2. The liveness watch's ping (`listening` in `src/cli/wait-liveness.ts`),
   started by `watchDaemon` when the heartbeat is late. The brief named only
   the sync; a probe of the paused socket showed this second connection
   closing 2 s after it opened, so the sync abort alone left the tail.

## Fix

- `requestDaemon(socketPath, request, timeoutMs, endpoint?, signal?)`: an
  abort destroys the socket, clears the timer and rejects `ABORT_ERR`; an
  aborted signal rejects before any connect.
- `askDaemon(..., timeoutMs, signal?)` and `daemonSocket(root, timeoutMs,
  signal?)` pass it on; `ProbeOptions.signal` (ensure.ts) passes it to the
  ping. No signal: as before.
- `syncDaemon`: one `AbortController`; `stop()` aborts it, and every request
  of the sync takes its signal. An aborted request reads as `unsupported`,
  as a stopped sync did.
- `DaemonWatch.stop?()` aborts the watch's ping in flight, and no new one
  starts after it. `StatusPoll.stop?` runs in `pollStatus`'s `finally`
  beside `sync().stop()`; the edit and named polls set it to
  `watch?.stop?.()`. It runs only after the outcome, so no liveness decision
  changes.
- The snapshot (row 011-49) keeps its deadline; its `stop()` now aborts too.

## Grants (coordinator cdd216e5)

- `src/core/daemon/ensure.ts`: only `ProbeOptions.signal`, passed to the
  ping.
- `src/cli/wait-liveness.ts`, `src/cli/wait/wait.ts`, `src/cli/wait/status.ts`
  (the stop line only), `src/cli/wait/named.ts`: the watch's stop.

## Type changes (all additive, optional)

`requestDaemon`'s fifth parameter `signal`; `askDaemon`'s and
`daemonSocket`'s `signal`; `ProbeOptions.signal?: AbortSignal | undefined`;
`DaemonWatch.stop?(): void`; `StatusPoll.stop?: () => void`.

## Checks

- `test/cli/status-wait-paused.test.ts`: a spawned CLI (tsx, from source)
  per wait, `--wait 600`, against a paused socket. Exit code (named 3, edit
  0) and outcome line asserted; exit within 300 ms of the first output
  byte, and every connection to the socket closed within 300 ms of it (at
  least two: the sync's and the watch's). On the base commit both failed at
  about 1,420 ms with the same codes and lines.
- `test/daemon/request-abort.test.ts`: abort on the wire, an aborted
  signal, no signal still `ETIMEDOUT`.
- `test/cli/status-paths-paused.test.ts` (row 011-49) passes unchanged.

## For the next worker

Other callers of `daemonSocket`/`askDaemon` (`status-wait-promote.ts`'s
fire-and-forget focus, `wait/socket.ts`, the run commands) take no signal
yet and keep their 2 s bound. None held the two waits' tail in the probe.
