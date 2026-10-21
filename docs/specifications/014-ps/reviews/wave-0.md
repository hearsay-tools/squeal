# Wave 0 review: Linux source and shared types

FAIL 4b5d200a7aa402df9e9bae5f76f0377a1467b09a

One proven blocker, one plausible should-fix, one proven documentation nit.

Candidate: `cand/014-04`, pinned to `4b5d200a7aa402df9e9bae5f76f0377a1467b09a`.
Range: `8abf2531c..4b5d200a7`. Reviewed against D1 to D11 and the two accepted 014-04 amendments. No product code changed.

## Verification output

Checks ran on the exact pinned commit, with no tracked changes before, during or after the runs. `npm run build` left the committed bundles unchanged. The only repository edit after verification is this report. Output excerpts follow.

```text
$ git rev-parse HEAD
4b5d200a7aa402df9e9bae5f76f0377a1467b09a
$ git status --short
(no output)

$ npm ci
added 196 packages, and audited 197 packages in 11s
(exit 0)

$ npm run lint
> biome check .
Checked 1588 files in 675ms. No fixes applied.
(exit 0)

$ npm run typecheck
> tsc --noEmit
(exit 0)

$ npm run build
> tsc -p tsconfig.build.json && npm run build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
(exit 0; git status --short empty afterward)
```

### Independent full run

The required full run held the host lock. It started at 2026-10-21 10:30:24 UTC and ended at 10:51:25 UTC. `/proc/loadavg` was `44.86 47.18 44.30` at start and `37.18 40.01 43.60` at end. A check while the failed-file result was already present, at 10:42 UTC, read `42.03 53.37 49.23`; there was no load sample at the exact failure time.

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4

FAIL test/harness/opencode-dispose.test.ts > a report held while dispose meets newer input > serve: an abort of the new turn, then the old Stop's answer, stores nothing
Error: before the new turn's request, the plugin killed the held Stop at +2292, at or after its idle deadline (+2000)
marks, ms since the first idle: idle +0, stop +47 (pid 363521), dispose +104, input +327, kill +2292 (pid 363521), disposed +2878; the held Stop's deadline: +2000

Test Files  1 failed | 791 passed | 1 skipped (793)
     Tests  1 failed | 6832 passed | 10 skipped (6843)
  Duration  1260.08s (tests 97%, import 2%, transform 1%)
