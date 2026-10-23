# 011-151: a hook's step-down and stop reach only the incarnation its decision read

Worker b833f699, wave 25 W3, from main at 7e585a601 (after 0.1.278), 2026-10-23. Mechanism A, chosen by the coordinator in its reply to request 356e7e52 (late, after I had started on the same default). The reply also gave this row `replaceShort` in `src/cli/start.ts`.

## 1. The window, and why a mark alone cannot close it

`handOver` decides from one read transaction (review 0.1.277 B1). The requests it sends after that address only `record.socketPath`, which every incarnation of the worktree reuses. A short successor can bind the path and register between the decision and the connect, or between the accepted step-down and the `stop`. It is a daemon of an older release (0.1.272 in the review's probe). Its `parseRequest` drops unknown fields, and its handler compares versions only. So a mark in the request would reach it and be ignored.

What every release does have:

- Every daemon since the first one (fd6ffee30, 2026-10-04) answers `ping` with `pid`, `squealVersion` and `startedAt`. The record holds `startedAt` and `squealVersion`.
- Each incarnation's socket is a new file at the path. Since row 001-77 the server listens at a staging name and renames it over the path (`bindAt`, `src/core/daemon/server.ts`). Before that it unlinked and bound. A file never comes back to the path after it is replaced.
- The server answers one request per connection (`answer` ends the socket), so a ping and a step-down cannot share one connection.

## 2. What changed

| Done-when | Where | Test |
| --- | --- | --- |
| Endpoint replaced and short successor registered after the decision, before the connect: no `step-down`, no `stop`, no spawn | `pinDaemon` (`src/core/daemon/client.ts`): stat the path, connect, stat it again on `connect`, require the same file (dev, ino, ctime and birthtime in ns), then ping on that connection and require the record's `startedAt` and `squealVersion`. `requestStepDown` (`src/harness/shared/ensure.ts`) asks nothing when the pin fails | `test/harness/handoff-endpoint.test.ts` "asks nothing, stops nothing and spawns nothing ..." (on the old code the successor got `step-down` and `stop`) |
| Replaced between an accepted step-down and the `stop`: the `stop` does not reach the successor | `requestDaemon(..., endpoint)`: once connected, it writes only while the file at the path is the pinned one, else it closes unwritten and rejects `ESTALE`. The step-down, the follow-up `stop` and the `stop` for a daemon before the request all carry the endpoint. `handOver` claims only while the store records the decided incarnation or no daemon (`stillRecorded`, in one write transaction around `claimHandoff`) | same file, "does not stop a short successor ..." (old code: `stop` to the successor and a 120 s lock waiter spawned; with the claim guard disabled: the spawn comes back) |
| The unmarked older-daemon behaviour holds | an unchanged endpoint gets `ping`, `step-down`, `stop`, one claim and one spawn | same file, third case; `test/harness/step-down.test.ts`, `test/harness/handoff.test.ts`, real daemons in `test/daemon/step-down*.test.ts`, `handover*.test.ts` |
| The 011-140 tests | unchanged | `test/harness/handoff-short.test.ts` 7/7, `test/daemon/start-short.test.ts` 2/2 |
| `SOCKET_TIMEOUT_MS` 100 ms, `SUCCESSOR_LOCK_WAIT_MS` 120,000 ms | unchanged; each request keeps its own 100 ms | `test/harness/step-down.test.ts` "the hook's budget" |
| `replaceShort` (coordinator's reply) | `squeal start` pins the short daemon with the CLI timeout and sends the step-down and `finishHandoff`'s `stop` to that file only (`Stopping.endpoint`, `stopAt`) | `test/daemon/start-endpoint.test.ts`: a short successor renamed over the path after start's last ping gets nothing (old code: `step-down`, `stop`); the control case pins start's three pings before the step-down |

Type changes, all additive and none under `src/core/types/`: `DaemonEndpoint`, `PinnedDaemon`, `endpointAt`, `pinDaemon` exported from `client.ts`; `requestDaemon` gains an optional fourth parameter; the module-local `Stopping` in `start.ts` gains `endpoint?`. No protocol, handler or store change.

Test fixture changes: the stand-ins in `test/harness/step-down.test.ts` answer `ping` as the recorded daemon (`pingAs`), and their exact `asked` lists start with `ping`. The `handoff.test.ts` stand-in answers `ping` with the start time the store records, since that file tests claims, not endpoints. "Stays within two round trips" became three.

## 3. Decisions the spec did not settle

1. **Client-side guard, no mark** (the coordinator's choice of A). An older daemon receives one extra `ping`, then the same lines as before.
2. **The file identity is dev, ino, ctime and birthtime in ns.** A replaced file could reuse the inode number on ext4. Its ctime is that of its own rename, which is one whole incarnation later.
3. **A failed pin asks nothing at this boundary.** This covers a ping timeout, another start or version, or another file. The next boundary decides again from a new snapshot, as after a timed-out step-down before.
4. **After an accepted step-down whose successor registered first, the hook returns `none`.** It does not return `joined`. So `ensure` pings and reads the successor alive through `ensureDaemon`, and `ensureIfStale` reads `fresh`.

## 4. Drafted spec sentences (the coordinator writes them)

**011 C9**: replace "No hook asks that incarnation to step down again, except a hook whose handoff decision read the store before that incarnation registered and whose request reaches the socket after it bound: that hook may ask it once, stop it and spawn one successor (accepted 2026-10-23 by the human at release 0.1.277 over `reviews/0.1.277-r2.md` B1; row 011-151 binds the request to the incarnation the decision read)." with:

> No hook asks that incarnation to step down again or stops it. A hook's step-down and the `stop` after it reach only the incarnation its handoff decision read, whatever binds the reused socket path meanwhile. Before it asks, the hook pings over a connection to the socket file that was at the path both before and after the connect, and the answer must carry the record's start time and version. Each request after that is written only while the same file is at the path. After an acceptance, the hook claims the handoff only while the store records that incarnation or no daemon. Every release answers the ping, so the guard needs no mark that an older daemon would ignore (amended 2026-10-23, row 011-151, closing `reviews/0.1.277-r2.md` B1: a short successor that bound the path after a hook's decision took its step-down and its stop).

In the same paragraph, "a `squeal start` newer than it asks it to step down and finishes the handoff" becomes:

> a `squeal start` newer than it asks it to step down, at the socket file its ping proved, and finishes the handoff

**011 C9 and 001** (the same sentence in both, `spec.md:266` and `001-core-loop/spec.md:196`): "At most two round trips of the 100 ms budget, only for an older daemon; ..." becomes:

> At most three round trips of the 100 ms budget (the ping that proves the daemon, the request and its stop), only for an older daemon; ...

**status.md line** (suggested):

> - 2026-10-23, 011-151 (coordinator, mechanism A from worker b833f699's request 356e7e52, `tasks/011-151/notes.md`): a hook pings the daemon its handoff decision read over a connection to an unchanged socket file and sends the step-down and the stops only to that file; it claims only while the store records that incarnation or none; `squeal start`'s `replaceShort` does the same. C9's 0.1.277 exception removed; the hook's step-down costs at most three round trips.

## 5. A later option (B)

Send the incarnation (`daemonIncarnation(record)`) in `step-down` and `stop`. A daemon from that release on would refuse a request that names another incarnation, in `parseRequest` (`src/core/daemon/protocol.ts`), the `DaemonRequest` type and the handler (`handlers.ts`, `step-down` and `stop`). That covers inode-number reuse with a ctime in the same coarse tick, but only for new daemons, because older ones drop the field. It is not needed for the done-when. It is worth adding if the client guard ever proves too weak.

## 6. For whoever continues

- **Load exposure.** A step-down now needs two answers within 100 ms each (the ping and the step-down), not one. At load 1.56 per CPU, Squeal once saw `test/harness/step-down.test.ts` "asks an older daemon ..." fail: 365 ms against a usual 11 ms, the ping probably timed out. The same test passed at the revisions before and after. A real hook that times out asks again at the next boundary.
- **The concurrent case** in `handoff.test.ts` ("six boundaries ...", three concurrent) failed once in Squeal's run at revision 8 (1 step-down, expected 3). It passed in 3 of 3 local runs and in Squeal's run at revision 10. Same cause as above, inferred: a ping timeout under load makes a boundary ask nothing.
- **File sizes.** `src/harness/shared/ensure.ts` is 339 lines and `src/cli/start.ts` 321, both past the 300 guide (313 and 307 before).
- **Bundles are not rebuilt** (no `npm run build` in this row). `plugins/*/dist` drift fails the bundle tests until integration.
- **`stoppingDaemon`'s path in `start.ts`** (a daemon that is already stopping) still sends its `stop` by path. It asks no step-down, and a stop there is the explicit `start` path, so it is outside this row.
