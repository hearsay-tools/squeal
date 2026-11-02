# Research: runner-trigger (019-01)

Topic `runner-trigger` of `README.md`: can a project choose, per runner, whether its tests run after each edit or only at Stop, and what would that mean. Source read at commit `6c5615a55` (Squeal 0.1.393). Experiments ran the worktree's committed plugin build, 0.1.393, in fixture repositories under `$TMPDIR` on 2026-11-02, with `HOME` and `XDG_RUNTIME_DIR` under `$TMPDIR`, so the fixture daemon took no slow-slot permit from the host's worktrees. Host load during the probe: 26 to 30 on 24 CPUs, above the CPU count, so no timing was measured. Transcript: `probes/runner-trigger/run.log`.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Do today's keys give "runner A after each edit, runner B at Stop only"? | Mostly. B's whole glob in `slow.include` (or `slow: true` on its `nodeTest`/`pytest` entry) with `slow.trigger: "idle"` runs B only when the agent pauses, and `stop.requireSlowSuite` makes Stop wait for B or hold once. Five gaps: the trigger is one key for every slow file, so a real e2e tier cannot stay continuous beside a stop-only runner; B gets the slow tier's load guard, per-user slot, `nice` 10 and `slow.maxWorkers`; the primer still says B runs "after each edit"; every text calls B's files "slow"; and under host load the run at a pause can be deferred until the next turn begins. | verified by experiment, read in source code |
| 2 | The unit | Per runner is too coarse: this repository has one runner, and cezarion has 91% of its runner time outside checkpoints in one runner (Vitest, slow tier included). The units Squeal already names are the slow-marking units: a glob (`slow.include`), a `nodeTest` or `pytest` entry (`slow`), and for Vitest a project name (`vitest.excludeProjects` already uses it). A per-group trigger over those units covers the three cases. | read in source code, inferred |
| 3 | Meaning of "stop only" | Two readings. Run at a pause, Stop silent: this is `"idle"` today, and the result reaches the agent through the idle waiter or the next prompt. Stop waits for it: this is `stop.requireSlowSuite` today, bounded by `stop.slowWaitMs` (see `stop-wait`). Between pauses an old result shows as "Earlier failures: pending rerun", never counted in "Known failures"; principle 2 holds. "Including slow tests" is ambiguous and is a question for the human. | verified by experiment, read in spec |
| 4 | Prior art | Vitest and Jest set watch for the whole tool only (per-project watch is refused). Tools that schedule many suites set the moment per named group: Wallaby per project, JetBrains per run configuration, VS Code per run profile, Bazel per size class at invocation, pre-commit and lefthook per hook with a default and a manual stage. Vitest also turns its own watch off when it detects an agent. | read in official docs |
| 5 | Cost | cezarion, 7 days: node:test runner time outside checkpoints is 45.8 k of 530 k runner-seconds (8.6%); Vitest unit projects 383 k (72%); the e2e slow tier 101 k (19%). Making node:test stop-only saves at most 8.6% of that time and moves 254 of its distinct failures from mid-turn to a pause. This repository: one runner, so no gain per runner; only a glob unit could save anything. | verified by experiment (read-only store queries), inferred |

## Findings

### 1. What exists (verified by experiment, read in source code)

Fixture: Vitest for `test/**/*.test.ts`, node:test project `node` for `node/**/*.test.mjs`, both importing `src/math.js`. Config `{"nodeTest":[{"name":"node","include":["node/**/*.test.mjs"]}],"slow":{"include":["node/**/*.test.mjs"],"trigger":"idle"}}`. A fake Claude Code session drove the plugin's hook entries (`probes/runner-trigger/hook.sh`).

