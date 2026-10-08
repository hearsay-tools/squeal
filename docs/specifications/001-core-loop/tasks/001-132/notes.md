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

## Done-when 3: three full suites each way, and the cost per file

`ab.sh` alternated `ab.ts` off, on, off, on, off, on on one clone (Vitest's default pools, the recorder delivered as the daemon delivers it); `analyze.mjs` summarizes. Load is the 1-minute average at start and end of each run.

| Run | Wall | Summed file time | Load | Failing files |
| --- | --- | --- | --- | --- |
| off 1 | 618 s | 6,802 s | 25 -> 11 | `web` `github.test.tsx` |
| on 1 | 749 s | 11,319 s | 11 -> 6 | `github.test.tsx` and 9 `server` files (below) |
| off 2 | 619 s | 6,547 s | 6 -> 11 | `github.test.tsx` and 6 `server` files: `runs/ci-wait-store`, `runs/store-order`, `runs/store-transcript-facts`, `server/nonblocking-discovery`, `server/project-context-repo-handle`, `server/usage-scope` |
| on 2 | 555 s | 6,372 s | 11 -> 9 | `github.test.tsx` |
| off 3 | 529 s | 6,632 s | 9 -> 2 | `github.test.tsx` |
| on 3 | 508 s | 5,724 s | 2 -> 3 | `github.test.tsx` |

- `web` `packages/web/src/routes/github/github.test.tsx` fails in all six runs, so not the recorder's.
- Failing only with the recorder, each once, all in `on 1`: `application-update/service`, `artifacts/cli`, `autosave-timeout`, `ci-wait/process`, `discovery/cli`, `git-worktree-lock`, `server-install/platforms/ubuntu-vps`, `server/repo-branches-api`, `server/worktrees-api` (timeouts at 5 s and 15 s, a lock-wait race, a missing log under a dying watcher). `on 1` overlapped this worker's own `mock.ts` runs and Squeal's daemon re-running this repository's suite, hence its 11,319 s. Shown to be load: none fails in `on 2` or `on 3`, the nine pass three times out of three run alone with the recorder (`ab.ts ... <the nine>`: 14.2, 14.3, 14.4 s on; 14.1, 14.1, 15.6 s off; load 2 to 5), and `off 2` failed six other files without it.
- Cost per file, the median of each file's three durations on over its median off: p25 0.87, p50 0.97, p75 1.20, p90 1.50; the difference p50 -47 ms, p90 +722 ms. By project: `server` (398 files) p50 0.95, -95 ms, p90 +386 ms; `web` (233 files, jsdom, no spawns) p50 1.20, +150 ms, p90 +886 ms; `contract` 0.98; `api-client` 1.08. Load dominates `server`; `web` pays a fixed cost per file, the preload and resolve hook in each worker.
- Growth (`on 2`, `on 3` identical): 150 of 640 files observe paths beyond their snapshot, 1,719 distinct paths, 5,266 file-path pairs, per file p50 4, p90 54, max 787; 76 run a project script; `mock-cursor-print.mjs` is observed by 26 files. Before the closure filter, so a path also in a file's Vite graph counts (the research's 153 files and 1,092 paths were after it).

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
