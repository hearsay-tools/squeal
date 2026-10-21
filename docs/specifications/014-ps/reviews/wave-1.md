FAIL 5bbc50709d7decd9ca1f2b60ab043c97fbdaf90a

Two proven blockers, zero should-fix items, one proven note.

Candidate: `cand/0.1.238`, pinned to `5bbc50709d7decd9ca1f2b60ab043c97fbdaf90a`.
Range: `09911101a..5bbc50709`. Review of row 014-09 against amended spec 014 D2 to D6 and D9, the wave 1 brief, and 011 C7, C9 and C10. The prior wave's findings are context, not reopened issues. No product code changed.

## Verification output

All checks and probes ran at the pinned SHA with a clean tracked tree. Only this findings file was written after verification. `npm run build` was not run, as the dispatch explicitly requires; this review makes no independent build or bundle-drift claim. The dispatch reports candidate CI 39595505982 passed; that is supplied context, not a check rerun by this reviewer.

```text
$ git rev-parse HEAD
5bbc50709d7decd9ca1f2b60ab043c97fbdaf90a
$ git status --short
(no output)

$ npm ci
added 196 packages, and audited 197 packages in 13s
1 high severity vulnerability
(exit 0)

$ npm run lint
> squeal@0.1.238 lint
> biome check .
Checked 1603 files in 654ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.238 typecheck
> tsc --noEmit
(exit 0)
```

### Independent full run

The run held the shared host lock from 2026-10-21 12:41:03 UTC to 12:57:41 UTC. Load at start was `25.30 28.21 39.39`; load at end was `21.91 20.21 26.85`. At 12:53 UTC, when the failure had appeared in the log, load was `15.51 21.01 29.32`. There is no load sample at the exact failure time.

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4

FAIL test/harness/opencode-dispose.test.ts > a report held while dispose meets newer input > serve: an abort of the new turn, then the old Stop's answer, stores nothing
Error: before the new turn's request, the plugin killed the held Stop at +2179, at or after its idle deadline (+2000)
marks, ms since the first idle: idle +0, stop +54 (pid 1987518), dispose +101, input +1327, kill +2179 (pid 1987518); the held Stop's deadline: +2000

Test Files  1 failed | 798 passed | 1 skipped (800)
     Tests  1 failed | 6929 passed | 10 skipped (6940)
  Duration  997.26s (tests 98%, import 2%)
(exit 1)
```

The same file's first two attempts missed the barrier at `+2013` and `+2220` ms. The seven new test files passed, as did the existing `test/ps` files. The other load-sensitive files named in the dispatch did not fail.

### Failed file alone

The isolated rerun ran at the same clean SHA from 12:59:26 UTC to 12:59:46 UTC. Load was `16.14 18.42 25.47` at start and `16.29 18.35 25.30` at end.

```text
$ npx vitest run test/harness/opencode-dispose.test.ts --maxWorkers=4

Test Files  1 passed (1)
     Tests  3 passed (3)
  Duration  19.39s (tests 96%, transform 4%, import 1%)