- After an edit in a turn, Vitest ran at once; the node:test file stayed queued. The header: `Slow tier: 1 test file; 1 pending, waiting for the agent to pause. Squeal runs them when the agent pauses` (run.log B4). `status --wait 60000 src/math.js` returned on Vitest alone: `1 slow test file waits for a pause or \`squeal run --slow\`, which this wait does not hold for` (B3).
- A silent Stop ran it: `Slow tier: 1 test file; 1 current at revision 1` (C2).
- The primer (A1) says `Squeal runs this repository's Vitest and node:test tests in the background after each edit`, then `Slow test files run between your turns`. The first sentence is false for the node:test runner under this config; the second is true. The coverage clause says `node:test project "node" (node/**/*.test.mjs), with 1 slow test file`: nothing tells the agent that a whole runner waits for a pause.
- Under load (1.09 per CPU, above `slow.maxLoadPerCpu` 1.0) the run at a pause did not start: `1 pending, waiting for host load to drop` (D3). When the next prompt started a turn the line went back to `waiting for the agent to pause` (D6), and no run had happened. The guard budget (`slow.maxDeferMs`, 600000) is kept across the pass (`SlowTier.#budgetMs`, `src/core/scheduler/slow-tier.ts`), so the file runs at a later pause once the budget is spent; on a busy host with short pauses a stop-only runner can go several turns without a result. `squeal run --slow --wait` skipped the guard and ran it (E1).
- `nodeTest[].slow: true` gives the same tier (fixture 2, F3: `node (1 files): node:test project node; declared slow`).
- With `stop.requireSlowSuite: true` the primer and the `Slow tier:` line say `Stop waits up to 2 min for them or holds the agent once` (F2), and the 2 s Stop entry blocked at once, since this worktree had no `stop-wait:` row yet (F4; spec 004 D9). The wait itself belongs to `stop-wait`.
- The slow tier carries machinery made for minute-long suites (004 D2, D3, D10): a per-user slot of `slow.maxParallel` permits shared by every worktree, the load guard, `nice` 10 and `ionice -c 3`, `slow.maxWorkers` (default 2) inside the file, one node:test project per tier, and a second Vitest instance closed 60 s after its last run. cezarion sets `slow.maxParallel: 1` and `slow.maxWorkers: 1` for its browser specs. A cheap runner put into that tier would queue behind every worktree's browser specs for one permit.
- `slow.trigger` is read in two places: the scheduler (`policyTriggered`, `src/core/scheduler/slow-trigger.ts`) and the lint pass for stale whole-program files (`lintIdleIn`, `src/core/lint/pass/idle.ts`, spec 017 D5). One repository-wide key decides both.

So the combination exists, but a repository that wants its e2e tier continuous (the default since 004-79) and one runner at the pause cannot have both.

### 2. The unit (read in source code, inferred)

The config shapes at `6c5615a55`: Vitest is one runner whose projects come from the project's own Vitest config; Squeal names them only in `vitest.excludeProjects` and files in `vitest.exclude` (`policy.ts`). `nodeTest` and `pytest` are lists of named entries, each with `include`, `exclude` and `slow` (`policy-node-test.ts`, `policy-pytest.ts`). Lint (017) is per tool (`lint.tools`) and already splits its own run moment: edited files at once, stale whole-program files at the slow trigger (017 D5).

| Case | Example | Unit that fits |
|---|---|---|
| A slow e2e project | cezarion's `e2e` Vitest project (`packages/web/e2e/*.e2e.ts`) | a Vitest project or a glob; today a glob |
| An expensive runner | a pytest suite in a Node repository; cezarion's `root:test:unit` re-runs on most edits through broad declared inputs (`packages/**`) | a `nodeTest`/`pytest` entry |
| Tests on shared state | fixed ports, a shared database | the glob or entry, plus `slow.maxParallel: 1` as today (004 D10) |

"Per runner" (`vitest`, `nodeTest`, `pytest`) would give this repository nothing and would force cezarion to choose for 91% of that time at once. The slow-marking units already cover each case; what they lack is their own trigger.

### 3. Meaning of "stop only" (verified by experiment, read in spec)

- **Run at a pause, Stop silent.** This is `slow.trigger: "idle"`. In an interactive Claude Code session the idle waiter wakes the agent with a failure; in Codex and `-p` sessions it arrives with the next prompt (004 D9). Verified: the failure from the pause run arrived in the next `UserPromptSubmit` as `PASS -> FAIL, seen by Squeal's run at revision 3` (E2). The agent may already have said "done" by then.
- **Stop waits for it.** This is `stop.requireSlowSuite`, with `stop.slowWaitMs` capped at 600000; what that bound leaves out is `stop-wait`'s topic.
- **"Including slow tests."** Two readings: that the stop-only runner's slow files run at Stop too (today they already would: the slow tier runs at a pause under `"idle"`), or that "stop only" is the moment at which every slow test runs. Not determined from the human's words.
- **Between Stops.** After an edit that re-keys a file whose last result failed, status shows `Known failures: 0; not current: 1 of 2 test files`, then `Earlier failures: 1 pending rerun ... observed at revision 3, pending` (E3), and `status <path>` exits 3 with `Named test files have no verdict at revision 3` (D8). The old result never poses as current. Risk: an agent that reads only the first line sees `Known failures: 0`; spec 004 D8 already words the `Slow tier:` line per policy for that reason.
- **Texts.** The `Slow tier:` line, `status --wait` and the primer have wording for files that wait for a pause (`Squeal runs them when the agent pauses`, `waits for a pause or \`squeal run --slow\``). What is missing is a per-group version: the primer's "after each edit" sentence names every runner, and every text says "slow" for a group the project did not call slow.

### 4. Prior art (read in official docs)

