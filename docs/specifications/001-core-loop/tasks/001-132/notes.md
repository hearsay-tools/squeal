# 001-132 notes: observed runtime inputs

Evidence for the board row's done-when, and the seams a later worker needs. Drivers here are evidence, not product code: `ab.ts` (one full suite through Squeal's Vitest adapter, recorder on or off, delivered as the daemon delivers it) and `mock.ts` (done-when 2 through the real scheduler, store and adapter, policy `baseline.onStart: "lookup-only"`, no `inputs`).

## Setup

- `cezar` cloned from `/home/agent/projects/cezar` and checked out at `1c97556a`, the research's commit: `scripts/mock-cursor-print.mjs` is not on `cezar`'s `main` (`13351da8` spawns `scripts/mock-cursor-acp.mjs` for cursor), so the brief's path exists only there. `npm ci`; Vitest 4.1.10; 640 test files in 4 projects (`server`, `contract`, `api-client`, `web`).
- Node 24.21.0, Linux, 24 cores, load 10 to 35 from other sessions throughout.

## Done-when 2: the mock edit, on `cezar`

`npx tsx mock.ts <clone> on`, a clean clone and store:

```
18.0s main started (lookup-only): 0 runs, parity key ce0bfcb1e950
35.9s first run: ran ["src/core/runner-shutdown-parity.test.ts"]; closure holds the mock: true
35.9s   observed scripts: packages/cezar/scripts/mock-claude.mjs, packages/cezar/scripts/mock-codex-app-server.mjs, packages/cezar/scripts/mock-cursor-print.mjs, packages/cezar/scripts/mock-omp-rpc.mjs, packages/cezar/scripts/mock-opencode-serve.mjs, packages/cezar/scripts/mock-pi-rpc.mjs, packages/cezar/scripts/pi-retry-degraded-service.mjs
35.9s   parity key 33e575770f3e, states ["pass/current/-"]
36.0s mock edited: parity key 33e575770f3e -> b1c14d42fde3
52.7s after the mock edit: ran ["src/core/runner-shutdown-parity.test.ts"] in 1 tier(s)
52.7s   states ["pass/current/-"] (first run 097651f2, mock-edit run 008dac1a)
67.8s old-mock worktree: parity key 33e575770f3e, states ["pass/current/-"], ran []
67.8s   mock in worktree equals main's: false
```

The first run is the parity test's only run before the edit: it is current under the key that holds the seven scripts it spawned (`33e5`), with no second run. The mock edit re-keys it (`b1c1`) and the next tier runs it. A second worktree with the old mock keys the file at `33e5`, the first run's key, so it can only inherit the result its own contents produced, never the mock-edit run's (`b1c1`).

The same with `off` (today's keys):

```
54.2s first run: ran ["src/core/runner-shutdown-parity.test.ts"]; closure holds the mock: false
54.3s mock edited: parity key 810508d9eca6 -> 810508d9eca6
56.4s after the mock edit: ran [] in 0 tier(s)
129.0s old-mock worktree: parity key 810508d9eca6, states ["pass/current/-"], ran []
```

The edit re-keys nothing and runs nothing, and the old-mock worktree shares the one key with the edited one: `lessons.md` defect 28.

## Defects found on the way

- The recorder skipped all of `tmpdir()`. This session's `TMPDIR` is an ancestor of the clone, so the first `cezar` run observed nothing. Now the temp directory is skipped only when the worktree is not inside it (`test/runners/vitest/observe.test.ts`, "inside the temp directory").
- Vitest copies `createVitest`'s `env` option into a root project's serialized config, so the per-instance observe directory moved the environment hash between worktrees (the node-test integration test's second worktree re-ran `vitest/sum.test.ts`). `canonicalConfig` leaves the recorder's env out. A config with `projects` (the research's `cezar` probe) does not show it.
- A Worker terminated at its message lost its last turn's paths (8 of 40 kept). The recorder now flushes before `MessagePort.postMessage` and `process.send`.

## Seams

- Recorder: `src/runners/observe/recorder.cjs`; settings in `SQUEAL_OBSERVE`; reader `read.ts`, filter `inputs.ts`, locator `runtime.ts` (candidates `../observe/`, `./observe/`, `./`).
- Vitest delivery: `src/runners/vitest/observe.ts` (`VitestObserver`), hooked into `adapter.ts` at `#start`, `#serial` (recreate when the policy moved), `environment()` (adapter version, `injected`), `run()` (`RunReport.observed`).
- Keys: `src/core/keys/observed.ts` (`ObservedSets` over `meta` `observed.<project>`, `Listings`, listing paths `dir/` and `./`); `assembleClosure`'s third argument; `WorktreeKeys` in `src/core/scheduler/keying.ts` (hash source for listings, `addObserved`, `rekeyListings`, the policy toggle in `setPolicy`).
- Scheduler: `src/core/scheduler/observed.ts` (`prepareObserved`, under the lock: ignored paths dropped, paths tracked, stability against the stat cache), `recordTier`'s `observed` argument in `tiers.ts`, listings in `Ledger.tierChanges` (`batch.ts`) and their re-key first in `rekeyContent` (`revision.ts`).
- node:test: `src/runners/node-test/` is untouched. Its runner keeps its own `nodeTest.observed.<project>` store; adopting the shared recorder and `RunReport.observed` is a spec 003 row.
