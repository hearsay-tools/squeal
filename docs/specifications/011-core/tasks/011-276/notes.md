# Row 011-276: a late heartbeat is not stopped validation (gh-109, gh-128)

Wave 61 W3, repair, wording only (the human, 2026-10-30). Worker 0015cf25.

## What changed

- One fact, derived from evidence the readers already hold: `withLateHeartbeat` (`src/core/status/daemon-facts.ts`) adds `heartbeatLate: { ageMs }` to a down daemon when its record is not cleared and nothing records a stop, an exit or a start. It runs last in `withDaemonFacts`, after `withDeath` and `withStopping`, so status and every header read it alike. It is not added when the daemon:
  - died (`died`: its lock is free and no shutdown is marked);
  - began its shutdown (`shutDown`: the exit row or exit note names its incarnation);
  - is stopping (`stopping`), stopped by request (`stopped`), starting (`startingSince`) or resting (`resting`).
- `asTold` (`src/core/delivery/liveness.ts`) drops it with the start a consumer was told of.
- The "Not validated" line (`src/harness/shared/deliver.ts`) reads the same fact over the raw record. Its ensure said `unavailable`: a daemon holds the lock and does not answer, so the daemon is not dead there.
- No new probe, ping or stored state. The liveness decision (`daemonLiveness`, alive or down) is unchanged, so are the verdicts, exit codes, news rules and ensure.

## The words

One detail, `lateHeartbeatDetail` (`src/core/status/status-detail.ts`): `the last one was 14 s ago, at <ISO>; the daemon may be busy or stopped`.

| Surface | File | Late heartbeat |
| --- | --- | --- |
| Hook title | `delivery/format.ts` `livenessTitle` | `SQUEAL · the daemon's heartbeat is late at revision N` |
| Hook and registration header | `delivery/header.ts` `livenessSentence` | `The daemon's heartbeat is late: <detail>; results are as of revision N.` |
| Hook line after an edit | `delivery/format.ts` `notValidatedLine` | `Not validated: the daemon's heartbeat is late: <detail>; any change this call made has no result until it validates again.` |
| Status `--full` | `status/status-detail.ts` `daemonLine` | `Daemon: heartbeat late: <detail>` |
| Status `Outstanding:` | `status/outstanding-text.ts` `daemonText` | `the daemon's heartbeat is late: <detail>; results are as of revision N; \`squeal start\` starts one once it has exited` |
| Worktree line | `status/identity.ts` `dirtyText` | `dirty state not known: the daemon's heartbeat is late` |
| Named status without a wait | `cli/status-wait-lines.ts` `noDaemonText`, `startText` | `the daemon's heartbeat is late: <detail>; ...; \`squeal start\` starts one once it has exited` |
| JSON | `types/status.ts` | `daemon: { state: "down", since, heartbeatLate: { ageMs } }` |

Recovery: `SQUEAL · a daemon is validating again at revision N: its heartbeat is current` (`livenessTitle`).

Unchanged on purpose: a recorded exit (record cleared) keeps "no daemon is validating" and "No daemon has validated since"; a death keeps its death sentence; a stop by request keeps "stopped by request". A wait that found its own socket evidence (`down: "silent"`, `"stopped"`, `"handoff"`) keeps its line. `slow-text.ts` keeps "last reported", which claims no stop.

## Shared formatters edited (the brief's "smallest change, name it")

- `src/core/delivery/header.ts` (`livenessSentence`): one branch. The hook header after the title is here, not in `format.ts`.
- `src/core/status/status-detail.ts` (`daemonLine`, new `lateHeartbeatDetail`): one branch and the shared detail.
- `src/core/status/outstanding-text.ts` (`daemonText`): one branch.
- `src/core/status/daemon-facts.ts` (`withDaemonFacts`, new `withLateHeartbeat`).
- `src/core/types/status.ts`: additive field `heartbeatLate?: HeartbeatLate` on the down variant, and the interface.
- `livenessTitle` now takes the header in place of the revision, to read the header's late fact. `livenessChange` reads no `withDeath`, so a dead daemon would read late there.

## Decisions the brief did not settle

1. Recovery cannot tell a resumed daemon from a new one. What a consumer was told is stored as `"down"` only, and the brief allows no new state. So the recovery title says what Squeal observed: the heartbeat is current. A follow-up could record, in the told slot, whether "down" was late.
2. The boundary that spawns after a SIGKILL marks its spawn. While that mark is in its grace, no reader takes the lock (row 011-251 F4, review 0.1.355 B1), so the death is not read and the text says late. Status read at the same moment says the same. Once the grace passes, the death is named as before. See `test/harness/stale-replacement.test.ts` and `test/e2e/lifecycle.test.ts`.
3. `squeal start` with a late daemon answers "alive" (its socket answers) or "unavailable" (it holds the lock and does not answer). So the step reads "starts one once it has exited". The step stays `squeal start`; no wait step was substituted.
4. `next-step.ts`'s `no-daemon` reason is unchanged. It is shown only through `outstanding-text.ts` (changed) and `named-file-lines.ts` (W1's file; a `no-daemon` group lists no files).

## Not mine, for the coordinator

- `evals/lib/squeal-text.mjs` `NO_DAEMON` does not match the late words. If a late heartbeat should count as "Squeal cannot answer" in graded sessions, it needs `the daemon's heartbeat is late` and `Daemon: heartbeat late`. Evals code is outside this row.
- `test/e2e/lifecycle.test.ts` was updated from reading the code (the boundary that spawns after SIGKILL marks its spawn, so it reads late) but not run: e2e runs the committed bundles, and this wave forbids `pnpm run build`.

## Tests

- New `test/harness/late-heartbeat.test.ts`: late heartbeat (hook, status text, JSON), recovery, stop by request, exit that cleared the record, exit its shutdown marked, death. Red before: the late and recovery cases failed on the base source; the four stop and exit cases passed there, as guards.
- `test/harness/hung-daemon.test.ts`: the real SIGSTOP now reads late and never "no daemon".
- Updated wording in 13 other test files; `test/status/status.test.ts` and `test/status/outstanding.test.ts` also keep the cleared-record case.
