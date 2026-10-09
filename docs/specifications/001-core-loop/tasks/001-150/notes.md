# 001-150 notes: the Vitest adapter's runner part beside its run

The decision is in D5 ("What the Vitest adapter's calls exclude"). Seams, for whoever touches this next:

- `src/runners/vitest/gate.ts`: `Gate.run`, `Gate.part`, `Gate.exclusive`, and `Hold.exclusive` for a call that must replace the instance from inside a queue (it leaves its hold first; without that, a run and the runner part asking at once deadlock).
- `VitestAdapter.#instance(hold)`: every call gets its instance here; a missing instance or a stale observer policy is fixed under `exclusive`, then re-checked, since the other queue may have dropped the instance between the section and the re-entry.
- A run's broken or hung instance is dropped under `exclusive`, so a `closure` in flight never sees its server close.
- `#running` is true from a run's start to its own stale check; only then does `invalidate` check stamps before invalidating (one extra stat pass per runner-part `invalidate` during a run).
- `SourceStamps.#moved`: every `stale()` logs what it found moved, with the stamp's `loadedAt` (unknown files as +Infinity); the run's check (the call with `loadedSince`) adds those loaded since and empties the log. Conservative: a file that moved back before the run's check is still dropped.
- `stale()` no longer overwrites a stamp a concurrent load replaced while it hashed.
- `related.ts`: the walk compares `config.related` by identity after `getRelevantTestSpecifications`; a reset means fall back to `walkRelated` in `affected.ts` (same fallback as a transform error, without the `forceRerunTriggers` rule).
- `test/scheduler/helpers.ts`: `runnerPartBesideRun` now means the recorder adds no queue at all; the default recorder still models the old serialized adapter, which several scheduler tests rely on to hold the runner part behind a tier.

Not done: `src/core/daemon/composite-runner.ts` was not changed (its `Promise.all` fan-out no longer waits, since the Vitest part answers). `adapter.ts` is 365 lines, over the styleguide's ~300; the run body is the candidate to move out.
