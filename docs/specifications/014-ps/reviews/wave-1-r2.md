PASS 2d4cd0dee7a36c35de327f64a2e0898779286449

Zero remaining blockers, zero should-fix items, zero new findings in the bounded re-review.

Candidate: `cand/0.1.238`, pinned to `2d4cd0dee7a36c35de327f64a2e0898779286449`.
This re-review is bounded by B1 and B2 in `reviews/wave-1.md`, the repair delta since `5bbc50709`, and the two conflict merges named in the dispatch. The separately reviewed 011-51 scheduler change is outside this re-review. The first review's inputs 2 to 5 remain inputs for wave 2 and are not reopened here.

## Verification output

Checks ran at the pinned candidate with a clean tracked tree. `git rev-parse HEAD` returned `2d4cd0dee7a36c35de327f64a2e0898779286449` before review and after verification.

- `npm ci`: exit 0; `added 196 packages, and audited 197 packages in 9s`.
- `npm run lint`: exit 0; `Checked 1610 files in 3s. No fixes applied.`
- `npm run typecheck`: exit 0; `tsc --noEmit`.
- Both original scratch probes, run with `node --disable-warning=ExperimentalWarning --import tsx --input-type=module`, passed all assertions. The same-incarnation stopping check also passed. Output excerpts are below.
- `npm run build` was not run, as the dispatch requires. Local bundle drift is unverified by this review.

The required independent full run used the shared host lock:

```text
flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4

2026-10-21 13:22:21 UTC — start load: 29.01 40.51 34.97
Test Files  1 failed | 803 passed | 1 skipped (805)
     Tests  1 failed | 6949 passed | 10 skipped (6960)
  Duration  1193.01s
2026-10-21 13:42:15 UTC — end load: 37.32 35.02 34.93
Exit 1
```

The only failed file was the dispatch's known timing flake, `test/harness/opencode-dispose.test.ts` (row 008-38). Its held Stop died at +2212 ms, after the +2000 ms idle deadline, before the new turn's request. The earlier attempts missed at +2030 and +2006 ms. A load sample when the failure was observed at 13:29 UTC was `35.45 32.23 32.34`; this was not an exact failure-time measurement.

As required, I reran that file alone:

```text
npx vitest run test/harness/opencode-dispose.test.ts --maxWorkers=4

2026-10-21 13:43:31 UTC — start load: 28.51 32.69 34.12
Test Files  1 passed (1)
     Tests  3 passed (3)
  Duration  22.40s
2026-10-21 13:43:54 UTC — end load: 24.36 31.41 33.66
Exit 0
```

The isolated pass confirms recovery under lower load. The full run remains a failed run; it is not reported as passing. This known failure is outside the reviewed repair and adds no blocker to the bounded code verdict.

A supplemental Squeal status check after the report-only edit returned `Known failures: 0; all 788 test files current` and `Returned on quiet`. It reported that the edits since revision 2 re-keyed no test file. These background results do not replace the independent run above.

## Findings

### B1 resolved blocker / proven: the predecessor's fields cannot become the starting daemon's work

Locations: `src/core/ps/discover.ts:67`, `src/core/ps/work.ts:121`, `test/ps/work.test.ts:313`.

`ownStartOn(source)` is now the one D2 start exclusion used by `phaseOn` and `readWork`. Both read the boot time and tick rate through that rule. A store start earlier than the process start, with the same one-second margin as before, rejects the predecessor's record, token, tiers, checkpoints and last use. `recordedStartedAt` stays, so `phaseOn` still identifies `starting`. Consumers remain worktree data. The reader names `daemon <pid> work` in `unknown`.

I reran the first review's fixture probe through production `discover`, `readWork`, `phaseOn` and `attribute` at the new pinned commit. I also added a predecessor checkpoint and a consumer to the scratch fixture. Assertions checked every rejected field, the retained recorded start and consumer, the phase, the unknown entry, and the absence of pid 900 from the new daemon's attributed processes. Output excerpt:

```json
{
  "probe": "B1",
  "processStart": 1792599400000,
  "recordedStart": 1792599345000,
  "phase": "starting",
  "record": null,
  "token": null,
  "tiers": [],
  "checkpoints": [],
  "lastUse": null,
  "consumer": "kept-consumer",
  "attribution": { "processes": [], "unowned": [] }
}
```

The old token is no longer supplied to `attribute`. With an unread current token, attribution conservatively refrains from declaring pid 900 an orphan too; the repair does not claim knowledge it lacks. A second assertion set used a cleared record from the same incarnation. It kept the token and returned `stopping`:

```json
{"probe":"same-incarnation stopping","phase":"stopping","tokenKept":true}
```

The added regression fixture covers the unreplaced predecessor record, old run, old checkpoint, old last use and escaped process together. It builds owners from the accepted work before calling `attribute`. The start rule remains an exclusion; lock identity still names the worktree and store.

### B2 resolved blocker / proven: pytest files follow the runner's final basetemp

Locations: `src/core/ps/processes.ts:164`, `test/ps/processes.test.ts:264`.

`filesOf` now uses `findLastIndex` for `--basetemp=`. This matches the existing runner contract, which appends its own basetemp after the project's arguments and before the selected test files. The new fixture includes the project basetemp, options between the two basetemps, and the runner's override.

I reran the original probe using the real `pytestArgs` builder, the runner's appended override and a marked pytest child. The same assertion now passes, with no options in the file list:

```json
{
  "probe": "B2",
  "runner": "pytest",
  "files": ["tests/test_a.py"]
}
```

### N1 resolved note / proven: the board records the implementation in review

The board update from main, `36c13b076`, is present. Rows 014-06 to 014-08 now say `in review`; row 014-09 says `running`. The initial finding concerned these rows remaining `running` and `planned` during the first review. No board file was edited by the reviewer.

## Conflict merges and scope

- `src/core/types/store.ts` retains both `daemonUsed` (`daemon-used:`, owner `daemon/last-use`) and `yields` (`yields:`, owner `scheduler/yields`). Against the first reviewed candidate, the registry delta adds only `yields`; against `0dacd9a68`, it adds only `daemonUsed`. Neither side was overwritten.
- `docs/specifications/011-core/status.md` retains all three 011-51 amendment lines from main and the 014-08 last-use amendment from the first candidate. Against `0dacd9a68`, the only change is the appended 014-08 line. Against the first candidate, only the three 011-51 lines were added.
- Under `src/core/ps`, the only changed files since `5bbc50709` are `discover.ts`, `work.ts` and `processes.ts`. Their delta contains the shared start exclusion and B1 field rejection, plus B2's last-basetemp selection. Only `test/ps/work.test.ts` and `test/ps/processes.test.ts` changed under `test/ps`. The source interface, public shape, model, measurement, host and Linux source remain unchanged.
- The rebuilt release bundles and the separately reviewed 011-51 implementation are not independently re-reviewed here. No build was run, as instructed. The first review's settled checks and later-wave inputs remain in `wave-1.md`.
