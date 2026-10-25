# How many git-ignored paths tests load per run (016-19)

Researcher, 2026-10-25. Squeal at e5e432c81; cezar at e2882a245. Brief: `ignored-paths-brief.md`. It feeds `observed-paths.md` O1 (b): "the core keeps ignored observed paths as extra files for every runner". Probes: `probes/ignored-paths/` (throwaway).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Distinct ignored paths per run | Squeal Vitest: **49,302 file paths and 1,405 listings**, from 254 of 1,061 test files. All are under `test/fixtures/{scheduler,vitest,node-test}/.tmp/<uuid>/`. Cezar Vitest: **4** (stats only), from 11 of 838 files. Cezar node:test: **108** (stats only), from 2 of 68 files, in `.tmp-vitest-ga-<random>/`. Squeal has no node:test project. No ignored path was a module load in any suite. | verified by experiment |
| 2 | Growth over two runs with no edit | Squeal: **49,245 of 49,294 are new in run 2**. All 49,302 from run 1 are gone. Cezar Vitest: 1 of 4 is new, and all 4 are gone (they never existed). Cezar node:test: 108 of 108 are new, and all are gone. Under (b), `#extra` grows by about 49,000 paths per full squeal run. | verified by experiment |
| 3 | Which ones a verdict depends on | No path is shown to change a verdict. Squeal's 49,302 paths are the tests' own per-run scratch repositories. Cezar has 2 candidate absence probes: `packages/cezar/web/dist/index.html` (a build output) and `.agents/skills`. The tests that stat them do not assert on them. The rest are scratch paths that only add re-runs. | verified by experiment (paths); read in source code (meaning) |
| 4 | A bound that keeps the useful ones | Drop a path under a directory the same test file wrote, created or removed. This keeps **21 / 2 / 0** paths, and run 2 adds **0 / 0 / 0**. "Load only" keeps 0 / 0 / 0, but it loses the 2 cezar absence probes. "Exists after the run" keeps 0 / 0 / 0. A cap per test file keeps arbitrary paths and still grows. | verified by experiment (counts); inferred (choice) |

## Method

`make-recorder.mjs` copies the runtime-input recorder (`src/runners/observe/*.cjs`). The copy writes the same `f`, `l`, `r` and `w` keys, plus one sub-kind for each `f` path: `load` (the resolve hook), `read`, `stat` (stat, lstat, exists, access, realpath) or `exec` (an entry point, a spawn argument, a Worker script). Each suite ran in a scratch clone under `/tmp/ip-016-19`, with the recorder in `NODE_OPTIONS`, in the way `VitestObserver.start` delivers it. Each node:test file ran as its own `node --test`, with the recorder's `file` set to it.

`analyze.mjs` keeps only the run's own test files. It applies the filters of `observedInputs` (`src/runners/observe/inputs.ts`): it drops paths that file wrote, paths outside the root, `node_modules` and plain directories. Then it asks `git check-ignore -z --stdin`, the batch `checkIgnored` uses (`src/core/watcher/git.ts:66`). The closure is not subtracted. These counts are therefore the upper bound of what (b) would pass to `keys.track`, but scratch paths are never in a closure. A fixture check (`fixture-output.txt`) shows the four kinds and the dropped written path.

Limits:

- The clones have no developer state. The live cezar checkout holds ignored `.ai/cezar/`, `.ai/qa/**` and a built `packages/cezar/web/dist/index.html`.
- The recorder runs only in Node processes. Vite's main process reads and non-Node writes (git, shells) are not recorded.
- In Vitest workers, `load` sees only modules Node resolves natively. Inline sources come from Vite's module graph, which is the closure (inferred).

## Findings

### Q1. What the recorder sees in one full run

| Suite | Test files (with ignored) | Ignored file paths | read / stat / exec / load | Listings | Largest per file | Median (files with any) |
|---|---|---|---|---|---|---|
| squeal Vitest, 1,061 files | 254 | 49,302 | 11,472 / 43,746 / 32 / 0 | 1,405 | 3,661 | 141 |
| cezar Vitest, 838 files | 11 | 4 | 0 / 4 / 0 / 0 | 0 | 2 | 1 |
| cezar node:test, 68 files | 2 | 108 | 0 / 108 / 0 / 0 | 0 | 81 | 81 |

A path can have more than one kind, so the kind columns overlap. By top directory:

