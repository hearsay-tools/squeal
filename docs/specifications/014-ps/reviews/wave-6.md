PASS 717f7167989eea314ec7abcf5bd7b541ec1277d7

# Wave 6 review

Zero blockers, zero should-fix findings, one nonblocking documentation nit. This verdict covers row 014-38 and the release build. It does not claim a green full suite or green CI.

Candidate: `cand/0.1.258`, pinned to `717f7167989eea314ec7abcf5bd7b541ec1277d7`. Range: `49117be08..717f71679`. Reviewed against `tasks/wave-6.md`, the human's 2026-10-22 decision after Round 3 in `status.md`, and D7. No product code changed during this review. No end command printed by `ps` was run.

## Verification

`npm ci` ran before any npm script in both the reviewer worktree and the scratch build directory. Commands below exited 0. Install output is abbreviated.

```text
$ git rev-parse HEAD
717f7167989eea314ec7abcf5bd7b541ec1277d7
$ npm ci
added 196 packages, and audited 197 packages in 16s
$ npm run lint
> squeal@0.1.258 lint
> biome check .
Checked 1723 files in 1141ms. No fixes applied.
$ npm run typecheck
> squeal@0.1.258 typecheck
> tsc --noEmit
$ npm run check:version -- 49117be08 717f7167989eea314ec7abcf5bd7b541ec1277d7
version bump: 0.1.256 -> 0.1.258, ok
$ git status --short
(no output before writing this report)
```

The reviewer did not run `npm run build` in this worktree. A `git archive` of the exact candidate was extracted under `/tmp`, followed by its own `npm ci` and `npm run build`:

```text
> squeal@0.1.258 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.258 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
Scratch build: 92 tracked bundles, launchers and version files match candidate byte for byte.
Version: 0.1.258 in all eight files, including both lockfile fields.
```

The comparison checked all four plugins' tracked `dist` and `bin` files, their version manifests, root `package.json`, both fields of `package-lock.json`, and `install.sh`. It compared rebuilt bytes against `git show` of the candidate, including Codex's bundles.

### Coordinator's independent full run

The brief assigns the locked full run to the coordinator. This review reads `/tmp/014-w6-gate.log` and `/tmp/014-w6-gate-full.log`; it starts no second full run and uses no Squeal checkpoint as a substitute.

The locked run finished with exit 1 on the exact candidate. `/tmp/014-w6-gate.log`:

```text
start 2026-10-22T07:39:43Z 717f7167989eea314ec7abcf5bd7b541ec1277d7
exit 1 2026-10-22T08:04:54Z
```

`/tmp/014-w6-gate-full.log`:

```text
 Test Files  3 failed | 871 passed | 2 skipped (876)
      Tests  4 failed | 7440 passed | 11 skipped (7455)
   Start at  09:39:43
   Duration  1509.31s (tests 97%, import 2%)
```

The four failed cases are outside the changed sources and tests:

| File | Observed failure | Existing owner |
| --- | --- | --- |
| `test/harness/opencode-dispose.test.ts:172` | Held Stop killed at +2152 ms against its +2000 ms deadline; the earlier two barrier attempts also missed it | 008-38 |
| `test/scheduler/slow-slot-fair.test.ts:118` | Guard-handover teardown hook exceeded 10,000 ms | 011-99 |
| `test/scheduler/slow-slot-fair.test.ts:172` | Probe count grew from 426 to 442 while the test expected no growth | 011-99 |
| `test/scheduler/backlog-slots-overhead.test.ts:82` | Best slot time 29,186 ms exceeded the 28,972 ms bound, ratio 1.21 against 1.20 | 011-99 |

These are **proven failed checks**, with existing matching reports in the board. Their cause in this candidate is **unverified**. The changed executable source is limited to `src/core/ps/flags.ts`, which these failure paths do not call. The run reports no failure in `test/ps/`, including both changed test files. No isolated retry was started by this reviewer. At 07:55 UTC the host's one-minute load was 53.65; this is a point observation, not a measurement of the load at each failure.

### Candidate CI

