# 004 Slow suites by policy

Stage: approved 2026-10-08. Amendments: `status.md`. Research: `research/slow-suite-policy.md` (Opus), `research/slow-suite-runtime.md` (Astra), both measured on this shared Linux host at load 5 to 36, never at calm load. Specs 001 (D2 to D12), 002 and 003 hold unless a section here says otherwise.

## Problem

End-to-end and integration suites take about a minute: this repository's `test/e2e` 60 to 70 s in full and 7 to 66 s per file, cezarion's `test:package` 63 s and 0.3 to 42.7 s per file (load 13 to 23). Today Squeal treats them as ordinary test files. An edit that reaches one queues it beside the edit's own fast tests, so the agent waits a minute for a unit result; and since both suites test a build output their static closures cannot see (`plugins/*/dist` here, `packages/cezar/dist` in cezarion), an edit to the code inside that build often selects no e2e file at all, while an edit to a fixture or a bundle is invisible unless declared. Two worktrees running the same e2e suite at once collide on fixed ports (reproduced in cezarion on `::1:4321` and `127.0.0.1:4322`). A slow result inherited from another worktree can describe a build this worktree never had. The human named e2e tests as a blocker; the promise holds as for 003: only what is needed runs, only the delta reaches the agent, and no slow result poses as current for code it did not run against.

## Goals

Each goal is testable, on a repository shaped like this one (a Vitest e2e directory over a built plugin) and one shaped like cezarion (a node:test e2e project over a built package).

1. An edit never waits behind a slow file: the edit's fast tests run and report first, whatever slow files its closure reaches.
2. Slow files run when no edit's fast work is pending at the current revision and the consumer is idle, or on `squeal run --slow` or `run --all`; at most `slow.maxParallel` slow files run per user on the host at a time, at low priority, and a fast revision preempts the slow tier between tiers (amended 2026-10-09, D2).
3. A slow file re-runs when its keyed inputs change, declared artifact inputs included; a slow file whose keyed inputs changed during its run is discarded and queued again, never stored as current (001 D5).
4. A slow failure reaches the agent with its revision and what it ran against: through the idle waiter in an interactive Claude Code session, otherwise with the next prompt or tool call; Stop never waits for a slow tier.
5. A slow result is inherited from another worktree only when its key holds the artifact it tests (declared inputs, D5); otherwise it is never inherited.
6. Status and headers state the slow tier honestly: current against which revision's build, running since when, pending, or not run at this revision.
7. Under host pressure a slow file waits, up to a bound, then runs with a note; it is never skipped silently.
8. Squeal never builds anything: the slow tier runs against what is on disk and says so.

## Non-goals

- Building or refreshing the artifact a slow suite tests (vision: not a CI system).
- Cancelling a slow run on a revision (001 D5 never cancels; `research/slow-suite-runtime.md` 3 measured finish-and-revalidate as the bounded default).
- cgroup quotas (`systemd-run --user --scope -p CPUQuota=`): they work on this host, but not on macOS or in every container; a later opt-in.
- Fixing a project's fixed-port tests; Squeal's slot reduces their collisions between worktrees of one user, the project owns the rest.
- Marking by measured duration or by per-test tags: duration moves with load (12 of 191 files changed side of a 10 s bound between two runs) and some fast-tier files are slower than e2e files (51.9 s, 47.5 s); Vitest tags still import a tagged file and act per test, while Squeal schedules and keys whole files.

## Design

### D1. Marking

`squeal.config.json` gains a `slow` object whose `include` lists test-file globs (`"slow": { "include": ["test/e2e/**/*.test.ts"] }`), matched against every runner's test files, and a `nodeTest` entry gains `slow: true`, which marks every file its `include` lists. A file matched by `slow.include` is a slow file in every worktree; the 001 D11 loader rules apply (a glob matching no test file is one note). Measured duration stays an ordering input inside a tier (001 D5) and adds one note per project naming fast-tier files whose last run exceeded 30 s, so a human can decide to mark them.

### D2. The slow tier

Slow files form their own tier class in the scheduler (001 D5). The fast tiers run as today and never include a slow file. The slow tier is eligible only when no edit-caused fast work is pending or running at the current revision (the runner part, 001 D2, and recent files, 001 D5); background fast work (the baseline, an environment change, `run --all`) does not hold it back, and runs beside it in its own lane. It then runs one slow file at a time per worktree, in D5's order, and before each next file it checks again: a new revision with fast work, or a fast file pending, takes precedence and the slow tier resumes after it. When the machine is idle (no fast work pending or running in the worktree and the load per CPU below `slow.maxLoadPerCpu`, D3), a slow tier takes up to `slow.maxParallel` files (default 4) at once instead of one. A slow file in flight finishes (D4). Amended 2026-10-09 by the human after dogfooding (`lessons.md`: a 51-minute baseline held cezarion's slow tier back, defect 3, and one file at a time cost about 4x the files' parallel run time).

