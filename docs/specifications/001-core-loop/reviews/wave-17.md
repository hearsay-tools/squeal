# Wave 17 review: 001-432

Verdict: **FAIL**. One proven blocker, no should-fix items, no nits.

Candidate: `cand/0.1.201`, pinned to `f9c29e11071ab245fb5e4dc15a4aba283d8d5ebf`. Product range: `4bde168e..f9c29e11`, five commits. `git diff 8737cdc0 4bde168e -- src test` is empty. Reviewed W1 and W2 of `tasks/wave-17.md`, issue [#1](https://github.com/hearsay-tools/squeal/issues/1), spec 001 D8, D10 and D12, and `tasks/001-422/notes.md`. This review covers the first issue criterion; the other issue criteria are not claims of this wave.

## Verification

All primary checks ran at the pinned candidate with no tracked changes. `npm run build` left the tree clean. Probes ran in disposable exports outside the worktree; the final commit changes only this review.

`git rev-parse HEAD`:

```text
f9c29e11071ab245fb5e4dc15a4aba283d8d5ebf
```

`npm ci`, exit 0:

```text
added 196 packages, and audited 197 packages in 14s

32 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
```

npm also reported deprecated `node-domexception@1.0.0` and six install scripts not covered by `allowScripts`. No install policy changed.

`npm run lint`, exit 0:

```text
> squeal@0.1.201 lint
> biome check .

Checked 1361 files in 419ms. No fixes applied.
```

`npm run typecheck`, exit 0:

```text
> squeal@0.1.201 typecheck
> tsc --noEmit
```

`npm run build`, exit 0:

```text
> squeal@0.1.201 build
> tsc -p tsconfig.build.json && npm run build:plugin

> squeal@0.1.201 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
```

Independent full run, under the host turn, on Node 24.21.0:

```sh
flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
```

Exit 0. Verbatim output:

```text
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/06d98fea-7a9b-4ba6-a1c5-6a98f582f782

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/06d98fea-7a9b-4ba6-a1c5-6a98f582f782/test/fixtures/scheduler/.tmp/08f0fe57-f4a3-4669-a34b-c590e92d3386/main/.git/worktrees/staged/gitdir
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/06d98fea-7a9b-4ba6-a1c5-6a98f582f782/test/fixtures/scheduler/.tmp/72ccef4a-4ffb-4c10-bf7f-e5ffd98cb549/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 2662947
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  671 passed | 1 skipped (672)
      Tests  5688 passed | 10 skipped (5698)
   Start at  22:31:07
   Duration  844.09s (tests 98%, import 2%)

    Isolate  672 workers spawned · ~143ms startup each (spawn + environment, per file)
             at least ~23.88s faster with isolate: false — reuses workers across files instead of one per file
```

Sampled host load during the run ranged from 5.94 to 38.36. No test file failed in the loaded run, so none needed an alone rerun. The raw output includes fixture Git-repair diagnostics, Vitest notices, and cleanup of one process an earlier test run left; the run itself passed.

Squeal's separate baseline reported the two known daemon-only failures of row 001-431: `test/runners/vitest/observe-fidelity.test.ts:119` and `test/runners/node-test/run-reads-fidelity.test.ts:116`. This review uses the independent run above for its gate.

### Regression sensitivity

**Proven.** Exported `4bde168e` outside the worktree, overlaid the five new test files and `test/scheduler/helpers.ts`, and used the candidate's installed dependencies. Its source is identical to `8737cdc0`. Ran:

```sh
npx vitest run test/store/busy-slice.test.ts test/watcher/batch-retry.test.ts test/scheduler/busy-record.test.ts test/daemon/busy-edit.test.ts test/daemon/sliced-writes.test.ts --maxWorkers=1
```

Exit 1:

```text
Test Files  5 failed (5)
     Tests  7 failed (7)
  Duration  51.03s
```

The daemon regression fails on the actual behavior at line 126: `expected 29229 to be less than or equal to 1000`. The edit lands 29.229 s after the hold frees. The helper unit suites cannot load their new modules; the store and scheduler suites also meet absent exports. Those failures establish incompatibility with the old tree, not behavioral discrimination for every helper assertion.

To check the scheduler regression beyond its missing constructor, supplied only the candidate's `store/busy.ts` and its `BusyWaits` export to that disposable old tree. No scheduler, lifecycle, connection or watcher implementation changed. Its one test then fails behaviorally at line 56: `expected null not to be null`; the old scheduler's `idle()` resolves before the writer releases. It also reports the old bare scheduler-lock note's persistence failure. Exit 1, 4.30 s. The green side is the candidate run above.

## Blockers

### B1. An obsolete busy timer restarts a later non-busy stall

**Proven.** `src/core/scheduler/busy-resume.ts:39`, `:49`, and `src/core/scheduler/scheduler.ts:729`.

W2 requires: “the pump resumes after a busy error without spinning, and a non-busy stall still waits for the next batch”. The new callback always calls `#pump()`. Neither `BusyResume.landed()` nor the non-busy branch of `#stall` cancels or invalidates an outstanding busy timer.

Failure sequence:

1. A tier's record gives up busy and arms a resume timer.
2. Before that timer fires, a batch starts the pump. A successful selection calls `landed()`, which ends the wait but leaves the timer armed.
3. The resumed tier's record fails with a non-busy error. The scheduler notes that it stopped and clears `#asked`.
4. The old timer fires and calls `#pump()` anyway. It starts more tiers with no batch or request after the non-busy error.

A deterministic probe uses the real scheduler harness and runner. It defers only the busy-resume callback, injects one busy record error and then one non-busy record error, and delivers the saved callback after the latter stall. Before delivery there are two runs; after delivery there are four. No product source or bundle is patched. Deferring delivery controls the ordering rather than relying on a host's timing. This same outstanding timer can coexist with other in-flight tiers.

Command in a disposable export of `f9c29e11`:

```sh
npx vitest run test/scheduler/review-busy-stall.test.ts --maxWorkers=1
```

Exit 1:

```text
probe runs after obsolete busy timer 4
AssertionError: expected 4 to be 2 // Object.is equality
Test Files  1 failed (1)
     Tests  1 failed (1)
  Duration  3.90s
```

Worker-sized repair: invalidate the old busy wake when its wait succeeds and when a non-busy stall takes over, and make the callback check that it still owns the current busy wait. Do not permanently disable retries for a later busy episode. Add a controlled-order scheduler regression for this sequence and for a non-busy stall overtaking an unresolved busy wait. Keep the existing isolated busy-record regression green.

Reproducer, temporarily placed beside `test/scheduler/helpers.ts` in that export and removed after review:

```ts
import { expect, it, vi } from "vitest";
import { BusyWaits } from "../../src/core/store/index.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";
it("probe: an obsolete busy timer must not restart a later non-busy stall", SLOW, async () => {
  const {main, commonDir} = createRepo();
  const store = openRepoStore(commonDir);
  const h = await openHarness(main, store, commonDir, {
    busyWaits: new BusyWaits({now: Date.now, note: () => {}}), allowErrors: true,
  });
  await h.scheduler.start(); await h.scheduler.idle();
  const originalTimeout = globalThis.setTimeout;
  let resume: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms: number, ...args: unknown[]) => {
    if (new Error().stack?.includes("busy-resume.ts")) {
      resume = fn;
      timer = originalTimeout(() => {}, 60000);
      return timer;
    }
    return originalTimeout(fn, ms, ...args);
  }) as typeof setTimeout);
  let runs = 0;
  let armed: Error | null = null;
  const realTransaction = store.transaction.bind(store);
  store.transaction = ((fn: () => unknown) => {
    if (armed !== null) { const error = armed; armed = null; throw error; }
    return realTransaction(fn);
  }) as typeof store.transaction;
  h.gate.before = () => {
    runs++;
    if (runs === 1) armed = Object.assign(new Error("database is locked"), {errcode: 5});
    if (runs === 2) armed = new Error("probe non-busy record error");
  };
  try {
    h.write("src/math.ts", "export const add = (a: number, b: number) => a - b;\n");
    await h.batch("src/math.ts");
    await expect.poll(() => resume !== undefined, {timeout: 30000}).toBe(true);
    await h.batch("src/math.ts");
    await expect.poll(() => h.errors.some(e => e.message.includes("probe non-busy record error")), {timeout: 30000}).toBe(true);
    await new Promise(resolve => originalTimeout(resolve, 50));
    expect(runs).toBe(2);
    if (timer) clearTimeout(timer);
    resume?.();
    await new Promise(resolve => originalTimeout(resolve, 1000));
    console.log("probe runs after obsolete busy timer", runs);
    expect(runs).toBe(2);
  } finally {
    if (timer) clearTimeout(timer);
    spy.mockRestore();
    store.transaction = realTransaction;
  }
});
```

## Should-fix

None.

## Nits

None.

## What fits

- **Proven by source and tests:** connection overrides are synchronous around the lock-taking statement, restored in `finally`, and only shorten the connection's timeout. An async slice expires when its owner settles. Startup, desk writes, tier records, the awaiting-install baseline, and non-feed reconciliation paths retain their ordinary wait. The extra sliced prune is a lifecycle timer and is explicitly disclosed in W1's notes.
- **Proven by source and the daemon regression:** a write-lock refusal at `BEGIN IMMEDIATE` precedes revision/cache mutation. Feed retries serialize with later batches and reconcile current candidates. A successfully stored edit is then a no-op on reconciliation, so the retry neither loses that edit nor appends it again. The retry loop stops on close during a backoff; non-busy errors still reach the existing error callback.
- **Proven by source and helper tests:** lifecycle groups coalesce behind one retry, restart the whole heartbeat group, and stop with their timers. Busy waiters share one episode note, emitted when the final waiter ends. Non-busy timer errors retain their logging. The daemon test reads raw persisted notes, so its one-note assertion does not merely rely on topic deduplication.
- **Proven except B1's ordering:** a busy tier record requeues its files and resumes without another batch; a pending busy wake prevents false idle. Backoff is capped at 250 ms, with subsequent retries delayed rather than a synchronous spin. A lone non-busy stall keeps its previous note and next-batch behavior.
- **Proven by build and guard coverage:** version 0.1.201 is consistent across package/install/plugin metadata, and bundles rebuild without drift. Key format 11 is re-pinned under the task's explicit unreleased-version exception; no released key format is being changed in place.

## Inputs for the repair and re-review

Repair B1 in `BusyResume` and its scheduler caller. Preserve the separation between successful completion and abandoning a wait because another error took over; an abandoned wait must not claim that its write ran. Re-run the scheduler busy-record test, the new ordering regression, and the required candidate checks. Re-review the repair delta against B1.

The pump and tier records still use their 5 s wait, as W1 explicitly requires, so the 250 ms event-loop bound applies to feed passes and sliced timer writes. Runner-work retry, identifying the lock holder, and the remaining two issue criteria stay outside this wave. No claim is made that every daemon write is now bounded to 250 ms.