[CI run 39742033613](https://github.com/hearsay-tools/squeal/actions/runs/39742033613) attempt 1 completed with `failure` at this exact SHA. Node 24 lint, typecheck and version-sensitive tests passed. Node 22 shards 2 and 3 passed. Node 22 shard 1 failed:

```text
Test Files  1 failed | 290 passed | 1 skipped (292)
     Tests  2 failed | 2659 passed | 8 skipped (2669)
```

Both failures are in `test/e2e/opencode.test.ts`: the baseline-and-delivery case and the blocked-next-write case. Both stop in `pluginInstall` at `test/helpers/opencode.ts:367` with `opencode plugin file:<directory> -g exited null`, after the helper's 60-second limit. The failure occurs during plugin installation, before either case reaches its behavior assertions. These are proven failed checks; a defect caused by this candidate is unverified. The nightly and main-only version job were skipped as configured; the version check ran locally above.

The reviewer's background Squeal also reports the unchanged OpenCode dispose abort case as FAIL at revision 0: its held Stop was killed at +2151 ms against the +2000 ms idle deadline. `squeal why` shows the same failure on earlier commits; it matches the timing problem recorded in board row 008-38. This is not a passing background verdict and was not retried by the reviewer.

The coordinator reran the failed shard as **attempt 2** after observing that main passed both cases at 06:14 and 06:47 UTC, and that the install timeout matches the npm-outage pattern recorded by 011 in `36cb64b00`. Attempt 2 completed with `failure` at the same candidate SHA. Both OpenCode cases now passed, in 11,686 and 12,258 ms. Its only failures are the two `slow-slot-fair.test.ts` cases already listed above: the 10-second teardown timeout and a probe count of 454 instead of 440. Its totals remain:

```text
Test Files  1 failed | 290 passed | 1 skipped (292)
     Tests  2 failed | 2659 passed | 8 skipped (2669)
```

Attempt 2 leaves Node 24 and Node 22 shards 2 and 3 green, and shard 1 red on the existing 011-99 cases. The review records this red CI result explicitly; it does not classify the gate as passing.

### Independent comparison of the flag decisions

A throwaway TypeScript probe in the scratch tree imported both the base and candidate `flag` implementations. It exercised 3,840 combinations of version, held/free/unknown lock, own record present/absent, live/dead/unread/no consumers, departure time, slow/checkpoint/no/unread drain work, fresh/stale heartbeat, and present/absent last-use data.

For a base result with both a draining state and an `older` flag, the expected change removes only that flag and appends `, older` to the state. Every other result must be identical, including flag order, commands and ordered unknown entries.

```text
Differential matrix: 3840 cases passed; 12 intended draining/older changes; all other flags, order, states, unknown entries unchanged.
```

The probe sources were removed. It runs no end command, daemon or test suite.

## Blockers

None. No proven break of this row's done-when or a spec goal was found.

## Should-fix

None.

## Nits

**N1, proven, nonblocking: name the third information state in the shape's field comment.** `src/core/ps/shape.ts:106` lists `draining 22m left` and `older (session <pid> holds it)` but omits `draining <N>m left, older`. D7 now documents all three. Add the new example to that comment in a later documentation cleanup. The field is already `string`, and this omission breaks no reader or output.

## What fits

- **Decision order and other flags, proven by source and comparison.** `lifeOf` now runs before the older decision. Its only non-null state is a drain with positive time left. A lifecycle flag still enters the flags array after `hung`; `no-lock` remains before `hung`; other flags retain their order. Computing life earlier adds no state to a daemon that is not draining. `olderOf` still runs before life and names the same unread installed version or unread consumer process. The comparison also covers lifecycle unknown entries.
- **Drain and deadline, proven by source and the candidate's tests.** `drainLeftMs` requires no consumers, the daemon's own departure, slow work or an open checkpoint, and positive time before its own `idleExitMinutes` deadline. `flags-daemons.test.ts:171` covers 18 and 1 minutes left, the exact deadline, and a minute past it. During the drain only the older flag is withheld. At the exact deadline `older` returns with `squeal stop <root>`; after the existing heartbeat grace `past-departure` joins it. Other reasons such as `hung` still flag a draining daemon.
- **Text, JSON and exit status, proven by source and the command regression.** `flags-older-drain.test.ts` checks the command's text and JSON: the combined state, no flags, no end command, exit 0, and 18 minutes in `work.drainLeftMs`. At the exact deadline it checks `serving`, the older reason and stop command, and exit 1. The existing session-held test remains unchanged and the comparison preserves that state. A registered consumer prevents a drain, so the combined state cannot replace the session-held state.
- **State readers and goal 5, proven by source.** `snapshot-shape.ts:109` uses `startsWith("draining")`, so the suffix preserves `drainLeftMs`. `render.ts:157` handles a long state by printing it on its own line; it does not parse its words. The CLI serializes the same snapshot object. `phase` retains its phase meaning and `state` remains the open display string documented by D7, with an added information value. No key, unit or existing field meaning changes, so shape version 1 remains compatible. N1 is the only missing field-comment example.
- **D7 and the release, proven.** D7 describes the combined state and the older flag's return at the deadline. The human's decision is in `status.md`. The version raise changes all eight version files consistently to 0.1.258, and the build reproduces every checked shipped output.

## Inputs for the next wave

No repair wave is required by this review. Keep the `draining` prefix while `snapshot-shape.ts` uses it. Keep `phase` separate from the information string. Preserve the existing heartbeat grace for `past-departure`; the older flag returns at the drain deadline without that grace. Carry N1 into a documentation cleanup. The full-run and CI failures above remain visible to the coordinator; this review does not waive their landing policy. Row 014-37's scale measurement and the later temp-prefix decision remain outside this candidate.