- **Squeal:** `test/fixtures/scheduler/.tmp` 34,559, `test/fixtures/vitest/.tmp` 13,989, `test/fixtures/node-test/.tmp` 754. Each fixture directory has its own `.gitignore` with `.tmp/`. By test directory: `test/scheduler` 27,675 paths, `test/runners` 13,268, `test/daemon` 8,561 and `test/integration` 4,008. By name: `.ts`, `.json`, `.ndjson`, `.snap`, `.yaml`, `.lock`, `.local` and `node_modules`. These are the files that in-process Squeal daemons and child runs hash, stat and probe in their scratch repositories. Example: `adapter-attribution.test.ts` writes `test/fixtures/node-test/.tmp/<uuid>/…` and runs node:test there. Node then stats the `package.json` files above each module, and the test never wrote those files.
- **Cezar Vitest:** `packages/cezar/web/dist/index.html` (8 server tests), `.agents/skills` (3 tests), `.ai/qa/node_modules` and `.ai/qa/unit-env-<random>/node_modules` (`test-task-env.test.ts`, from `mkdtempSync(join(repo, '.ai/qa/unit-env-'))`).
- **Cezar node:test:** Vite's config probes (`.env*`, `.postcssrc*`) inside `mkdtempSync(join(repoRoot, '.tmp-vitest-ga-'))`, from `vitest-actions-report.test.cjs` (81) and `node-floor-reporter.test.cjs` (27).

Cost: these times run from the first record to the last record, so they leave out start-up. Each wall time in `meta.txt` also includes the wait for the host's full-run lock.

| Run | Time | One-minute load |
|---|---|---|
| squeal full | about 1,230 s | 17.6 before, 27.5 after |
| cezar Vitest full | about 2,525 s | 22.1 when queued (start not recorded), 27.1 after |
| cezar node:test | 280 s | 22.7 before, 41.8 after |
| squeal subset, run 2 | 728 s | 23.8 before, 32.6 after |
| cezar subsets, run 2 | under 10 s | 20.7 when queued, 7.3 after |

Squeal's run 2 had one load-bound failure: `drain-wait.test.ts` missed its 120 s deadline. That file passed in run 1.

### Q2. Growth over two consecutive runs (no edit)

Run 2 re-ran only the files that had ignored paths in run 1: 254 squeal files and 11 cezar Vitest files. The other files had none. The cezar node:test run 2 re-ran its 2 such files. Source: `compare.mjs` and `compare-*.json`.

| Suite | Run 1 | Run 2 | New in run 2 | Run 1 paths gone | Union after 2 runs |
|---|---|---|---|---|---|
| squeal Vitest | 49,302 | 49,294 | 49,245 | 49,302 | 98,547 |
| cezar Vitest | 4 | 4 | 1 (`unit-env-jKZGTd`) | 4 | 5 |
| cezar node:test | 108 | 108 | 108 | 108 | 216 |

Squeal tracks 7,600 files and cezar 2,883 (`git ls-files`). The cost of each kept path under (b), as read in source code at e5e432c81:

- **The watcher.** `track` makes each kept path an extra file (`keying.ts:525-535`). Each tier that adds one calls `onExtraFiles`, which swaps the watcher. 011 measured each swap with its reconciliation at 0.3 to 0.6 s. Every reconciliation pass re-stats every extra file (`candidatesForReconcile`, `src/core/watcher/candidates.ts:130`). After one full run, squeal's extras would be 6.5 times its tracked files. After two runs they would be 13 times.
- **The store.** `observed.<project>` is "shared by every worktree of the repository, merged and never pruned" (`src/core/keys/observed.ts:16-21`). `setClosure` puts the observed paths back into closures (`keying.ts:367`), and `trackUntracked` tracks them again. Under (b), a new daemon in any worktree therefore starts with every scratch path ever seen. The note that `#extra` "only grows during a daemon's life" understates this cost (inferred).
- **Re-runs.** A scratch path is new in each run, so `firstHashedDuringRun` marks it `firstSeen` (`observed.ts:83-88`). `storeDecision` then stores nothing (`store-decision.ts:160`), and `rerunFirstSeen` re-runs the file until `MAX_DISCARDS = 3`, then marks it `unknown` (`ledger.ts:579-603`). In run 2, all 254 squeal files read at least one path run 1 lacked. Under (b) without a bound, these 254 squeal files and 3 cezar files would never store a result while `observe.runtimeInputs` is on (the default, `src/core/types/policy.ts:294`). That is inferred from source and was not run. Today `checkIgnored` drops these paths first (`observed.ts:66-73`).

### Q3. Verdict-relevant or re-runs only

- **Squeal, 49,302 paths: re-runs only (read in source code).** Each test builds its scratch repository from tracked fixtures under `test/fixtures/**`. `squeal.config.json` already declares these as inputs for the runner tests. The test removes the scratch afterwards (`rmSync(scratch)` in `afterAll`). 0 of the paths exist after the run.
- **The 21 stable squeal names** sit directly under `.tmp/`, for example `test/fixtures/vitest/.tmp/package.json`, `pnpm-workspace.yaml`, `bun.lock` and `.pnp.cjs`. They are workspace-root and lockfile probes that walk up from the scratch directories. All are absent. A file would appear there only by accident (inferred).
- **`packages/cezar/web/dist/index.html`** is a build output (`npm run build:web`). `server.ts:1402-1415` serves a build-hint page when it is missing, so 8 server tests behave differently in a checkout that has the build. It exists in the live cezar checkout. None of the 8 tests asserts on the hint page: grep finds `web/dist` only in `static-ui.test.ts`, which is not among them. So its absence can change behaviour, but no change of verdict was found (read in source code).
- **`.agents/skills`** holds the per-machine skills that `skills.ts` discovers. 3 tests stat the repository's copy, and none asserts on it (read in source code).
- **Cezar's `unit-env-*` and `.tmp-vitest-ga-*` paths: re-runs only.** They live in `mkdtemp` directories the tests create and remove.
- **No module load of an ignored path** was recorded in any suite. Neither repository has the 009 lessons observation 4 shape in its suite: a test that loads a git-ignored build output. Observation 4 itself, a file that fails before it resolves the import, records no read under any option (`observed-paths.md` Q3).