Retrieved 2026-11-03 with `curl` from the official pages named (WebFetch refused the domains); quotes are verbatim.

- **Wallaby.js** (wallabyjs.com/docs/intro/vs-code/; `intro/run-mode.html` returned 404). Run modes "Automatic: Wallaby runs tests as you type" and "On Save: Wallaby only runs tests when you save a file"; "Run Mode settings are stored per project"; Smart Start can "run on edit (instead of open), or ... never run automatically". Reusable: the run moment is a per-project setting with a never-automatic option and explicit run commands, which is Squeal's `squeal run --slow` beside a trigger.
- **Vitest** (vitest.dev, pages for 5.1.0). `watch` reruns on change, default "`!process.env.CI && process.stdin.isTTY`, and false when Vitest detects an AI coding agent"; `watch`, `forceRerunTriggers` and `watchTriggerPatterns` are "only available in the top level config. You cannot specify it as an option of a test project". `vitest related` and `--changed` run on demand. Reusable: none per project; the runner itself offers no per-project run moment, so Squeal would own the choice. Vitest turns its own watch off for agents.
- **Jest** (jestjs.io, 30.5). `--watch` "rerun tests related to changed files", `--onlyChanged` for on-demand; `watch` is among the options that "only take effect at the root (global) config level and are ignored when set inside a project config". Same lesson as Vitest.
- **pytest-testmon** (testmon.org). "selects and executes only tests you need to run", on demand; "If you want to run your tests on every file save we recommend using testmon with pytest-watch"; "Testmon always re-executes tests which failed last time". Reusable: selection and run moment are separate tools; failing tests re-run first (Squeal's principle 4 already does this).
- **JetBrains IDEs** (jetbrains.com/help/idea/performing-tests.html, 2026-10-01). "Rerun Automatically": tests of "the current run configuration" restart "after you change the related source code"; a chosen configuration can run "every time you make a commit". Reusable: the unit is a named run configuration, and one configuration can be on-change while another is at-commit.
- **VS Code Testing** (code.visualstudio.com API reference, updated 2026-10-28). `TestRunProfile.supportsContinuousRun`: "Whether this profile supports continuous running"; with it "the profile should observe changes to source code and create new test runs". The user guide pages do not describe how a user turns it on. Reusable: continuous running is a property of a run profile, one profile per kind of run.
- **Bazel** (bazel.build test encyclopedia, common definitions, command-line reference). `size` per target implies a timeout ("small→short 60 s ... enormous→eternal 3600 s"); `--test_size_filters` and `--test_tag_filters` select classes per invocation; `manual` excludes a target from wildcards. No watch mode. Reusable: the class is declared per target and the moment is chosen by whoever invokes, which is the split between `slow.include` (class) and a trigger (moment).
- **pre-commit** (pre-commit.com, 3.2.0+). `stages` per hook with `default_stages` as "a configuration-wide default ... will only override individual hooks that do not set stages"; "The manual stage ... will not be automatically triggered by any git hook ... run on demand using `pre-commit run --hook-stage manual`". Reusable: a per-item moment with a repository default and a manual moment is the closest shape to the request.
- **lefthook** (lefthook.dev). Jobs are grouped under a hook; "You can specify any Git hook or your own custom, e.g. test", run with `lefthook run <hook>`. Reusable: named groups whose moment is the group's name.

Pattern: the in-process watchers (Vitest, Jest) set the run moment for the whole tool; the tools that schedule many suites (Wallaby per project, JetBrains per run configuration, VS Code per profile, Bazel per target class, pre-commit and lefthook per hook) set it per named group, with a default and an on-demand moment.

### 5. Cost (verified by experiment on store history, inferred)

Read-only queries on each store at 2026-11-02 23:01 UTC, over the last 7 days (`probes/runner-trigger/aggregate.mjs`, output in `cezar-aggregate.txt` and `squeal-aggregate.txt`). "Runner-seconds" is the sum of each run's wall time; runs overlap, and CPU is higher by the workers per run, so this is a share, not a CPU measure. "Outside checkpoints" includes edits, baselines and retries; the store does not tell them apart.

cezarion (`~/projects/cezar`, 41 905 runs):

| Runner | Projects | Runs outside checkpoints | Runner-seconds | Share |
|---|---|---|---|---|
| Vitest, unit | server, web, contract, api-client (and mixed tiers) | 8 687 | 383.8 k | 72% |
| Vitest, slow tier | e2e (continuous) | 5 713 | 100.6 k | 19% |
| node:test | root:test:unit, test:unit | 12 087 | 45.8 k | 8.6% |

Distinct failing results in the store, 7 days (the `results` table keeps one row per check and key, so a failure repeated at one key counts once): Vitest unit 4 119, node:test 254 (`root:test:unit` 196 in 23 worktrees, `test:unit` 58), e2e 19. So a stop-only node:test runner saves at most 8.6% of the runner time and moves about 254 failures a week from the next tool call to the next pause. A stop-only Vitest `server` project would save about 62% and move most failures, which defeats the product's promise (principle 3: feedback beside the work).

This repository: one Vitest runner, 5 808 runs and 190 k runner-seconds outside checkpoints in 7 days, 992 distinct failures. A per-runner choice gives nothing here; only a glob could.

`squeal ps` at the time: 17 daemons, Squeal at least 14.3 CPUs, 84% of the host's busy CPU, at load 27 on 24 CPUs. At that load the slow tier's guard defers every run at a pause (finding 1), so a stop-only runner on the slow tier would mostly run when its 600 s budget is spent. The delay from an edit to the next pause was not measured: the host load was above the CPU count, and the store does not record turn ends.

## Recommendation for Squeal

1. The item is about half handled: `slow.include` (or `slow: true`) with `slow.trigger: "idle"` gives "this runner at the pause only", and `stop.requireSlowSuite` makes Stop wait for it. It is not handled for a repository that also has a real slow tier it wants continuous, and it brings the slow tier's guard and slot to tests that are not slow.
2. If the spec goes ahead, the unit is the slow-marking group already in the config (a `slow.include` glob, a `nodeTest`/`pytest` entry, and a Vitest project name), not the runner. The run moment then belongs to the group: after each edit, after the fast tests (today's continuous), or at the pause.
3. A group at the pause needs its own texts: the primer must stop saying "after each edit" for it, and its line must not say "slow" for files the project did not call slow. The pending-rerun wording of earlier failures can stay; it already keeps principle 2.
4. Whether a group at the pause takes the slow tier's load guard and per-user slot is a decision, not a finding: they protect the host from minute-long suites and delay cheap ones by up to `slow.maxDeferMs`.
5. Stop waiting for such a group is `stop-wait`'s question; this topic adds only that the wait must cover every group at the pause, not only the slow tier.

## Open questions for the human

1. "Stop only": should Stop wait for these tests (the agent cannot finish before they pass or the bound passes), or only run them when the agent pauses (the result arrives with the next prompt)?
2. "Including slow tests": do you mean that a runner at Stop also has its slow tests run at Stop, or that Stop is when all slow tests run?
3. For a cheap runner set to Stop only, should Squeal still hold its run back when the machine is busy (today up to 10 minutes) and share one run slot per user across worktrees, as for e2e suites?
4. Which case started the request: a slow e2e project, an expensive runner, or tests that touch shared state? Each fits a different unit (finding 2).

## Sources

- Squeal at `6c5615a55`: `src/core/daemon/policy.ts`, `policy-slow.ts`, `policy-node-test.ts`, `policy-pytest.ts`, `policy-lint.ts`; `src/core/scheduler/slow-trigger.ts`, `slow-tier.ts`; `src/core/lint/pass/idle.ts`; `src/harness/claude-code/input.ts`, `run.ts`.
- Specs: 004 D1, D2, D3, D7, D8, D9, D10 (`docs/specifications/004-slow-suites/spec.md`); 017 D5 (`docs/specifications/017-lint-checks/spec.md`); vision principles 2 and 3 (`docs/vision.md`).
- Configs: this repository's `squeal.config.json`; cezarion's `~/projects/cezar/squeal.config.json` and `vitest.config.ts` at `e03d62149`.
- Stores, read-only: `~/projects/cezar/.git/squeal/store.sqlite`, `~/projects/squeal/.git/squeal/store.sqlite`, tables `runs`, `results`, `checks`.
- Probes: `probes/runner-trigger/` (`make-fixture.sh`, `hook.sh`, `aggregate.mjs`, `sample.mjs`, `run.log`, `*-aggregate.txt`).
- Sibling topics: `stop-wait` for Stop's wait and its bounds; `commit-checkpoint` not used.
- Prior art, retrieved 2026-11-03: https://wallabyjs.com/docs/intro/vs-code/ ; https://vitest.dev/guide/cli.html , https://vitest.dev/config/watch.html , https://vitest.dev/config/forcereruntriggers.html , https://vitest.dev/config/watchtriggerpatterns.html , https://vitest.dev/guide/projects.html ; https://jestjs.io/docs/cli , https://jestjs.io/docs/configuration ; https://testmon.org/ ; https://www.jetbrains.com/help/idea/performing-tests.html ; https://code.visualstudio.com/api/references/vscode-api (TestRunProfile) ; https://bazel.build/reference/test-encyclopedia , https://bazel.build/reference/be/common-definitions , https://bazel.build/reference/command-line-reference ; https://pre-commit.com/ ; https://lefthook.dev/configuration/Hook/
