# Wave 5 review, round 2

PASS 8e2dda4ad5281ed958b99baa170d9e24988c5f6b

Zero blocking findings. All four prior blockers are fixed, proven by regression tests that fail against the old sources. One plausible nonblocking note remains.

Candidate: `cand/0.1.252` at `8e2dda4ad5281ed958b99baa170d9e24988c5f6b`. This is a narrow re-review of B1 to B4 in `reviews/wave-5.md`, the repair delta, and the CI comparison fix. The rebase includes main `d1a92f446` with documentation changes only. No product code was changed by the reviewer. No end command printed by `ps` was executed.

## Verification

The requested fetch, detached checkout and dependency install ran first:

```text
$ git fetch origin && git checkout --detach 8e2dda4ad && npm ci
HEAD is now at 8e2dda4ad chore(release): 0.1.252 bundles rebuilt after the wave 5 review repairs
added 196 packages, and audited 197 packages in 11s
$ git rev-parse HEAD
8e2dda4ad5281ed958b99baa170d9e24988c5f6b
$ npm run lint
> squeal@0.1.252 lint
> biome check .
Checked 1685 files in 954ms. No fixes applied.
$ npm run typecheck
> squeal@0.1.252 typecheck
> tsc --noEmit
$ npm run build
> squeal@0.1.252 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.252 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
$ git status --short
(no output)
$ node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/check-version-bump.ts 89511aa3c 8e2dda4ad
version bump: 0.1.250 -> 0.1.252, ok
```

All commands above exited 0. Install output is abbreviated. The build reproduced every committed plugin bundle, including Codex's bundles. These checks ran before this review file was created.

### Full gate

The coordinator's independent full gate passed on this exact candidate. It used the shared-host lock and `npx vitest run --maxWorkers=4`, as supplied in the review brief. The reviewer used that gate, not Squeal's checkpoint, and started no second full run.

`/tmp/014-w5-gate.log`:

```text
start 2026-10-22T00:44:03Z 8e2dda4ad5281ed958b99baa170d9e24988c5f6b
exit 0 2026-10-22T01:00:03Z
```

`/tmp/014-w5-gate-full.log`:

```text
 RUN  v5.0.3 /tmp/sq-w5

 Test Files  849 passed | 2 skipped (851)
      Tests  7323 passed | 11 skipped (7334)
   Start at  02:44:04
   Duration  958.86s (tests 97%, import 2%)
```

The omitted lines are fixture gitdir repair messages, cleanup of one earlier run's process, experimental typecheck warnings and Vitest's worker-isolation performance hint. No test failed, including the named dispose-race flake.

CI run `39701541931` also completed with `success` on `8e2dda4ad5281ed958b99baa170d9e24988c5f6b`: all three Node 22 shards and the Node 24 lint/typecheck/version-sensitive job passed. The nightly and main-branch version job were skipped as configured; the version check above ran locally.

### Regression proof against old and repaired sources

A disposable scratch tree held the candidate's tests and fixtures. For the first run, its `src/core/ps/{discover,flags,host,model,snapshot}.ts` and `test/evals/fake-cell.ts` were replaced by the round 1 sources from `c5c7797bb`. The second run restored those files from `8e2dda4ad`. The candidate checkout stayed clean. The scratch tree was removed after the comparison.

Both runs used the same command, with the installed Vitest entry resolved from the candidate's dependencies:

```text
node <candidate>/node_modules/vitest/vitest.mjs run \
  test/ps/snapshot-flags.test.ts test/ps/flags-daemons.test.ts \
  test/evals/fake-daemon.test.ts --maxWorkers=2 \
  -t 'empty then unreadable|\[A, A, B|spares a process|owner exited right after'
```

Against old sources:

```text
Test Files  3 failed (3)
     Tests  5 failed | 39 skipped (44)
  Duration  12.79s
exit 1
```

The failures were the expected assertions, not import or setup errors:

- B1: `empty then unreadable` returned `waiting` where the test rejects it.
- B2: `[A, A, B]` and `[A, A, B, B]` returned empty duplicate lists where the tests require flags against the other lock group.
- B3: the outside-process survival assertion received `false`.
- B4: the owner-gone startup test still found the fake daemon alive after its bounded wait.

With the repaired sources restored:

```text
Test Files  3 passed (3)
     Tests  5 passed | 39 skipped (44)
  Duration  1.71s
exit 0
```

