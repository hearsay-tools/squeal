# 011-211 notes: the slow instance frees its environment

Worker cc9bf3f8, 2026-10-25. Row 011-211 (gh-78, gh-90), digest `triage/2026-10-25-digest.md` group A.

## Seam map

- `src/core/scheduler/slow-release.ts` (new) is the one close path. `opened(lane)` runs at a slow tier's start (`#fly`). `release(lane)` runs when a slow tier ends with its pass drained, or ends on hold (`#slowEnded`, still in flight, after its record). `idle()` runs at a hold's start (`commandHold` after `#cancelHeld`, and the pump's two `held` branches) and at the bound's timer. `selecting()` wraps the pump's `#slow.next`, so a slow selection, the load guard's wait included, keeps the instance. `arm()` runs in `#fly`'s `finally` after a slow tier.
- `src/core/scheduler/scheduler.ts`: `#releaseIfDrained` became `#slowEnded` (drained or on hold) and `#releaseLane` (the runner call, its error noted).
- `src/core/daemon/slow-instance.ts`: behaviour unchanged. `releaseLane` drops the instance; the next slow run awaits the close and makes a new instance.
- `SlowTierOptions.releaseMs` (`options.ts`, additive): the bound, default `SLOW_RELEASE_MS`, 60000.
- Vitest 5.0.3: `Vitest.close()` runs each project's `_teardownGlobalSetup()` before it closes the pool. A project's `globalSetup` runs only when files of that project run (`initializeGlobalSetup(paths)`, plus the root project). So the fast instance never sets up a project that holds only slow files, as cezarion's `e2e` project does.

## Decisions the spec did not settle

- The bound counts from the last slow run's end (`SlowTier.endedAt`), not from each check. A check at the slot or for an idle consumer comes every 15 s and would reset it.
- The load guard's wait keeps the instance (the digest's *Limits*). A wait that ends past the bound with no tier started closes the instance at once.
- Both holds of 011 C9 close it: a command hold in `commandHold()`, a merge hold when the pump reads the index.
- The 011-195 model is unchanged (coordinator, 2026-10-25, option (a)): it declares no slow files and has no hold event. A later row adds them.

## Tests

- `test/scheduler/slow-release-setup.test.ts`: real Vitest, `basic` in two projects, `e2e` with a `globalSetup` that writes `setup` and `teardown` marks. A drained pass closes once. A command hold and a merge hold close at once. A tier that yields to an edit's fast work closes after the bound. The next slow tier runs the setup again. The harness option `slowInstance` (`test/scheduler/helpers.ts`) puts the slow lane on its own Vitest instance, as the daemon does.
- `test/scheduler/slow-release.test.ts`: `SlowRelease` alone, and two orders through the scheduler with the fake runner. Each guard fails its case when removed: `idle()`'s selection check, the pump's `selecting` wrapper, `idle()`'s in-flight filter; for a cancelling runner, the cancel before the close together with that filter.
- `test/evals/stopped-hold-evidence.test.ts`: every stopped form reads the same to the evals parser with and without the hold sentence, plain and in hook JSON.

## Left for others

- Spec text: 004 D2 still says the instance is "closed when it drains"; 013 V1 has no cross-reference.
- Bundles are not rebuilt (the bundle tests fail on drift).
- Not measured: the cost of one instance and one `globalSetup` per slow resume after the bound (cezarion's `test-env-up.sh`).
- After release, the board row asks #78 whether `squeal hold -- npm run test:e2e -- <file>` is enough.
