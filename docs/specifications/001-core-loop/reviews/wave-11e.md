# Review: wave 11e, 001-113 and 001-116 (task 001-114)

## Verification

Candidate: `581f5022c4a0d519b3070e9857f232d7452513f0` (0.1.25). Checks ran at clean HEAD `3911ad08c0f741d25afda3b43e391c9760365ba8`. The coordinator explicitly authorized that successor: its only differences from the candidate are `docs/board.md` and this review's brief in `tasks/wave-11.md`. No candidate mismatch finding. Build reproduced both plugins byte for byte. No product files changed during verification or review.

```text
$ git rev-parse HEAD
3911ad08c0f741d25afda3b43e391c9760365ba8
$ npm ci

added 56 packages, and audited 57 packages in 2s

18 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
npm warn install-scripts
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
$ npm run lint

> squeal@0.1.25 lint
> biome check .

Checked 509 files in 184ms. No fixes applied.
$ npm run typecheck

> squeal@0.1.25 typecheck
> tsc --noEmit

$ npm run build

> squeal@0.1.25 build
> tsc -p tsconfig.build.json && npm run build:plugin


> squeal@0.1.25 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts

$ git status --short
(empty)
$ SQUEAL_PROBE_TORN_STATUS=1 npx vitest run
 Test Files  1 failed | 188 passed (189)
      Tests  1 failed | 1587 passed | 8 skipped (1596)
   Duration  139.43s
```

The sole full-run failure was `test/harness/stop.test.ts:176`: the locked-store case took 1946.054874 ms against its 1875 ms assertion. The load average reached 59.02. This is verification evidence, not a proven defect in this range; the in-process time was still below the configured 2000 ms timeout. The focused rerun passed the Stop check and the deterministic status checks:

```text
$ npx vitest run test/harness/stop.test.ts test/status/torn-read.test.ts \
    test/harness/latency.test.ts test/harness/codex/latency.test.ts --maxWorkers=1
 Test Files  4 passed (4)
      Tests  14 passed (14)
   Duration  128.97s
```

The full-suite result remains one failed check, with that check passing on rerun. A repeatable Stop budget break is **unverified**, not a finding against the wave.

The opt-in `test/e2e/torn-status.test.ts` ran for both shipped plugins in that full run. Both passed. The reinstall scheduler tests, real-daemon reinstall test, and four deterministic torn-read tests also passed.

## Verdict

**PASS at `581f502`.** Counts: 0 blockers, 0 should-fix, 0 nits.

Scope: 001-113's source/tests/docs changes, cherry-picked as `5ccb6d4`, `a0e8fea`, `2e641bc`, `d9bbff0`; 001-116's changes, cherry-picked as `fa884ab`, `da620d2`, `8453da1`, `15af6de`; and their committed bundles in `581f502`. The interleaved 001-117/001-118 work belongs to its own review. `wave-11c.md` was read first for the reinstall findings; its settled earlier issues were not re-prosecuted.

| Prior finding | Judgment at this candidate |
| --- | --- |
| wave-11c B1: edit during in-process wait wedges the pump | Closed. A running scheduler exits on reinstall instead of entering a wait; `#hasWork()` refuses to re-arm after reinstall or while a fresh scheduler waits. Edits and explicit requests after the exit decision settle without starting work. |
| wave-11c B2: old runner transform stores a stale pass | Closed. The old tier stores no results, the old runner closes, and the successor uses a fresh instance. Both scheduler and real-daemon tests turn the edited addition into a failure. |
| wave-11c S1: workspace reinstall omitted from stamp | Closed for the specified layout. When the root holds no install, `installDirs()` adds every declaring workspace. Removing one is detected by the stamp and by an interval batch with no paths. |

## Blockers

None.

## Should-fix

None.

## Nits

None.

## What fits

### Reinstall, D5 and D10

- `scheduler.ts:140-194` reconciles the triggering revision, abandons the open checkpoint, drops queued refinements and tiers, and calls `onReinstall` once outside its mutex. Subsequent batches cannot restart the pump.
- `scheduler.ts:274-320` discards the tier in flight when the exit decision or changed install stamp overlaps it. An install restored with identical content is still caught by lockfile stat changes; the existing test verifies the discarded run actually saw a failure and that no failure was stored.
- `daemon.ts:313` connects the callback to shutdown with reason `reinstalled`, code 0 and the persisted note. `daemon.ts:392-412` closes the loop, runner and scratch space, clears the record, closes the store/socket, and releases the singleton lock last. The real-daemon test asserts exit 0, one note and a null daemon record.
- `bootstrap.ts:58-72` carries changes after the refined revision, including the successor's start revision, into the new baseline's recent group. Its ordering test uses tier size 1 and proves the edited math file runs before the dependency-version miss.
- A same-session next PostToolBatch/PostToolUse does respawn: `ensureIfStale()` sees the cleared record and `ensureDaemon()` spawns the bundled CLI. Fresh-start waiting opens no Vitest runner while the install is missing; the later edit is validated with a new runner.
- With no session to run a hook, the daemon remains down after its exit. D10 explicitly chooses the next hook/session as the restart trigger. Status reports down and `--wait` can return `no-daemon`; installing alone is not an autonomous restart promise.