Triggers: (a) idle: a consumer of the worktree is idle (001 D9 turn state: a silent Stop) or no consumer is registered, which includes the end of a `codex exec` or `claude -p` session, whose daemon drains its pending slow files before it exits (001 D10 as amended, task 004-29); (b) `squeal run --slow`, new, which runs the slow tier now, still behind pending fast work; (c) `squeal run --all`, which includes slow files as today's full-suite checkpoint does. While a consumer is in a turn and no explicit trigger asked, slow files stay pending.

The slot: at most `slow.maxParallel` slow files at a time per user on the host (one permit per file), through lock files (`slow.lock` the first permit) in `squeal/` under the daemon's `XDG_RUNTIME_DIR` when it is set, as its socket follows it (001 D1), else in `/tmp/squeal-<uid>` (D10's per-user directory, 001 D10), held for one slow tier and released between tiers, so two worktrees' slow tiers interleave tier by tier; an idle tier of several files takes as many of `slow.maxParallel` permits per user as it has files. A daemon that cannot take the slot within its turn keeps its slow files pending and retries on the next scheduling pass. Each daemon uses up to its own repository's `slow.maxParallel` permits, numbered from `slow.lock`; with different values across repositories, the user-wide total is the largest value among the running daemons (review wave 4, S1).

Execution: a slow file runs in its own runner process, never in the instance that serves fast tiers: for Vitest a second instance created for the slow tier and closed when it drains, for node:test the same per-file spawn as 003 D5. It runs with `nice` 10 and, on Linux, `ionice -c 3` where permitted (`research/slow-suite-runtime.md` 1: the full e2e took 71 s plain and 84 s at low priority), and with runner concurrency `slow.maxWorkers` (default 2) inside the file. `runner.timeoutMs` applies per slow file.

### D3. Load guard

Before each slow file the daemon reads the 1-minute load average per CPU (`os.loadavg()[0] / os.availableParallelism()`). Above `slow.maxLoadPerCpu` (default 1.0) the file waits, rechecking every 15 s, at most `slow.maxDeferMs` (default 600000) per tier; past that it runs and the run carries one note saying it ran under load L. The guard is a hint, not proof of contention (`research/slow-suite-runtime.md` 2: on this 24-CPU host a raw threshold of 4 would defer most of a working day), so the bound is what makes it safe: a slow file is delayed, never skipped.

### D4. Interruption and stability

001 D5 holds unchanged for slow files: a revision does not cancel a run; when a slow file completes, its result is stored only if none of its keyed inputs changed on disk or in a revision during the run, else it is discarded and queued again; an install overlapping the run stores nothing (001-107, 001-113). Measured on a representative file each: finishing then retrying cost 14 s and 70 s, cancelling then retrying 10 s and 43 s (`research/slow-suite-runtime.md` 3); finishing is kept because it needs no process-tree cleanup on every edit and keeps one rule for every tier. A slow tier yields between tiers (D2), so the cost of discarded slow runs is bounded by one tier: one file, or up to `slow.maxParallel` files when the tier started idle.

### D5. Keys: what a slow file ran against

A slow file is keyed as any file (001 D3, 003 D3) plus its declared `inputs`, which for slow files must name the artifact it tests: `"test/e2e/**/*.test.ts": ["plugins/**"]` here, `"packages/cezar/test/e2e/**": ["packages/cezar/dist/**"]` in cezarion. A slow file whose key holds no path outside its own test directory and fixtures gets one note per project: its closure reaches no artifact, so a change to the code it tests will not re-run it; declare the build output in `inputs`. For a slow node:test project the recorder is also placed in the child's `NODE_OPTIONS` (003 D5), so processes the test spawns, such as the package's CLI, are observed and their loads join the file's observed closure (003 D3); for fast projects nothing changes. A Vitest slow file relies on declared inputs.

Squeal never builds (goal 8). When the artifact is a declared input and the sources behind it changed without a rebuild, the slow result stays current for the artifact, and D8 says the sources are newer.

### D6. Inheritance

A slow result is inherited from another worktree only when its key holds the artifact it tests: its declared `inputs` (D5) match at least one existing file that is neither a test file nor under a directory a slow glob covers, such as `plugins/**` here or `packages/cezar/dist/**` in cezarion. Otherwise it is never inherited, and D5's note says why. Slow suites read inputs outside any closure: installed plugins, `HEAD`, spawned binaries, ports, network (`research/slow-suite-runtime.md` 5 reproduced a changed CLI with unchanged worktree bytes), and every v1 closure is `complete: false`, so completeness cannot be the signal; a declared artifact puts the build's bytes in the key, which is what makes another worktree's result sound for it. A worktree reuses its own slow results under their keys as for any file. Decided by the human 2026-10-08.

### D7. Policy