### Q4. Bounds and what each keeps

The table gives distinct ignored file paths kept in run 1, with the paths new in run 2 after the arrow. Sources: `bounds-growth.mjs` and `bounds-*.json`.

| Bound | squeal Vitest | cezar Vitest | cezar node:test | Keeps the cezar absence probes? |
|---|---|---|---|---|
| None, (b) as worded | 49,302 → +49,245 | 4 → +1 | 108 → +108 | yes |
| Kind `load` only | 0 → +0 | 0 → +0 | 0 → +0 | no |
| Exists after the run | 0 → +0 | 0 → +0 | 0 → +0 | no (yes in a checkout with the web build, for `index.html`) |
| Not under a directory the same file wrote, created or removed | 21 → +0 | 2 → +0 | 0 → +0 | yes |
| No random segment (a UUID or a `mkdtemp` suffix) | 49 → +0 | 3 → +0 | 0 → +0 | yes |
| Only files with at most 10 paths | 26 → +26 | 4 → +1 | 0 → +0 | yes |
| Only files with at most 100 paths | 4,546 → +4,533 | 4 → +1 | 108 → +108 | yes |

- The "written directory" bound uses the recorder's existing `w` set. Here it caught every `mkdtemp` directory, because the tests `rmSync` them, and `rm` is recorded as a write. `mkdtemp` itself is not wrapped (`fs.cjs` wrapper lists, read in source code). A `mkdtemp` directory that git or a shell removes would slip through.
- A cap keeps whichever paths a file happens to read, and it keeps growing.
- "Exists after the run" drops what (b) is for: an absence that a later build fills.

## Recommendation for Squeal

1. **Do not adopt (b) as worded.** On squeal's own suite it would add about 49,000 extra files per full run, none of them useful. They would persist in the shared observed set, be re-stat'ed by every reconciliation, and leave 254 files without a stored result (Q2).
2. If the human wants (b), take it with the **written-directory bound**: drop an ignored path that has an ancestor the same test file wrote, created or removed. Record `mkdtemp` as a create. Measured, this keeps 21, 2 and 0 paths, with no growth on a second run (Q4). That is about 23 fixed extra files across two repositories, plus one first-seen re-run each.
3. If the human wants the smallest rule, take **"load only"**. It keeps what node:test observes today, and here it keeps nothing. It loses absence probes such as cezar's `web/dist/index.html`. That probe changes behaviour but no verdict found here.
4. Measured on these two repositories, (a) loses nothing proven verdict-relevant (Q3). This is a count over two repositories, not a proof for others.

## Open questions

1. Do developer checkouts hold ignored state that tests read, beyond the clones? Examples are `.ai/cezar/`, `.ai/qa/` and installed `.agents/skills`. Not determined, because the clones lack that state and the live checkouts are out of bounds. Owner: whoever runs (b), on a copy of a real worktree.
2. Does any third-party repository have a test that loads a git-ignored build output once it exists (009 observation 4 after the build)? Not determined. Neither suite does. remeda, from 009, is the known candidate.
3. Is the `firstSeen` re-run loop in Q2 real? It is inferred from source and was not run under a daemon. A kit case for O1 should include a test that writes a fresh scratch path in each run.

## Sources

- Squeal at e5e432c81: `src/runners/observe/{recorder,fs,spawn}.cjs`, `inputs.ts`, `src/runners/vitest/observe.ts`, `src/core/scheduler/{observed,keying,store-decision,ledger,tiers}.ts`, `src/core/keys/observed.ts`, `src/core/watcher/{git,candidates}.ts` and `src/core/types/policy.ts`. Also `observed-paths.md` O1 and Q3, and 009 `lessons.md` observation 4.
- Cezar at e2882a245 (`/home/agent/projects/cezar`): `.gitignore`, `squeal.config.json`, `vitest.config.ts`, `packages/cezar/src/server/server.ts:1384-1415`, `packages/cezar/src/test-task-env.test.ts:81` and `.github/scripts/vitest-actions-report.test.cjs:34`.
- Probe outputs: `probes/ignored-paths/results-*.json`, `compare-*.json`, `bounds-*.json` and `fixture-output.txt`.
