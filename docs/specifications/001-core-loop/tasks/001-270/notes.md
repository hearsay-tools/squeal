# 001-267 and 001-270 notes: the window takes in later moves; a clock-free incarnation

Repair of `reviews/wave-13ad.md` S1 (001-267) and the identity limit in `reviews/wave-13ae.md` (001-270). One worker, two commits.

## 001-267: a move recorded after the window joins it

`waitForStatus` (`src/cli/status-wait.ts`) used to read `answerMoves` only while it had no window. It now remembers the moves' `seq` the window was read at (`windowSeq`). At every read after that:

- **A different `seq`.** The wait reads `answerMoves` again. `answered` rebuilds the window from the same `heard` and captured revision, so a move at the captured revision recorded later joins it. `incomplete` drops the window to D7's fallback, as before. `refining` keeps the window, and `windowRefined` still blocks quiet.
- **The same `seq`.** The wait only checks `movesTrusted`, as 001-268 did. A new registration doesn't write the record, so it is caught here.

Rebuilding never drops an owed file. A move stays in the answer, open or resolved after the start, until a prune drops it, and a prune bumps `dropped`, which falls back. The window only rereads the slow policy (`editWindow` → `worktreeSlowView`) when `seq` changes.

The choice was to join rather than invalidate: a joined file is held by name, so the wait still ends as soon as every file it owes has its result. Test: `test/cli/status-wait-later-move.test.ts`. It was quiet with A queued before the change, and a control ends quiet on the window's own files.

## 001-270: the start token

- **Token.** `Daemon` draws `randomUUID()` at construction (`#token`). It goes into the registration (`setDaemon`), the scheduler's `incarnation` and the desk identity (`DeskIdentity.token`, `HandlerContext.token`), so the sync answer names it.
- **Incarnation.** `daemonIncarnation` is `<version>@<startedAt>#<token>`, and `null` without a token, so no wait trusts such a daemon. `predecessorIncarnation` gives `undefined` (unverifiable) without a token, so the first commit adopts.
- **Storage.** Schema V1 is unchanged. The token is a `meta` row, `daemon-token:<worktree>` (`WORKTREE_META_ROWS.daemonToken`, owner `store/repos/worktrees`), so worktree removal prunes it. Its value is JSON `{startedAt, squealVersion, token}`. `upsert` and `setDaemon` write it with a registration that has a token, and delete it with one that has none. A clear (`setDaemon(null)`) keeps it, like the start time and version, so `lastDaemon` reads it for the next daemon's first commit.
- **Binding.** A release before the token never touches that row. So `get`, `list` and `lastDaemon` count the token only while the registration's `daemon_started_at` and `daemon_version` equal the ones it was stored with. An older daemon registered after a newer one reads as having no token. To alias, an older release would have to register with the same version string and the same start millisecond as the leftover row. Released versions before the token are all older than any release that writes it, so this can't happen between releases.

Tests: `test/store/daemon-token.test.ts` covers two tokens at one start time, the token surviving a clean exit, a tokenless or older registration over a leftover row, and pruning. In `test/cli/status-wait-same-start.test.ts`, an older daemon's round trip runs between two reads, then a newer daemon registers at the answering daemon's version and start time. The wait was quiet with A queued before the change. `rekeyed-moves.test.ts` gains a same-start re-registration.

## Mixed versions

| Pair | Result |
| --- | --- |
| New CLI, 0.1.116 daemon | The registration has no token, so its incarnation is `null`: fallback. |
| 0.1.116 CLI, new daemon | That CLI computes `<version>@<startedAt>` from the row, which never equals the answer's `...#token`: fallback, never quiet wrongly. It also loses the fast path against a new daemon. |
| New daemon after a 0.1.116 one | The predecessor has no token, so it is unverifiable: the first commit adopts. |

## Outside the named ownership (needed for the token to reach the sync answer)

- `src/core/daemon/desk-messages.ts`, `desk.ts`, `front-desk.ts` and `handlers.ts`: one `token` field each.
- `src/core/types/store-records.ts`: `DaemonRecord.token?`. This is an additive type change.
- `src/core/types/store.ts`: `WorktreeRepo.lastDaemon` returns `token?` (additive), plus the `daemonToken` registry row.
- `src/core/types/daemon.ts`: new exported type `DaemonIdentity`. `daemonIncarnation` now takes `token`, and returns `string` only when `token` is a string.
- Test fixtures that give their daemon a token: `test/delivery/fakes.ts` (`liveDaemon`), `test/scheduler/store-wait.ts`, `test/cli/status-wait-fixture.ts`, `test/cli/status-wait-successor-fixture.ts`, `test/daemon/sync.test.ts`, `run-slow.test.ts`, `test/harness/step-down.test.ts`, `test/delivery/edits-confirmation.test.ts`.

## For the coordinator

- `KEY_FORMAT_VERSION` guard and both committed bundles (`cli/front-desk.mjs`) fail as expected. Both are yours to bump and rebuild.
- D7 and `status.md` were not amended, since this row doesn't own them. A D7 line could say the incarnation includes a start token, and that the window rereads the moves after each commit.
- Same alias class, untouched: `bootstrappedMetaKey` stores the daemon's `startedAt` as its identity (task 001-96).
