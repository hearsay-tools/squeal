# Research brief for spec 004: slow suites by policy

Read `docs/vision.md`, `docs/styleguide.md`, `../status.md`, spec 001 D5 (scheduler, tiers, checkpoints) and D11 (policy), spec 003 D1 and D5, and spec 002 D3 (Stop). Rules as in `../../003-node-test-runner/research/README.md`: findings tagged `verified by experiment`, `read in official docs`, `read in source code` or `inferred` with versions; throwaway probes under `research/probes/<topic>/` with a README; no product code; touch nothing outside this research folder. Probes run against copies under one `/tmp` directory of your own: never this repository's Squeal store, never `/home/agent/projects/cezar` itself (copy what you need), no CPU burners, never delete or kill what you did not start.

## Topic: slow-suite-policy

When should a slow suite run, and how does a project say which suites are slow?

1. Prior art: Bazel test `size` and `timeout` classes and `--test_size_filters`; Nx and Turborepo affected targets and their task tiers; Jest and Vitest projects and tags (`--project`, Vitest `tags`/`test.extend`); node:test `--test-name-pattern`, file globs, `only`; Wallaby's handling of slow tests; how CI pipelines tier unit, integration and e2e. One paragraph each with what Squeal can reuse.
2. Marking: by project (a Vitest project or a `nodeTest` entry flagged `slow`), by glob, by measured duration (a file whose runs exceed a threshold), or by tag. Measure this repository's `test/e2e` files and cezarion's `test:package` files (durations per file, at calm load) and say which marking fits both without manual upkeep.
3. Triggers: which harness moments can run a slow tier without blocking the agent: a quiet period after the last edit, Stop or the end of a turn, `squeal status --wait` or `run --all`, a commit, an explicit `squeal run --slow`, the idle waiter. What spec 001's `stop.requireFullSuite` and checkpoints already give, and what the Claude Code and Codex hooks allow (002 `lessons.md`, 001 D9).
4. Affected selection for slow suites: does the static or observed closure select e2e files usefully, or does every e2e file depend on everything (this repository's e2e builds the plugin; cezarion's spawns the CLI)? Measure the closures both runners compute for those files today and the declared `inputs` they would need.
5. What the agent should be told: a slow failure arriving minutes after the edit that caused it, a slow tier still running when the agent says done, a slow result older than the current revision. Read 001 D6 and D7 and propose the status lines and report wording that keep "push transitions, pull state" honest.

Recommendation: the marking, the triggers, the selection rule, the reporting, each with the measured cost, and the board rows a spec would need.

## Topic: slow-suite-runtime

How does a daemon run a suite that takes minutes, beside an agent and other worktrees, without lying and without starving the machine?

1. Resource use: CPU, memory and wall time of this repository's `test/e2e` and cezarion's `test:package` per file and in full, at calm load and beside a second copy; what `nice`, `ionice`, `taskset`, a cgroup (`systemd-run --user --scope -p CPUQuota=`) or Vitest/node:test concurrency limits change. Which of these work for an unprivileged daemon on this host (Linux) and which are portable to macOS.
2. A load guard: defer or throttle a slow tier when the load average or the agent's own test runs are high; measure how often this host's load stays above 4, 10, 25 over a working day if a log exists, else sample for an hour.
3. Interruption: a revision during a 3-minute run. Finish and store under the run's key, cancel and restart, or finish and mark stale. What spec 001 D5's per-check validity already implies; measure the cost of each on the suites above.
4. Isolation between worktrees: ports, `/tmp` paths, shared caches (`/tmp/squeal-e2e-cache`), daemons the suite starts, and the `git archive HEAD` pattern (board 002-24). What breaks when two worktrees run the same e2e suite at once; reproduce one collision.
5. Inheritance: when is a slow result from another worktree sound to inherit, given that slow suites read inputs outside their keys (installed plugins, `HEAD`, spawned binaries, network)? Propose a rule, for example inheriting only with a full closure plus declared inputs, or never.

Recommendation: the runtime model (scheduling class, guard, interruption rule, isolation requirements, inheritance rule), each with measured evidence.