New keys, all optional, 001 D11 loader rules, grouped as the existing `stop`, `runner`, `daemon` and `store` keys are: `slow.include` (globs, default `[]`), `slow.maxWorkers` (2), `slow.maxLoadPerCpu` (1.0), `slow.maxDeferMs` (600000), `slow.maxParallel` (4, the most slow files at once when the machine is idle; added 2026-10-09), `nodeTest[].slow` (default `false`), and `stop.requireSlowSuite` (`false`): when true, a main agent's Stop blocks, as `stop.requireFullSuite` does, while a slow file is not current at this revision, naming the slow files and that `squeal run --slow` runs them. No key controls inheritance (D6).

### D8. What the agent and the human are told

The header and `squeal status` gain one slow-tier line when the repository declares a slow tier: its file count; its state: current against the build output at revision N (with "sources changed since" when a source file in the worktree changed after N and the artifact did not), running since HH:MM with the last run's duration, pending (waiting for idle, for the slot, or for load), or not run at this revision; and "not covered by Stop's wait". The full-suite checkpoint (001 D7) includes the slow files. A slow failure's provenance line reads "slow tier, Squeal's run saw it at revision N, against <declared artifact> as of revision N" instead of 001 D6's attribution line about the session's changes, which would be true and misleading for a closure with few sources (`research/slow-suite-policy.md` 5). The primer (001 D9, 002) drops "Squeal does not cover ... other suites" for a repository with a slow tier and says slow suites run when the agent pauses or on `squeal run --slow`.

### D9. Stop and the idle waiter

Stop never waits for slow files (2 s budget). A silent main-agent Stop records the slow files pending at that moment like any pending file (001 D9), so in an interactive Claude Code session the idle waiter wakes the agent with a slow failure; in Codex and `-p` sessions, which have no idle wake (002), the failure arrives with the next prompt or tool call, which the status line says. A `codex exec` or `claude -p` session never idles: the slow files pending when it ends run before its daemon exits, for at most `daemon.idleExitMinutes` (001 D10, task 004-29), and their results reach the next session in that worktree. `stop.requireSlowSuite` (D7) is the opt-in for a project that wants an agent held until its slow tier has run.

### D10. Isolation

Each slow run gets the daemon's fresh temp directory (001 D10) and its own process group, killed at the deadline (003 D5). The slot (D2) bounds one user's slow files across worktrees to `slow.maxParallel` at once; with the default of 4, two worktrees' slow files can run at the same time, so the cross-worktree port collisions the research reproduced for this user are possible again, at that bound, and a project whose slow files share fixed ports sets `slow.maxParallel` to 1; fixed ports across users or repositories, hard-coded `/tmp` paths and shared caches remain the project's (`research/slow-suite-runtime.md` 4), and the first time a slow file fails with `EADDRINUSE` the note says so.

## Testing

- Scheduler tests (001 style, fake runners): a slow file is never in a fast tier; the slow tier waits for nothing pending and an idle or absent consumer; a fast revision preempts between slow files; the slot interleaves two worktrees tier by tier within `slow.maxParallel` permits; an idle tier takes up to `slow.maxParallel` files and one file when fast work or load is present; the guard defers and then runs with a note; a keyed input changed during a slow run discards and re-queues.
- Key tests: declared artifact inputs re-key a slow file; the no-artifact note; a slow file inherits only with a declared artifact, and never without one; a slow node:test project observes a spawned process's loads through `NODE_OPTIONS`.
- Status and delivery tests: the slow-tier line in each state; the slow failure line; the primer change; `stop.requireSlowSuite`.
- End to end, both plugins: this repository's shape (Vitest e2e over a built plugin, declared slow and keyed by `plugins/**`) and cezarion's shape (a node:test e2e project, `slow: true`, keyed by `dist`): an edit reports its fast tests first; the slow tier runs on idle and on `run --slow`; a bundle change re-runs the slow files; a second worktree does not inherit them.
- Proof: dogfooding on this repository with `test/e2e` declared slow, and on a cezar worktree (as 003-19), recorded in `lessons.md`, with calm-load timings if the host allows.

## Open questions

Owner is the coordinator unless noted.

1. Defaults for `slow.maxWorkers`, `slow.maxLoadPerCpu` and `slow.maxDeferMs`: the research has no calm-load data; set from dogfooding.
2. The idle trigger in a worktree with several consumers: idle when every registered consumer is idle, or when any is? Proposed: every in-turn consumer blocks the slow tier; a consumer idle for 10 minutes without a waiter counts as absent (001 D10's expiry).
3. macOS: `ionice` does not exist; `nice` and the slot are portable. Not run.
4. Decided 2026-10-08: one `slow` object (`include` and the tuning keys), as the existing grouped keys are; no inheritance key (D6, decided by the human).
5. Whether a slow Vitest project should be a separate Vitest `project` rather than a glob; the glob covers both repositories measured, so it is v1.

## References

- ADR 0004; specs 001, 002, 003.
- Research: `research/slow-suite-policy.md`, `research/slow-suite-runtime.md`.
- 002 `lessons.md` defect 5 and board row 002-24 (inputs outside the worktree's files).