(exit 1)
```

The failure output also records the first two barrier attempts missing the two-second deadline: kills at `+2025` and `+2225`. All three new `test/ps/*.test.ts` files passed. `test/integration/pi-events.test.ts`, the other file named in the dispatch's earlier loaded run, passed too.

### Failed file alone

At the same clean commit, the only failed file ran alone from 10:53:02 to 10:53:44 UTC. Load was `33.29 37.61 42.35` at start and `31.15 36.65 41.84` at end.

```text
$ npx vitest run test/harness/opencode-dispose.test.ts --maxWorkers=4

Test Files  1 passed (1)
     Tests  3 passed (3)
  Duration  40.97s (tests 98%, transform 2%)
(exit 0)
```

The full suite did not pass. The isolated recovery is consistent with the earlier loaded barrier failure in the dispatch; it does not establish load as the sole cause. This test and its implementation are outside the candidate range. The failure is recorded here, not treated as a new blocker against wave 0. No second full run was made.

## Blockers

### B1. Proven: the output seam cannot carry the required unflagged file counts

Locations: `src/core/ps/shape.ts:31`, `src/core/ps/shape.ts:220`, `src/core/ps/model.ts:196`, `src/core/ps/model.ts:238`.

D1 says: "`--full` ... also counts the files that never get a flag." D7 names lock files, waiter lock files, permit files above the pool size, and session-root files. They must never get a flag.

`PsSnapshot.files` and `FlagFindings.files` accept only `PsFileFlag`. Its `flag` is mandatory and allows only `stale-socket`, `stale-pool-mark`, or `leftover-temp`. It also requires an end command. There is no other count field for these harmless files. `Render` accepts only the snapshot and `{ full }`, so the renderer cannot receive the missing counts through its existing arguments.

Concrete case: four unheld waiter lock files exist, with no stale socket, stale pool mark or leftover directory. `--full` must show their count while the snapshot still has zero flags and no end command for them. The present contract cannot express that state. Putting the count in `unknown` would claim unreadable data; putting it in a flagged entry would claim a problem the spec excludes. Having the renderer scan the filesystem would break D8's rendering layer over the shape.

A temporary TypeScript probe outside the tree attempted an unflagged file entry and a separate snapshot count field. With the repository's compiler and Node types, it returned:

```text
TS2322: Type '"lock-file"' is not assignable to type '"leftover-temp" | "stale-pool-mark" | "stale-socket"'.
TS2322: Type 'null' is not assignable to type 'string'.
TS2339: Property 'unflaggedFiles' does not exist on type 'PsSnapshot'.
```

**Fix, one shared-types repair:** add a typed collection for these informational counts to the public snapshot and the internal stage result. Use a separate name or a discriminated entry that cannot be counted as a flag. Add a typed fixture for the four-file, zero-flag case. Keep `Render` a function of the snapshot. The coordinator must record the additive D8 amendment and pass the revised contract to 014-10 and 014-11 before dispatch. No filesystem scanner or CLI implementation belongs in this repair.

## Should-fix

### S1. Plausible: the privacy test still fails when root can read the unreadable fixture

Locations: `test/ps/proc.test.ts:120`, `test/ps/fixture.ts:108`.

The dedicated permission test skips root at line 116. The next test iterates every fixture, including process 1200. That fixture has mode 000 and the synthetic mark `hidden:vitest`, but the loop expects `null` because `environ` is the string `"unreadable"`. Root with DAC override can read the mark. The source then behaves correctly and the test fails.

A probe made just that fixture readable, without changing the repository, and used the test's expectation calculation:

```json
{"simulatedRootRead":"hidden:vitest","testExpected":null}
```

An actual root suite was not run. This is not a blocker for the non-root Linux CI runner or the source contract.

**Fix:** exclude the unreadable fixture from that loop when `isRoot`, or give it the root-specific expected mark. Keep the no-output assertions and the separate permission case.

## Nits

### N1. Proven: the pinned board does not show the review now running

Location: `docs/board.md:891`.

014-04 still says `running`; 014-05 still says `planned`. The candidate contains the implementation and this task is its dispatched review. The coordinator should update the rows when recording this review. This is documentation drift, not a product blocker. The reviewer left the board unchanged.

## What fits

- `PsSource` provides the process table, arguments, restricted mark, memory, descriptors, working directories, locks, file identity, listener identity, PID namespace, boot time, clock tick rate and host readings needed by D2 to D7. Filesystem and read-only store inspection remain in the later stages.
- The Linux source reads files synchronously. Its only production spawn is `ss -xle`, with fixed arguments, no shell or stdin, bounded output and a two-second timeout. It contains no store access, connection, write or signal.
- `markOf` searches only for `SQUEAL_DAEMON_CHILD=` at an environment-entry boundary. It returns only that entry's value. Other environment entries are neither returned nor logged. The fixture paths are anonymized and the secret-like fixture values are synthetic.
- Missing and unreadable files are caught at the read boundary. Process disappearance between the table read and later reads produces absent rows or null values. The malformed stat rows in the fixture tests are skipped. The fixture cases cover those paths, spaces and parentheses in comm, blocked locks, and OFD locks without an owner.
- `fileKey` normalizes Linux device major/minor values to the same form as `/proc/locks`. The live SQLite-lock test verifies the join using this test process's own PID. The socket test skips when `ss` is unavailable. There is no fixed PID namespace or git-identity dependency in the new live tests.
- `shape.ts` matches the amended D8 block key for key. `PS_SHAPE_VERSION` is the literal 1. The missing informational file counts in B1 are also absent from that block; the repair needs a spec amendment, not a silent shape change.
- `model.ts` imports the public shape and keeps stage-only data separate. `Discover`, `ReadWork`, `TakeSample`, `Measure`, `Attribute`, `HostTotals` and `ReadPool` support the disjoint wave 1 files. First and second readings retain work and attribution for the two-sample rules.
- D10 can implement the source with cached `ps` samples and `vm_stat`, `sysctl`, `lsof` and Node host readings. Nullable locks, descriptors, namespace, swap and marks permit its stated gaps. This is interface inspection, not a macOS runtime claim.

## Inputs for wave 1 and wave 2

1. Repair B1 first and publish the revised types to 014-10 and 014-11. The rest of the platform interface can stay.
2. 014-06 implements `Discover(source, table, places)` and `ReadWork(source, table, daemons)`. Read each store through `node:sqlite` with `readOnly: true`; never `openStore`. Bound open runs and checkpoints by the daemon record's start time. Hold the lock-based Linux identity separate from that timestamp.
3. 014-07 implements sampling, measurement, attribution and host/pool totals. Take the first table and host reading, do discovery and per-process reads inside the two-second window, and take the second reading at its end. Compare PID and start ticks across samples. A process seen only once has null window CPU, not zero. Keep total cost within 2.5 seconds wall and 0.3 seconds CPU; the live cost proof remains 014-15's work.
4. Preserve both work and attribution readings for 014-10. Confirm `hung` and `orphan-test-process` twice. Keep marks restricted to their token/lane/run value. The macOS source must name the rules it cannot evaluate in `unknown`.
5. 014-11 assembles the amended D8 snapshot, keeps informational file counts out of the flag total, and passes it to `Render`. Discovery, stage implementations, the last-use write, CLI, macOS parsers, side-effect integration tests and shipped-bundle proof are still owed by later rows.