(exit 0)
```

The full suite did not pass. The failed file recovered alone. Its barrier failure matches the known host failure named in the dispatch and prior review, but this does not prove load was its sole cause. The test and its implementation are outside the candidate's changes. It is not an additional blocker against this wave. No second full run was made.

The two source probes below ran with `node --disable-warning=ExperimentalWarning --import tsx --input-type=module`, using stdin and the named fixture builders. They changed no project file and deleted their scratch fixture directory. Their output is preserved with each finding.

## Blockers

### B1. Blocker / proven: a starting lock holder exposes its predecessor's work and token

Locations: `src/core/ps/work.ts:113`, `src/core/ps/work.ts:128`, `src/core/ps/work.ts:176`, `src/core/ps/processes.ts:73`, `src/core/ps/discover.ts:87`.

D2 explicitly allows a new lock holder with a SIGKILLed predecessor's unreplaced record. Its start excludes that record, and its phase is `starting`. D3 requires current work and explains why runs left by an earlier daemon must not appear as running now. D5 ties an escaped process to the live daemon whose token it carries. The vision says: "An old result never gets to pose as the current truth."

`phaseOn` applies the exclusion, but `readWork` does not. It accepts the predecessor's start and version, reads the predecessor's matching token, bounds the open runs and checkpoints by that old start, and accepts its last-use row. Passing those stage results to `attribute` assigns a surviving process of the dead predecessor to the new lock holder.

A probe at the clean pinned commit used `fixture-stores.ts` and the production `discover`, `readWork`, `phaseOn` and `attribute`. It created one lock holder with process start `1792599400000`; the store retained a predecessor record at `1792599345000`, an open run at `1792599355000`, and last use at `1792599395000`. A separate process, pid 900 with ppid 1, carried the predecessor's token. Output:

```json
{
  "processStart": 1792599400000,
  "recordedStart": 1792599345000,
  "phase": "starting",
  "token": "81287f79-65c7-4cd3-b2cb-547bba728456",
  "tiers": [{ "runId": "predecessor-run", "lane": "fast", "files": 1, "startedAt": 1792599355000, "checkpointId": null }],
  "lastUse": { "usedAt": 1792599395000, "activeAt": 1792599395000 },
  "attribution": {
    "processes": [{ "pid": 900, "daemonPid": 800, "escaped": true, "lane": "slow:vitest", "runId": null, "runner": null, "files": null, "descendants": [] }],
    "unowned": []
  }
}
```

The starting daemon has run none of this work and owns none of that token's processes. This is a deterministic stage-boundary failure for a state the amended spec names, not a timing failure in the test runner. The existing phase fixture tests the predecessor record only against `phaseOn`; the work fixture covers a cleared record belonging to the same process. Neither covers this combined case.

**Fix, one discovery/work repair:** use D2's existing start exclusion before exposing daemon-specific fields from the row. Keep lock-based discovery and the kept `recordedStartedAt` needed to identify `starting`. Suppress the predecessor's record as current work, token, tiers, checkpoints and last use; name what cannot be known. Keep consumers as worktree data. Ensure the later owner assembly never supplies the rejected token to `attribute`. Add an integrated fixture with a new lock holder, an uncleared predecessor record, an old open run and checkpoint, an old last-use row, and an escaped process with the old token. Assert that no old work or token is attributed to the new pid. Keep the same-incarnation `stopping` case working. The start only excludes a predecessor; it must not become the identity join.

### B2. Blocker / proven: pytest's repeated basetemp option turns options into test files

Location: `src/core/ps/processes.ts:163`.
Caller contract: `src/runners/pytest/run/command.ts:112` and `src/runners/pytest/run/run.ts:126`.

D5 says a pytest batch names its files after `--basetemp=<dir>`. The runner accepts a project's own `args` and appends its overriding `--basetemp` after them. Its comment states: "After `args`, so it wins over the project's own `--basetemp` (task 007-37)."

`filesOf` uses `findIndex`, so it cuts after the first basetemp rather than the runner's final basetemp. A supported project with `args: ["--basetemp=/tmp/project-temp"]` yields a false file list.

A probe used the real `pytestArgs` builder, appended the runner's final basetemp and one test file as `run.ts` does, then passed that argv through production `attribute` with a marked child. Output:

```json
{
  "runner": "pytest",
  "files": [
    "--maxfail=0",
    "-o",
    "cache_dir=/tmp/cache",
    "--basetemp=/tmp/squeal-basetemp/0",
    "tests/test_a.py"
  ]
}
```

Only `tests/test_a.py` is a test file. The other four entries are runner arguments. This breaks D5's file reporting for an input the existing runner deliberately supports. The current fixture has only one basetemp option.

**Fix, one attribution repair:** cut after the final `--basetemp=` emitted by the runner. Add a regression fixture with both a project basetemp and the runner override, with options between them. Assert the file list contains only the final test paths. Leave the pytest runner unchanged.

## Should-fix

None.

## Notes

### N1. Note / proven: the pinned board still shows the implementation running and the review planned

Location: `docs/board.md:899`.

Rows 014-06 to 014-08 say `running`; 014-09 says `planned`. This pinned candidate contains the implementation and this review is dispatched. The coordinator should update the rows when it records the verdict. The reviewer left the board unchanged. This is documentation drift, not a product blocker.

## What fits

- Discovery restricts command-line reads to Node main threads and the user's daemons. The held lock's file descriptor names the store and worktree; lock ownership comes from the file key and an unblocked write lock. Root hashing is the fallback. Socket files join by worktree id, and the optional listener read uses `ss -xle`. Waiting duplicates do not borrow the holder's work.
- The amended `starting` phase, `DaemonWork.recordedStartedAt`, `PhaseOf` clock argument and `PsPlaces.userConfig` are the only wave 0 type changes. They match the amendment log. `source.ts`, `proc.ts` and `test/ps/fixture.ts` are unchanged. The three implementation rows otherwise own disjoint files. The coordinator's last-use wiring changes only `work.ts`.
- The reader opens one `DatabaseSync(path, { readOnly: true })` per store and reads each group in a read transaction. It never calls `openStore`. The only SQL beyond selects is `PRAGMA busy_timeout`, `BEGIN` and `COMMIT`. Older and newer schema fixtures, live WAL bytes and mtime, and a killed writer's uncheckpointed WAL are covered. Inspection found no write, signal or socket connection in the `ps` stages. The end-to-end no-connection proof remains wave 3 work.
- CPU uses two samples matched by pid and start ticks. A process seen once has null window CPU. The cumulative CPU time stays separate. Linux memory uses `RssAnon + RssShmem`, with swap apart. Descendant costs can be summed without summing RSS. Tests cover PID reuse and disappearance.
- Attribution reads environments only through `markOf`. It uses the nearest daemon ancestor, then the mark's token for escaped processes. Mark parsing, lane-class run selection, same-mark descendants, nested daemons, and platforms without marks have fixtures. The existing privacy fixture asserts that unrelated environment values do not leave the stage. B1 and B2 are the unresolved seams.
- Host totals use the same-window busy CPU difference and `MemTotal - MemAvailable`. The pool joins unblocked write-lock holders to permit files, keeps foreign holders separate, and reads the host slot limit from `PsPlaces.userConfig`. The live permit fixture uses the process's own pid.
- The daemon writes `{ v: 1, usedAt, activeAt }` at registration and with the heartbeat in one transaction. The registry entry makes worktree removal delete the key without a migration. The reader rejects unknown formats and rows older than the recorded daemon start. Real-daemon coverage checks request and edit clock changes. The coordinator's reader wiring uses this same key and decoder. B1 concerns an unreplaced predecessor registration, which that decoder alone cannot reject.

## Inputs for the repair and next wave

1. Repair B1 and B2 before wave 2. Keep repairs separate from the flags and CLI work. Re-review the repair delta and these two cases.
2. Build process owners from live daemon identity and accepted current work. Do not infer ownership from the `DaemonWork` map's pid key alone. The map still carries a predecessor row in this candidate.
3. Assemble the two-second sample window explicitly. `takeSample` returns a monotonic midpoint and host CPU ticks; `phaseOn(source)` reads boot time and tick rate once and needs the snapshot's epoch clock. Preserve both work and attribution readings for the flags that require two confirmations.
4. The 650-process cost test exercises `takeSample`, `attribute` and `measure`. It bounds the second table read and memory reads outside the window below 500 ms, and that subset's CPU below 300 ms. It does not run discovery, SQLite work reads, host/pool stages or the future flags. It is not proof of the whole snapshot's 2.5 s wall and 0.3 s CPU goal. Keep the combined live cost proof in 014-15 and the command's complete cost coverage in the later integration work.
5. Version fallback from `DaemonWork.record`, unknown-field reporting, `PsPlaces.userConfig = userConfigPath(env)`, the macOS source, flags, rendering and the CLI remain later rows' work. Do not claim this wave ships a runnable `squeal ps` command. The no-side-effects integration and shipped-bundle proof remain 014-14.
