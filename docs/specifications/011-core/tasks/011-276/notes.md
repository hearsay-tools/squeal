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

## R1: the e2e recovery headline (review 0.1.383 S1)

Wave 61.5 RP1, worker 5fbadfdb, 2026-10-31.

The review said the e2e fallback expects a recovery headline the formatter no longer writes. The coordinator saw the plain headline in an e2e run. Both are true, for different legs of `test/e2e/lifecycle.test.ts`:

- The Claude Code leg runs this checkout's committed bundles (0.1.383). `livenessTitle` (`src/core/delivery/format.ts:485`) is the only producer of "a daemon is validating again", and its alive branch always adds ": its heartbeat is current". What a consumer was told is stored as "down" only (`asTold`, `src/core/delivery/liveness.ts`), so no earlier late or no-daemon reading can select another title. `test/harness/starting-daemon.test.ts` ("says no daemon is validating, once, ...") shows it through a hook: after "no daemon is validating", recovery has the suffix.
- The Codex leg runs the Codex plugin's frozen seed runtime (`plugins/codex/seed/runtime.json`: 0.1.368), as `test/e2e/fixture-cli.test.ts` and `test/e2e/pytest.test.ts` say. That runtime predates this row: it never reads a late heartbeat, and its recovery title has no suffix (`plugins/codex/seed/dist/post-tool-use.mjs`).

How I know: with the review's fix (the suffix in both branches) the Codex leg failed at the recovery assertion with `SQUEAL · a daemon is validating again at revision 0` and no suffix; the Claude Code leg passed. `git grep` finds the suffix in `plugins/claude-code/dist` at `539ce6844` and at its parent `6e5d49bd2`, and not in `plugins/codex/seed/dist`.

The test now keys on the runtime, not on the down reading: `isNewerVersion(first.squealVersion, "0.1.382")` over the daemon's ping. A runtime with the row: the recovery title has the suffix after either reading. A runtime before it: the down reading must be "no daemon", and the recovery title is plain. When the Codex adapter is rebuilt with a newer seed, its leg takes the first branch without a test change.

Run (`env -u PLUGIN_ROOT -u PLUGIN_DATA pnpm exec vitest run test/e2e/lifecycle.test.ts --maxWorkers=2`, committed bundles, no build): with the review's fix, 1 failed (the Codex dead-daemon case), 5 passed; with this change, 6 passed in 52 s. The output does not show which down reading the Claude Code leg took.

# Row 011-282: the `Slow tier:` line names capacity for a `slot` wait (W3, second commit)

- `src/core/state/slow-text.ts`: `waiting: slot` reads `waiting for capacity (whether the slow slot or the shared worker pool holds it is not known)`, the words of `holdText` (review 0.1.382 B1). The scheduler publishes `slot` both when the shared worker pool refuses a permit (`slow-tier.ts` `WAIT_FOR_CAPACITY`) and when the slow slot is taken (`#waitAtSlot`).
- A recorded holder keeps row 011-58's words, `waiting for the slow slot another worktree's slow tier holds`. That holds only when status read the slot (`slowSlot`, row 011-58) and live holders in other worktrees hold every permit. Free permits, a stale, missing or unreadable record, or a permit this worktree holds read as capacity. The `Slow slot:` line still names every holder.
- Delivered headers carry no `slowSlot`, so they always say capacity for `slot`. `slowTierText` takes `StatusHeader & { slowSlot? }`; status passes its snapshot, which has the field. No type in `src/core/types` changed.
- The parentheses keep the clause inside one `; `-separated part of the line.
- JSON is unchanged: `slowTier.activity` stays `{ kind: "waiting", for: "slot" }`, and status's `slowSlot` shows the holders the text reads.
- Tests: `test/status/slot-holders.test.ts`. A free slot (a full pool) and a slot with one permit free read as capacity. A stale or missing record reads as capacity. A live holder of every permit in another worktree keeps the words. The free-slot, stale-record and one-free-permit cases failed before the change; the occupied case passed. `test/status/slow-tier.test.ts` and `test/status/slow-only-wait.test.ts` take the capacity words (no holder recorded there).