This is a controlled regression experiment, not a second full-suite verdict.

## Prior blockers

| Finding | Result | Evidence in the repair |
| --- | --- | --- |
| B1: one unreadable lock sample still allowed absence claims | **Fixed, proven** | `lockedAgain` accepts both readings. Either positive proves held; only two readable negatives prove absent; otherwise it returns `null` and names the missing reading. Socket ownership follows that state. `readPool` returns unknown counts after either failed reading. `locksRead` prevents the duplicate rule from interpreting partial observations as the D10 no-lock-source case. Snapshot tests cover empty/unreadable, unreadable/held and unreadable/empty, including commands, sockets, permits and unknown entries. The first case fails before and passes after. |
| B2: a passed lock hid a different-lock duplicate | **Fixed, proven** | `duplicates` groups known holders by `lockPath`. A holder conflicts with the other groups, not its own transfer group. Bare `kill` commands go only to proven nonholders after the wait bound. `[A,A,B]` and `[A,A,B,B]` both fail before and pass after; the pure transfer and aged-nonholder tests remain. |
| B3: teardown killed an outside-cell process | **Fixed, proven** | `removeRoot` no longer uses the command-line substring result as signal authority. `cellProcesses` requires an exact NUL-delimited `FAKE_LOG=<cell log>` entry and records the process start. `killCellProcess` rechecks that start before signalling. The new negative test preserves unrelated processes whose arguments name a sibling, an actual path inside the cell, or `note=<cell>`. It fails before and passes after. The positive teardown test checks the owned runner, harness and fake daemon. See the remaining race note below. |
| B4: the owner was already gone when the daemon initialized | **Fixed, proven** | `fakeRoot` records `FAKE_OWNER` as `pid:start` before spawning. `FAKE_DAEMON` compares it at startup and every 500 ms, with no `born !== null` bypass. Dead, zombie and reused-owner identities do not keep it alive. The immediate owner-exit case fails before and passes after. Separate cases cover a live owner, later death, a zombie and a mismatched start. |

## CI comparison fix and preserved behavior

`test/harness/ps-bundle.test.ts` normalizes only a leading `(node:<digits>)` prefix on stderr lines. It leaves stdout, exit status, the rest of the warning, and all other diagnostic text in the equality check. This allows two Node 22 SQLite warnings to differ by process id without discarding stderr or weakening the other comparisons.

The round 1 forty-command comparison was repeated against all four committed plugin builds on this candidate. It compares status, stdout and stderr exactly, with Node's experimental warning disabled for these separate probes. The ten argument lists are those recorded in the round 1 review.

```text
PASS 40 comparisons: exact exit code, stdout and stderr; four committed plugin bundles.
```

The repair delta changes no `src/cli` implementation, harness build entry, launcher, plugin bin, install script or package version. Format-5 routing and older-plugin fallback remain the reviewed code. The shared build reproduces the repaired lock logic in both CLI bundles. The version remains the claimed 0.1.252, above main 0.1.250.

D2 step 3 and the amendment log now match the three lock states, unknown permit counts, and duplicate groups in the code. D4, D6 and D11 retain their round 1 contracts. The accepted first-sample escaped-process limit remains recorded. Round 1 N1 is tracked by the board's recorded FAIL and repair state; the coordinator owns its landing update.

## Nonblocking notes

### N1. Bind the ownership read to the same process start

**Plausible; nonblocking.** `test/evals/cell-processes.ts:47` reads the environment before it reads the start time. If an owned process exits after that environment read and its pid is reused before `startOf`, the scan can pair the old owned environment with the new process's start. The later start check would then accept the new process. No such pid reuse was reproduced in this review. The proven outside-command-line kill from B3 is fixed.

**One-worker follow-up:** read the start before the environment and check it again after the command-line read. Return a candidate only if those starts match, then retain the existing pre-signal check. A fixture that changes the start between scan reads can verify this ordering. This reduces the scan race; it does not claim an atomic operating-system signal-by-identity operation.

No new proven blocker or code nit was found in the bounded delta.

## Inputs for the next wave

No repair row is required for B1 to B4. The coordinator can carry N1 as a small eval-helper follow-up. Goal 6's live-host CPU verdict still belongs to row 014-35 at load no greater than the CPU count; this review does not claim that dogfood result.
