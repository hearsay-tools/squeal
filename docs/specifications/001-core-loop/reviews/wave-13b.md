# Wave 13 re-review

FAIL 6418a6b

One proven blocker remains (B2), one nonblocking should-fix note (S2), no nits. B1 and S1 are closed. Reviewed `e55ccd6..6418a6b`, bounded by `reviews/wave-13.md` and row 001-152. Spec 004's other rows, 004-15 and 003-40, are outside this review. The worktree started at `743b04f`, two documentation-only commits later; all verification and probes below ran after detaching at the exact candidate `6418a6bb54e04cd91845b902c15032dec568f6d5` with a clean tracked tree.

## Verification

Node 24.21.0, Linux, Vitest 5.0.3. Commands ran at the exact candidate with a clean tracked tree. AGENTS.md and the reviewer skill require the build check; it changed no tracked bundle. No product or board edits. Only one full gate was run, with the brief's worker cap.

```text
$ git rev-parse HEAD
6418a6bb54e04cd91845b902c15032dec568f6d5

$ npm ci
added 56 packages, and audited 57 packages in 31s
found 0 vulnerabilities

$ npm run lint
> squeal@0.1.51 lint
> biome check .
Checked 618 files in 597ms. No fixes applied.

$ npm run typecheck
> squeal@0.1.51 typecheck
> tsc --noEmit

$ npm run build
> squeal@0.1.51 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.51 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts

$ git status --short
(no output)
```

Install reported that esbuild and @parcel/watcher install scripts were not yet allowlisted. The subsequent checks ran; install, lint, typecheck and build each exited 0.

```text
$ npx vitest run --maxWorkers=4
RUN v5.0.3
FAIL test/scheduler/first-observation.test.ts
  read through a directory link: never stores the run's pass under the key
  with the present file, and a second worktree inherits only the re-run
AssertionError: expected 3 to be less than or equal to 2
  test/scheduler/first-observation.test.ts:146:35

Test Files  1 failed | 254 passed | 1 skipped (256)
     Tests  1 failed | 1979 passed | 10 skipped (1990)
  Start at  02:17:11
  Duration  655.17s (tests 96%, transform 3%, import 1%)
   Isolate  256 workers spawned · ~209ms startup each
(exit 1)

$ npx vitest run test/scheduler/first-observation.test.ts -t 'read through a directory link' --maxWorkers=1
RUN v5.0.3
Test Files  1 passed (1)
     Tests  1 passed | 3 skipped (4)
  Start at  02:28:16
  Duration  31.14s (transform 53%, tests 40%, import 8%)
(exit 0)
```

The full gate is not green. Its sole failure is the already recorded 001-148 over-run (board evidence at 0.1.42 and 0.1.45). The requested isolated repeat passed. It is outside this bounded re-review and adds no blocker against these repairs. The gate passed the separate-config stamp regressions, existing source-stamp controls, concurrent child-marker regression, escaped-child identity/overlap tests and real slow-lane daemon case. It also printed two fixture worktree-repair notices and a notice that it stopped one process an earlier test run left; global teardown reported no failure.

Separate background Squeal messages reported a Codex CLI timeout, a slow-marker assertion, handover/step-down boundary assertions, watcher timeouts and linked-directory enumeration. Those are separate evidence; the direct candidate gate passed each of those files. They were not established as new breaks of this slice. No full-suite Squeal checkpoint at the final background revision is claimed.

The independent barrier, scheduler, slow-instance, PID-table and worker-marker probes ran with `node_modules/.bin/tsx <external-probe>.mts`, each exiting 0. They used `/tmp/squeal-review-152-*` fixtures with their own Git repositories/stores and a link to this candidate's installed Vitest. No repository store or running daemon was changed by the probes. Their discriminating outputs are recorded below.

## Blockers

### B2, proven, still open: one project server's stamp hides another server's transient transform

`src/runners/vitest/sources.ts:42`, `:72`, `:85`, `:97`.

001-151's outcome is "every Vite server a Vitest instance creates for a project, whatever its config source, records the bytes it read and is checked before each run and in invalidate()". D4 says every cached file whose bytes no longer hash the same is invalidated. The prior B2's single-project case now passes, but its safety guarantee still fails when two separately configured projects import the same path.

The new `attach()` correctly reaches both servers. Both wrappers write into the same `Map<AbsolutePath, Stamp>`, and `stale()` unions the transformed paths before comparing them with that one stamp. A later load by project B overwrites what project A read, without changing A's cached transform. B's restored bytes can make the comparison pass while A still executes transient bytes.

Independent probe, outside the repository, using the real adapter, scheduler, state sink and an isolated store:

1. Root config lists `vitest.a.config.ts` and `vitest.b.config.ts`. Each names its own project and includes the same `test/mod.test.ts`.
2. That test imports `src/mod.ts` and expects `which === "new"`. Disk holds `which = "old"`, so both projects must fail.
3. Wrap the first scheduler `closure()` call: write `new`, await A's real closure walk, then restore `old`. All hashing/stability checks see restored `old`.
4. B's subsequent closure walk reads `old` and overwrites A's source stamp. Start the normal scheduler tiers.

