# Research: slow-suite-policy

Board row 004-01. Brief: `README.md`, topic `slow-suite-policy`. Examined: Squeal at `25580c8` (0.1.30) with Vitest 5.0.3; cezarion at `13351da` (0.15.1, `packages/cezar`); Node 24.21.0; Linux x64, 24 cores. The host was never calm: the 1-minute load stayed between 5 and 35 through every measurement (other workers' suites), so every duration below carries the load it was taken at. Probes: `probes/slow-suite-policy/` (throwaway, against copies under one `/tmp/r004-01-*` directory, removed afterwards).

## Questions answered

| # | Question | Answer |
| --- | --- | --- |
| 1 | Prior art | Every tool marks slowness by a declared, file- or target-level label (Bazel `size`, Wallaby `smartStart` patterns, Vitest/Jest projects) and selects by a graph of declared inputs (Bazel, Nx, Turborepo). Per-test tags exist (Vitest 4.1+) but filter after the file is imported. None infers "slow" from measured time; Bazel and Wallaby measure time only to warn. |
| 2 | Marking | A glob in `squeal.config.json` (or a whole `nodeTest` project) fits both repositories with no upkeep. A duration threshold does not: in both repositories files outside the e2e suites are slower than files inside them, and between two runs 12 of 191 files changed side of a 10 s threshold. Tags do not match Squeal's per-file unit. |
| 3 | Triggers | No harness moment can wait minutes: Stop has 2 s, `stop.waitMs` caps at 1.5 s. A commit fires no hook and makes no revision. The moments that do not block: the consumer going idle (silent Stop), an explicit `run --all` or `run --slow`, `status --wait`. A quiet timer mid-turn blocks the next edit's own test for up to one slow file (64 s measured), since D5 never cancels a tier. |
| 4 | Affected selection | Both suites test a build artifact Squeal never builds (`plugins/*/dist`, `packages/cezar/dist`, `web/dist`). The static closure selects the wrong files in both; the closure that matches what runs is the artifact's, plus declared fixture inputs. Selection by sources through source maps saves about a third of cezarion's tier on average. |
| 5 | What the agent is told | A slow result must say what it ran against (the artifact and the revision), a pending slow tier must be a named state in the header and at Stop, and the closure line of D6 must not claim "none of the files changed here are in its imports" for a file keyed by an artifact. Proposed lines below. |

## Findings

### 1. Prior art

- **Bazel** (read in official docs, bazel.build test encyclopedia and command-line reference, current, no version shown). Each test target declares `size` (`small`, `medium`, `large`, `enormous`, default `medium`), which implies a `timeout` class (60, 300, 900, 3600 s) and an assumed peak resource use; "All combinations of `size` and `timeout` labels are legal". `--test_verbose_timeout_warnings` "will show the tests whose specified size is too big": measured time only warns, it never re-labels. `--cache_test_results=auto` reruns a test "if and only if" its inputs changed, it is `external`, `--runs_per_test` asks, or it "previously failed". The `--test_size_filters` and `--test_tag_filters` descriptions were not in the parts of the 726 KB reference that were fetched, so how Bazel filters by size is not determined here. Reuse: a declared class per target, its own timeout, and re-run only on changed inputs or a previous failure, which is 001 D5 already.
- **Nx** (read in official docs, nx.dev "affected", no version shown). Affected = files changed between `base` and `head`, mapped to projects, plus their dependants; a lockfile change marks all projects affected by default. Opt-in task-level selection (`NX_LEGACY_AFFECTED=false`) selects a task "when your change reaches one of its inputs" and warns that "Tasks that read most of a project, like `lint`, narrow very little". E2E is just another target; the page names no tiers. Reuse: per-task declared `inputs` decide selection, which is Squeal's `inputs` key.
- **Turborepo** (read in official docs, turborepo.dev `run` reference, 2.x). `--affected` is `--filter=...[main...HEAD]`, per package by default; `futureFlags.affectedUsingTaskInputs` filters "at the task level using each task's `inputs` globs". Reuse: same as Nx.
- **Jest 30.5** (read in official docs). `--selectProjects`/`--ignoreProjects` by `displayName`; `--onlyChanged` "requires a static dependency graph (ie. no dynamic requires)"; `--findRelatedTests`. **Vitest 5.0.3**: projects with `--project`, which takes `*` and `!` (`vitest --project '!e2e'`) (read in official docs). Test tags (`tags` in config with `timeout` and `retry` options, `@module-tag` per file, `--tags-filter`) arrived in 4.1.0 (read in official docs) and are in 5.0.3 (read in source code, `strictTags`, `tagsFilter` in `dist/`). Verified by experiment (`vitest-tags/`): with `--tags-filter '!slow'`, a file tagged `@module-tag slow` is still imported (its top-level side effect ran) and reported with its tests `skipped`; `--tags-filter slow` imports the untagged file too. Tags therefore save test time, not module or `beforeAll` cost, and a tag is per test while Squeal's key and scheduling unit is the test file (001 D3). Reuse: a project or a glob, not tags.
- **node:test** (read in official docs, Node v26.11.1 page; 22 and 24 not fetched). "Test name patterns do not change the set of files that the test runner executes"; `only` needs `--test-only` or disabled isolation; files come from globs. Reuse: the `nodeTest` project's `include` is already the slow suite's boundary (cezarion's `test:package` is one script with one glob).
- **Wallaby** (read in official docs, wallabyjs.com config overview and Smart Start). `slowTestThreshold` (default 75 ms) only flags slow tests in the UI. `smartStart` entries `{ startMode, pattern }` choose per test file glob: `open` (default), `edit`, `always`, `never` ("Never automatically run tests for the file"), first match wins. `runMode: onsave` delays runs to saves. Reuse: the closest prior art to Squeal's question. A glob decides when a file runs automatically; a measured time only labels.
- **CI pipelines** (read in source code). cezarion's CI (`.github/workflows/ci.yml`) runs `typecheck`, `test:unit`, then `npm run build`, then `test:package`: the e2e tier sits after a build because it tests the build. Squeal's CI runs `npx vitest run` (e2e included, against committed bundles), then `npm run build`, then fails if `plugins/claude-code/dist` drifts. Neither tiers by measured time.

### 2. Marking

Durations, verified by experiment, one run each unless noted.

| Suite | Per file (s), file at a time | Whole suite as its script runs it |
| --- | --- | --- |
| Squeal `test/e2e` (Vitest) | policy 66.0, lifecycle 54.7, worktrees 45.9, transitions 13.4, shipped-plugin 7.0, torn-status skipped (opt-in); 192.5 s total, load 18 to 35 | 69.6 s file-parallel at load 20, cold Vitest install cache (policy 64.4, lifecycle 40.5, worktrees 31.5, transitions 17.6, shipped-plugin 8.5); 59.6 s warm at load 17 to 13 (policy 58.5, lifecycle 36.2, worktrees 23.0, transitions 14.1, shipped-plugin 5.6) |
| cezarion `test:package` (node:test) | application-update 42.7, package-cli 28.8, task-cli 24.0, delegation 20.3, serve-port 13.9, release-snapshot 11.4, cockpit-ownership 8.9, release 8.6, inline-contract 1.5, stop-child 0.5, tick-writer 0.4, alias-bin-exports 0.3; 161 s sum, load 5 to 20 | 63.0 s at load 20 to 23 (Node's default concurrency runs all 12 at once) |

The same files outside the suites, at most 4 workers (verified by experiment): Squeal's other 191 Vitest files took p50 1.5 s, p90 11.5 s, p99 35.4 s at load 15 to 30; 22 files over 10 s, 9 over 20 s, led by `test/daemon/lifecycle.test.ts` 51.9 s and `test/scheduler/runner-work.test.ts` 41.7 s, both slower than the e2e `shipped-plugin` and `transitions`. cezarion's 10 `test:unit` files: `test-env-launcher` 47.5 s and `web-typecheck` 33.8 s (43.9 and 28.7 s on a second run), slower than 9 of its 12 e2e files. A second run of Squeal's 191 files at load 22 to 23: p50 0.9 s, p90 6.2 s, p99 33.2 s; per-file ratio to the first run p10 0.28, p50 0.74, p90 1.13. At a 10 s threshold, 22 files were over it in one run and 10 in the other, 12 changing side; at 20 s, 9 and 5, 4 changing; at 30 s, 6 and 3.

- A **duration threshold** marks a different set from the one the suites' authors drew, and a moving one: the same e2e files moved by up to half between runs at loads 13 to 35 (worktrees 23.0, 31.5 and 45.9 s; lifecycle 36.2, 40.5 and 54.7 s), and 12 of 191 other files changed side of a 10 s threshold between two runs of the same command (verified by experiment). A file near the threshold changes tier with the load. It also needs a first run before the file can be marked, so a new e2e file runs in the fast tier once. Duration already orders work inside a class (001 D5 step 4); as a marking it would only suggest (inferred).
- A **project** marking fits cezarion as it stands: `test:package` is already its own `nodeTest` entry by 003 D1 seeding, one entry per script. For Squeal it needs the Vitest config split into two projects, a change to the project's own configuration (read in source code, `vitest.config.ts` has one project with `include: ["test/**/*.test.ts", ...]`).
- A **glob** in Squeal's policy (`test/e2e/**/*.test.ts`; for cezarion the project's own `include`) fits both with no change to either repository's test configuration, and a new file under it is slow from its first run (inferred). It is the same shape as `inputs`' map from test-file glob, which 001 D11 already loads.

### 3. Triggers

- **Stop and SubagentStop** (read in official docs, code.claude.com hooks; 001 D9; 002 D3). Squeal's hooks run with `timeout: 2`; `stop.waitMs` is capped at 1,500 ms; under Codex any Stop news costs a continuation. Stop cannot wait for a 60 to 70 s tier. It can start one and record it as pending for the consumer: 001 D9 already records the files pending at a silent Stop and wakes the idle agent through `asyncRewake` when one lands, about 40 ms after, in interactive Claude Code only. Codex has no cheap wake (002 non-goal, `codex queue` is 1.5 to 7 s and costs a turn), and `-p` sessions arm no waiter, so there the result waits for the next prompt or for nobody.
- **`stop.requireFullSuite`** (read in source code, `src/harness/shared/stop.ts`, `src/core/state/header.ts`) blocks Stop until a full-suite checkpoint completed at the current revision and names `squeal run --all`. It is the only gate today; it does not distinguish tiers, so with slow files in the suite it forces a full slow run at every revision the agent stops at.
- **`run --all` and `status --wait`** (001 D5, D7): explicit, every harness, already in the primer. `status --wait` returns when nothing is pending at the current revision; with a slow tier pending it waits for it, bounded only by the agent's Bash timeout.
- **A commit** fires no hook (read in official docs: none of the hook events is git-specific; `PreToolUse` with `if: "Bash(git commit *)"` catches only the agent's own commits) and makes no revision: the daemon reads `HEAD` only when a content change makes a revision (read in source code, `src/core/daemon-loop/head.ts`; 001 D2 "A revision is never created by a touch or a no-op save"). A commit trigger needs a new watch on `HEAD` and the branch ref.
- **A quiet period** is daemon-only and harness-independent, but 001 D5 runs one tier at a time and "A tier in flight is never cancelled by a new revision", so an edit made while a slow tier runs waits for it: up to 64 to 66 s for Squeal's `policy.test.ts`, 42.7 s for cezarion's `application-update` (inferred from D5 and the measured durations; the cancel alternative is `slow-suite-runtime` question 3).
- **Today** Squeal already runs this repository's `test/e2e` as ordinary files on every revision their closure touches (read in source code, `squeal.config.json`; verified by experiment, `vitest-closure.ts`: editing `src/harness/claude-code/build.ts` selects all 6 e2e files). cezarion's `squeal.config.json` declares no `nodeTest`, so its `test:package` is not validated at all.

### 4. Affected selection

Verified by experiment, with Squeal's own graph code in the copies.

- **Squeal `test/e2e`** (Vitest adapter `closure()`): 65 to 78 paths per file, 57 to 65 of them under `src/` (the test helpers read the store through `src/core/store`, `keys`, `status`, and `build.ts` for `REPO_ROOT`), none under `plugins/`. `affected(["src/core/scheduler/batch.ts"])` selects 32 test files, no e2e file, though the bundle the e2e daemon runs contains that code; `affected(["src/harness/claude-code/build.ts"])` selects all 6. The code that runs is the committed `plugins/*/dist` (42 tracked files), reached only through the declared `inputs` (`plugins/claude-code/**`, `plugins/codex/**`), and until 002-24 lands, through `git archive HEAD`, which no key holds. The suite also reads `test/fixtures/e2e/**`, `test/fixtures/codex-hooks/**` and `test/harness/recorded/**` with `fs` (read in source code, `test/e2e/harness.ts:40`, `plugins.ts:64`), none declared, and installs Vitest from a cache outside the worktree. Over the last 305 commits, 100 touched `src/`, 95 of them without touching `plugins/`, 37 touched `plugins/` and 6 `test/e2e/`; 31 touched `lifecycle.test.ts`'s static closure.
- **cezarion `test:package`** (003 D3 graph builder, 169 ms for 12 files): static closures of 2 to 59 paths, 2 incomplete (`delegation`, `inline-contract`: computed `import()`). Observed with Squeal's recorder in `NODE_OPTIONS`, so every spawned Node records: 1 to 159 processes per file and 3 to 261 worktree paths, dominated by `packages/cezar/dist` (205 to 210 of its 230 `.js` files in 5 files). The static closure missed 195 to 212 paths in those 5 files. `package-cli` packs and installs a tarball under `/tmp` and runs it there, so its real inputs (`dist`, `web/dist`, `package.json`, `scripts`) are observed nowhere; it failed until `web/dist` was built.
- **Through the artifact back to sources**: the observed `dist` files' `.js.map` `sources` give 204 to 209 source files for those 5 files, 0 for 4 files, 2 for 2 (`dist-to-src.mjs`). Replaying cezarion's last 300 commits (`history-select.mjs`): 133 touched sources; 9 selected no slow file, none selected over 90% of the tier's time, and the selected share averaged 0.67, before counting `package-cli`, whose true inputs are all of `dist`.
- **What a key must hold** (inferred from the above and 002 lessons defect 5): the artifact the suite runs, not the sources it was built from. A source edit does not change what the e2e file runs until someone builds, and Squeal never builds (001 D11). Declared `inputs`: cezarion `packages/cezar/dist/**`, `packages/cezar/web/dist/**`, `packages/cezar/package.json`, `packages/cezar/scripts/**`; Squeal `plugins/claude-code/**`, `plugins/codex/**` (present), `test/fixtures/e2e/**`, `test/fixtures/codex-hooks/**`, `test/harness/recorded/**`. `dist` and `web/dist` are gitignored; 001 D2 watches gitignored files that appear in a known closure, so a declared input under them re-keys on a rebuild (read in spec, not run).

### 5. What the agent should be told

001 D6 already tags every failure with "Squeal's run saw it at revision N", D7 counts pending checks, and the header names the full-suite checkpoint. Three gaps (inferred, from D6, D7 and the findings above):

1. A slow file keyed by an artifact has a closure with few or no sources, so D6's line "none of the files changed here since this session started are in its imports" would be true and misleading after a source edit. The line for a slow file should name what it ran against.
2. A slow tier still running when the agent stops counts as `pending` like any file; nothing says it is minutes away or that `stop.waitMs` will not cover it.
3. A slow result older than the current revision is `stale` or, when its artifact did not change, `current`, which is honest about the artifact and silent about unbuilt sources.

Proposed wording, for the coordinator to weigh:

```text
Revision 42 (changed src/core/a.ts): 310 current, 0 pending, 0 stale, 0 unknown. Slow tier (test/e2e, 6 files): current for the build output at revision 37; sources changed since. Full-suite checkpoint: none completed at revision 42; last completed at revision 37.
Revision 42: ... Slow tier (test/e2e, 6 files): running since 09:41, about 70 s at its last run; not covered by Stop's wait.

FAIL  test/e2e/policy.test.ts > ...
      PASS -> FAIL, slow tier, Squeal's run saw it at revision 40, against plugins/claude-code/dist as of revision 40.
```

## Recommendation for Squeal

- **Marking**: a glob list in `squeal.config.json` (`slow: ["test/e2e/**/*.test.ts"]`, or `slow: true` on a `nodeTest` entry, which is its `include`). Cost: zero runs; one config line per repository. Measured duration stays an ordering input and at most a note naming fast-tier files over a bound (Squeal's 51.9 s `lifecycle`, cezarion's 47.5 s `test-env-launcher`).
- **Triggers**: the slow tier never runs between an edit and that edit's own tests. It runs when the fast tier has nothing pending at the current revision and the consumer is idle (a silent Stop records it as pending, so the idle waiter wakes the agent on a failure), on `run --all`, and on a new `run --slow`. `stop.requireFullSuite` counts it; a separate `stop.requireSlowSuite` is the coordinator's call. Measured cost per run: 60 to 70 s wall for Squeal's suite and 63 s for cezarion's at loads 13 to 23, 161 to 193 s file at a time.
- **Selection**: key slow files by the artifact they run (declared `inputs`, the observed closure across spawned processes as 003 D5 records it in-process), not by the sources; re-run on an artifact change, a fixture change or a previous failure. Source-map selection is an optimisation worth about a third of cezarion's tier, and none of Squeal's, whose bundles have no maps.
- **Reporting**: the three lines above; the primer's "Squeal does not cover ... other suites" changes for a repository that declares a slow tier.
- **Board rows a spec would need**: (a) policy key and loader for slow globs, tier membership in the scheduler; (b) the idle and explicit triggers, `run --slow`, Stop recording slow files as pending; (c) artifact-keyed closures: declared inputs plus the recorder in `NODE_OPTIONS` for node:test, with a note for a closure that reaches no artifact; (d) header, status and failure wording; (e) e2e tests of both repositories' shapes; (f) the `inputs` gaps above in this repository's `squeal.config.json`, as 002 lessons defect 5 did.

## Open questions

1. Interruption: whether a revision cancels a slow tier in flight (D5 never cancels) decides how costly the quiet-period trigger is. `slow-suite-runtime` question 3.
2. Should the slow tier run when sources are newer than the artifact, knowing it tests the old build? Running it is honest about the artifact; not running it saves a minute. Human or coordinator.
3. Codex and `-p` sessions have no idle wake, so a slow failure found after the turn reaches the agent only at its next prompt. Is that acceptable, or does the slow tier need Stop to block (a continuation) while it runs?
4. Calm-load numbers: none were possible on this host today (load 5 to 35). `slow-suite-runtime` question 2 owns the load log.
5. Real-session durations of this repository's e2e files are in its Squeal store, which this research did not read by rule.

## Sources

- Bazel test encyclopedia, https://bazel.build/reference/test-encyclopedia; command-line reference, https://bazel.build/reference/command-line-reference (fetched 2026-10-08).
- Nx affected, https://nx.dev/docs/features/ci-features/affected; Turborepo run reference, https://turborepo.dev/docs/reference/run.
- Jest CLI 30.5, https://jestjs.io/docs/cli; Vitest projects, https://vitest.dev/guide/projects; Vitest test tags, https://vitest.dev/guide/test-tags; `node_modules/vitest` 5.0.3 `dist/`.
- Node.js test runner, https://nodejs.org/api/test.html (v26.11.1 page).
- Wallaby configuration, https://wallabyjs.com/docs/config/overview.html; Smart Start, https://wallabyjs.com/docs/config/smart-start/.
- Claude Code hooks, https://code.claude.com/docs/en/hooks.
- Squeal at `25580c8`: `squeal.config.json`, `vitest.config.ts`, `.github/workflows/ci.yml`, `test/e2e/*.ts`, `src/harness/shared/stop.ts`, `src/core/state/header.ts`, `src/core/delivery/format.ts`, `src/core/daemon-loop/head.ts`, `src/runners/node-test/graph/`, `src/runners/node-test/runtime/recorder.cjs`, `src/runners/vitest/`.
- cezarion at `13351da`: `package.json`, `packages/cezar/package.json`, `packages/cezar/test/e2e/*.test.ts`, `scripts/test-git-env.mjs`, `scripts/test-changed.mjs`, `.github/workflows/ci.yml`.
- Specs: 001 D2, D3, D5, D6, D7, D9, D11; 002 D3, `lessons.md` defect 5; 003 D1, D3, D5; board rows 002-24, 003-18.
- Probes: `probes/slow-suite-policy/`.
