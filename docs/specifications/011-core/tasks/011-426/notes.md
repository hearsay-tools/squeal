# Row 011-426 notes (#293): on-request files and the wait's "nothing left runs" line

Worker 8de08b59, 2026-11-27. Seam map for whoever continues.

## The one rule: `onRequestFiles` (`src/core/state/groups.ts`)

A test file is **on request** when all hold:

- its group is a configured test group at `commit` or `manual` (`heldUntilAsked`);
- its key row is `queued` (a `running` row stays running);
- no narrow request asked for it at its current key (`publishedNarrowAsks`, the live daemon's);
- no `run --all` checkpoint is open or owed (`readCheckpointProgress`, kind `run-all`);
- its lane is not running a request for the whole group: the lane publishes activity
  (`liveActivity`) while no published narrow ask names a file of the group. That case is
  `squeal run <group>` or a commit's ask (the daemon does not publish commit asks, so a commit
  group's unasked files read queued while its commit tier runs; accepted, coordinator reply
  2026-11-27).

A held file not asked stays on request while its lane runs a narrow request for other files.

Readers of the set: the header (`headerWith` computes it after the policy and passes it to the
part; `notCurrentOf` splits `testFilesByPhase`/`testsByPhase`), status (`snapshot.ts`:
`pendingTestFiles.onRequest`, `breakdown.pendingByPhase.onRequest`), the wait's kept header part
(`src/cli/wait/every-state.ts` keeps the part only while the set is equal: asks and lane activity
move it without a state write), and the edit wait (`onRequestGroupsOf`).

## Text

- `notCurrentText` (`src/core/status/checks.ts`): `(1 queued, 98 on request, 3 unknown)`; the same
  in the tests clause, the registration header, Stop and the news form (they share it).
- `Affected checks:` line: `..., 0 queued, 98 on request (98 tests), ...` when not zero.
- `Queued:` line: on-request files are left out (`pendingTestFilesOf`); the group line keeps them.

## JSON (additive, each `onRequest` absent when zero)

`testFilesByPhase.onRequest`, `testsByPhase.onRequest`, `breakdown.pendingByPhase.onRequest`,
`breakdown.fileLevelByPhase.onRequest`, `pendingTestFiles.onRequest` (`PhaseFiles`);
`status --wait --json`: `wait.nothingRunsByItself: true`, `wait.edit.onRequestGroups`.

## The wait's sentence (`src/cli/status-wait-settled.ts`)

Last on the verdict line, never a line of its own: row 011-26 makes the verdict line alone (`tail -1`)
say what is not current, and the evals tests hold every wait form to that. Condition
(`nothingRunsByItself`): live daemon not stopping, files listed, runner part applied, no install
awaited, no hold, no running checkpoint, nothing running, queued or stale (files and tests), and at
least one file on request or unknown. Shown on a quiet edit wait, and on a named wait with a clean
verdict and no selected file left for its group's moment (`pauseText` already names that run).
Neither wait compares against a git ref, so the run is `squeal run <group> --wait`, no `--base`.

## Evals

`evals/lib/squeal-text.mjs` counts `N on request` as pending in the not-current clause and the
`Affected checks:` line; `test/evals/evidence-squeal.test.ts` has an `on request` variant that
round-trips the real formatters (fails without the parser change).