A single throwaway live proof ran both committed plugin bundles against private repositories under `/tmp`, each with its own cached Vitest install and runtime directory. It registered, completed a passing baseline, ran SessionEnd, removed the install, observed the daemon down with no stored failure, waited without a consumer, then ran the next tool hook while dependencies were still absent. The fresh daemon reported its install wait; an actual `npm ci --offline --ignore-scripts --no-audit --no-fund` ran while `src/math.ts` changed from addition to subtraction. Each daemon then recorded the math test as a current failure at revision 2.

```text
{"plugin":"claude-code","startMs":52,"respawnMs":100,"noConsumerLeavesDaemonDown":true,"npmCiMs":639,"finalRevision":2,"failures":1}
{"plugin":"codex","startMs":81,"respawnMs":230,"noConsumerLeavesDaemonDown":true,"npmCiMs":1082,"finalRevision":2,"failures":1}
```

This proof tested the actual hook-to-CLI seam; the committed daemon test starts its successor directly. It did not claim to run npm scripts or to exercise every package manager. Its fixture repositories, daemons and throwaway script were removed before committing this file.

### Consistent reads, D7 and D8

- `Connection.read()` at `connection.ts:64-77` uses deferred `BEGIN`, closes with `COMMIT`, rolls back on exceptions, and reuses an already-open transaction. It takes no write reservation. All affected callbacks are synchronous and read-only.
- `withStatusStore()` wraps the entire callback. Consequently each `--wait` iteration reads the states, revision, liveness and returned snapshot from one transaction. The transaction ends before its sleep or the next poll. The snapshot returned on quiet is the one judged quiet.
- `buildSnapshot()` owns its transaction too. `createStatusBuilder().build()` includes the worktree lookup in its transaction. The connection symbol allows a forwarding `Proxy` to keep that guarantee. The paused-store e2e exercises this path for both plugins.
- Stop's `waitForPending()` opens one transaction per header read and releases it before sleeping. No transaction spans the 1500 ms wait.
- The deterministic tests commit a revision/re-key on a second connection between the reader's statements. The commit succeeds while the reader is open, and the reader returns revision 3 with its revision-3 states; the next reader returns revision 4 with pending work. This directly discriminates a torn read and a writer blocked by `BEGIN IMMEDIATE`.
- Stop still reserves its existing margin: 1500 ms wait + 250 ms busy timeout + 250 ms margin = 2000 ms. The new deferred transaction introduces no extra lock wait on the WAL writer. Both bundled latency tests passed in the focused run, but their 80 ms p95 assertions are guarded at load above 4. The machine remained above that threshold. Calm-load p95 is therefore **unverified**; the live restart hooks measured 100/230 ms and each was explicitly checked below 2000 ms.

## Inputs for the next wave

No fix wave is required for 001-113/001-116 by this review. Keep these interfaces and ordering:

1. Scheduler `onReinstall(note)` invokes shutdown outside the scheduler mutex. Do not await shutdown from the tier pump or the feed's batch callback, since shutdown waits for those to drain.
2. Suppress overlapped tier results before closing the runner. Clear the daemon record and close the socket before releasing the singleton lock. A successor must be spawned by a later hook or explicit start; no consumer means an honest down state.
3. A successor's baseline must use a new runner and carry the unrefined/start paths into its recent work group. Keep the size-1 ordering assertion and the real-daemon edited-code assertion.
4. Status builders and each wait poll must call `readTransaction` with a synchronous, read-only callback. Do not place sleep, socket I/O or consumer-view writes inside it. Reads nested inside delivery's write transaction reuse that transaction.
5. Preserve Stop's 1500 ms cap and 250 ms margin. Calm-load p95 evidence remains subject to the repository's load guard; the loaded full-run timing failure is not a green full-suite result.

The permanent daemon test covers manual deletion/restoration and starts its successor directly. The actual bundled-hook/no-consumer/npm-ci seam was verified by the disposable proof above. Workspace reinstall is covered by scheduler/stamp tests, not by a separate live monorepo proof. These are the evidence boundaries, not blocking findings.