```text
B2 stored observe=true multi=true:
  [{"project":"a","validity":"current","outcome":"pass"},
   {"project":"b","validity":"current","outcome":"fail"}]
fresh adapter restored disk:
  [{"project":"a","outcome":"fail"},{"project":"b","outcome":"fail"}]
B2 stored observe=false multi=true:
  [{"project":"a","validity":"current","outcome":"pass"},
   {"project":"b","validity":"current","outcome":"fail"}]
fresh adapter restored disk:
  [{"project":"a","outcome":"fail"},{"project":"b","outcome":"fail"}]
```

This is the same previously blocking promise, extended to the multiple servers the repair now instruments. It is not the already accepted separate-read or unstamped `fsModuleCache` bound: both Vite loads were stamped, and no file changes during either run.

Fix sized for one worker: retain stamps and pre-attachment unknowns per plugin container/environment, not only per path. Compare each cached transform with its own container's stamp. A mismatch in any container can conservatively invalidate that absolute path in every project. Preserve per-run `loadedSince` evidence per container and make attachment idempotent per instance. Add this two-separate-config-project scheduler regression with observation on and off, plus a fresh-adapter control. Keep the root, inline and one-separate-config-project controls, and repeat in the slow instance. Do not store a result as current when its server's executed bytes remain uncertain.

## Should-fix

### S2, proven in a controlled table, partially addressed: the first signals still use one batch of identity checks

`src/core/daemon/escaped.ts:315`.

The new identity checks close the old scan-to-command-read and command-read-to-SIGTERM cases. A controlled table reproducing those cases sends only `11 SIGTERM` when pid 10 was reused, and neither names nor signals its replacement. The scan rounds also now retain `(pid, start)` identity.

However, `named.filter(same)` checks every target before the loop sends any SIGTERM. If pid 11 changes identity after the batch check, while the first target is signalled, the loop still signals pid 11. A controlled table swaps pid 11's start time when it receives the signal for pid 10:

```text
S2 before-read: ["11 SIGTERM"]
S2 during-read: ["11 SIGTERM"]
S2 between-signals: ["10 SIGTERM","11 SIGTERM"]
```

The last signal reaches the replacement identity. This proves the table behavior; an actual host pid-reuse occurrence was not attempted. Keep this nonblocking, as S2 was in the first review. It is narrower than requiring a pidfd: move the check into the SIGTERM loop immediately before each signal, and record only identities that were signalled. Add the two-target table regression. The remaining kernel check-to-signal interval is still the explicit limitation in the implementation's comment.

## Nits

None. Prior N1's handover header now names the successor-at-lock precondition (`test/daemon/handover.test.ts:14`).

## What fits

- **B1 closed, proven by the repeated barrier probe.** Lane A settles and pauses before the real scan. Lane B starts a detached marked Node worker and holds its run. Releasing A's scan leaves B alive; releasing B's run then lets its own scan stop it. Output: `second lane alive after first lane sweep = true`; `own final sweep stopped second lane = true`. `afterEachRun` supplies `envFor(lane)` and `afterRun` excludes another lane's carrier even when `alone` was computed before that lane started. The scheduler keeps a lane busy until its run and sweep return.
- **Original B2 single-project probe repaired, proven.** The real scheduler stores the restored disk's current FAIL with observation on and off for a project with its own config. The server attachment is per Vitest instance, applied before `standalone()` and refreshed by `stale()`; already cached files are conservatively invalidated until loaded with a stamp.
- **The slow instance is stamped, proven outside B2's remaining collision.** Build through `withSlowInstance` -> `createRecoveringRunner` -> `createVitestAdapter` with `maxWorkers: 2`. Run a slow-lane file in a separately configured project, invalidate its module, load passing transient bytes through that slow adapter's closure, restore failing bytes, then run through the slow wrapper again. Its report is FAIL, matching disk. It does not borrow the fast instance's stamps.
- **S1 closed, read in source and tested by the gate.** Each child-marker invocation now gets a UUID. Its new barrier test runs two independent fixtures concurrently in forks and threads, with both sleepers alive before either scan. Each expects exactly its own sleeper to be stopped. No attribution is claimed for the historical two-pid incident.
- **S2's original scan/read cases repaired, proven by the controlled table.** The remaining batched-SIGTERM note above does not change the original note's severity.
- The prior review's settled store, recorder, watcher, handover, scheduler bookkeeping and accepted bounds were not re-prosecuted. 001-150 remains the separate task to remove the real Vitest adapter's runner-part queue behind its own run.

## Inputs for the next wave

1. This is the last scheduled re-review on this slice. Send remaining B2 to the human as row 001-152 directs; the coordinator decides the next action.
2. A B2 repair must keep stamp ownership at the same granularity as the cached transforms. Attaching every server is insufficient if a second server can overwrite another's evidence. The test must inspect stored current state, not only a returned report, with observation both on and off.
3. Keep the per-lane marker reaching the real Vitest workers and node:test `RunOptions.childEnv`; preserve sweeps before reports return. The B1 barrier is the accepted control for a lane starting during another lane's sweep.
4. S2 is a small follow-up: recheck per target inside the first signal loop. No host pid churn or extra process scans are needed.

All throwaway probe scripts, fixtures, isolated stores and their logs were outside the repository and removed before committing. No daemon was started by the standalone probes. Only this report is committed.
