# 001-378: Vitest sized from the grant; maxWorkers out of the key; nice for every runner

Worker notes, 2026-10-15. Spec 001 D11 Capacity (Runner ceiling, Priority); `research/host-capacity.md` probe P1.

## P1: a warm instance resizes between runs

*Verified by experiment*, Vitest 5.0.3, Node 24.21.0, host load 25 to 69 (24 CPUs). Script: `p1/probe.mjs`, run from a scratch directory whose `node_modules` links to this worktree's.

- **Method.** A 40-file fixture; each file's one test sleeps 250 ms and appends its pid, `VITEST_POOL_ID`, start and end to a log. One instance (`createVitest('test', { watch: false })`, `standalone()`), then all 40 files run three times with `maxWorkers` 8, 2 and 8, set between the runs on `vitest.config` and every `project.config`. The peak is the most files whose intervals overlap.
- **Result.** Every run honoured the width it was given:

  | pool | isolate | maxWorkers | peak overlap | pool ids | pids | wall |
  |---|---|---|---|---|---|---|
  | forks | true | 8 / 2 / 8 | 8 / 2 / 7 | 8 / 2 / 8 | 40 / 40 / 40 | 4.2 / 15.1 / 4.3 s |
  | threads | true | 8 / 2 / 8 | 8 / 2 / 8 | 8 / 2 / 8 | 1 / 1 / 1 | 6.3 / 15.1 / 4.8 s |
  | forks | false | 8 / 2 / 8 | 8 / 2 / 8 | 8 / 2 / 8 | 8 / 2 / 8 | 1.9 / 5.7 / 1.5 s |

  The 7 of the third forks run is the load (a fork that started late), not a cap: its pool ids reached 8.
- **Why** (*read in source code*, `dist/chunks/index.DpLw24bj.js`). `createTaskGroups` calls `resolveMaxWorkers(project)` for every run, and the pool calls `setMaxWorkers` per task group. `resolveMaxWorkers` reads `project.config.maxWorkers`, then `project.vitest.config.maxWorkers`, then the CPU default. `serializedConfig` is recomputed on each read, so tests see the width too (`serialized` in the probe's output).
- **Decision.** No recreate. The adapter writes the width into the resolved configs before each run and restores the project's own values when a run has no grant.

### A finding on the way: the CLI option overrides a project's own maxWorkers

A second probe printed each project's resolved `maxWorkers` for a root config `{ maxWorkers: 3, projects: [a (extends), b (extends, maxWorkers 2), c] }`:

- Without options: root 3, `a` 3, `b` 2, `c` 3.
- With `createVitest(..., { maxWorkers: 5 })`: root 5 and every project 5, `b` included.

So today's slow instance, created with `maxWorkers: max(slow.maxWorkers, slow.maxParallel)`, runs a project that set 2 at 4. D11's ceiling forbids that. The slow instance now gets its width per run, as the main one does, and the creation option is gone.
