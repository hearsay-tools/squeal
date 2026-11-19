# Squeal performance benchmark

This benchmark measures what an agent feels when Squeal runs beside it: hook latency, command latency, how fast a verdict follows an edit, and what Squeal costs the machine. It also tests the shared store under several worktrees and under ambient CPU load. It makes no model calls: a scripted session calls the Claude Code plugin's hooks and the `squeal` CLI the same way a real session does.

## Run it

```sh
bench/boat-run.sh                       # all cells, default sandbox, Ryzen 9 9950X; about 2 h
bench/boat-run.sh --cells ref --steps 12  # a quick check of the reference cell
```

`boat-run.sh` creates a boat.dev sandbox and pushes `plugins/claude-code` (the committed plugin bundle, which is what users install) and `bench/` to it. It runs `run-all.mjs` there and copies the results to `bench/results/<date>-<version>-<type>-<cpu>/`. The sandbox is created with `--no-env`, so it holds none of the account's secrets. It is deleted at the end unless `--keep` is given.

On another Linux machine (Node ≥ 22.19, pnpm, git, sqlite3):

```sh
node bench/run-all.mjs --plugin "$PWD/plugins/claude-code" --out /tmp/sq-bench
```

Do not run it on a shared development host. Each cell starts real daemons, and the load cells keep every vCPU busy on purpose.

## The machine

The boat.dev $20 plan (`box_20`) offers three sizes:

| Type | vCPU | RAM | Rate |
|---|---:|---:|---|
| small | 2 | 4 GB | half |
| **default** | **4** | **8 GB** | $0.036 per hour |
| large | 8 | 16 GB | double |

`xlarge` (16 vCPU, 32 GB) needs the $100 plan. The plan includes 2,000,000 machine-seconds (555 default hours) a month.

**Reference: `default`, 4 vCPU, 8 GB.** It is close to a developer laptop, which is where Squeal runs. With 4 vCPUs, extra worktrees and ambient load show their effect early. `large` is the second machine, used to show whether a problem comes from Squeal's design or from too few CPUs: `bench/boat-run.sh --type large`.

**The CPU model is not fixed by the type.** In 15 sandboxes on 2026-11-19 we saw a Ryzen 9 9950X, a Ryzen 7 9700X, an EPYC 9455, an EPYC 4585PX and an EPYC 8224P, for default and large alike. `boat-run.sh` therefore retries until it gets a Ryzen 9 9950X (the most common). `meta.json` records the CPU model and a single-thread score (SHA-256 MiB/s). Only compare runs on the same CPU model.

## The project

`gen-project.mjs` writes a deterministic TypeScript + Vitest 5 project. There are modules `src/m<i>.ts`, each with one test file `test/m<i>.test.ts`. Each test file has 6 cases with about 15 ms of CPU each. The modules form groups of 25; each group is a binary tree of imports, and every module imports `src/core.ts`. So:

- an edit to a leaf module affects 1 test file;
- an edit to a group root affects 25 test files;
- an edit to `src/core.ts` affects every test file.

| Size | Test files | Plain `vitest run` on default (4 vCPU) |
|---|---:|---|
| S | 100 | about 7 s |
| **M (reference)** | **500** | about 35 s |
| L | 2000 | about 2.5 min |

The project uses Squeal's shipped defaults (`squeal.config.json` is `{}`), so coverage and complexity are on and `baseline.onStart` is `lookup-only`.

## The cells

The benchmark varies one factor at a time from the reference cell, and adds one corner case that combines the worst values:

| Cell | Test files | Active worktrees | Ambient load |
|---|---:|---:|---:|
| ref | 500 | 1 | 0% |
| size-s | 100 | 1 | 0% |
| size-l | 2000 | 1 | 0% |
| wt-3 | 500 | 3 | 0% |
| wt-6 | 500 | 6 | 0% |
| load-50 | 500 | 1 | 50% |
| load-100 | 500 | 1 | 100% |
| stress | 500 | 6 | 100% |

Ambient load (`load.mjs`) is busy-loop threads at normal priority on that share of the vCPUs. It stands for another agent's build or test run.

Each cell (`run-cell.mjs`) starts from a fresh store and runs these phases in order:

1. Copy the project and add the worktrees (`git worktree add`, with `node_modules` copied).
2. Start the load and wait 5 s.
3. In 1-worktree cells only: run plain `vitest run`, the reference without Squeal.
4. Run `squeal start`, then `squeal run --all --wait` in the main worktree: a cold full run on an empty store.
5. Run `squeal start` in every other worktree: each starts on the shared store and looks up results it does not have to run again.
6. Wait 60 s with no edits, to measure idle CPU.
7. Run one scripted session per worktree, all at the same time, starting 3 s apart.
8. Read the store and daemon numbers, then run `squeal stop` in every worktree.

## The scripted session

`session.mjs` runs SessionStart, then 24 steps with 3–8 s of "thinking" before each one, then Stop. Each edit runs PreToolUse, writes the file and runs PostToolBatch, the same way Claude Code does. After each edit it calls `squeal status --wait 60000 <file> --json`, as `CLAUDE.md` tells agents to. The edits are seeded, so every run makes the same edits:

- **benign:** change a module's exported constant. Tests must pass. 80% of these edits go to leaf or mid-tree modules, 20% to group roots.
- **break**, then **fix** (four pairs): make a function off by one, then repair it with new content. The repair is not a revert, so Squeal must run the tests again instead of reusing a stored result. After each edit the session calls PostToolBatch about once a second, as later tool calls would, until the failure or the recovery is pushed.
- **status** (every fifth step): plain `squeal status` and `squeal status --json`.
- **broad** (the last step): change `src/core.ts` and wait up to 300 s for the whole suite's verdict.

## Metrics

Each metric has a healthy limit and a warn limit. A metric within the healthy limit scores 1, one within the warn limit scores 0.5, and one beyond it scores 0. A cell's score is the mean over its scored metrics × 100. The overall score is the mean of the cell scores. "report" metrics have no limit: they are recorded so a change can be compared with an earlier run.

| Metric | Healthy | Warn | Why this limit |
|---|---|---|---|
| **Hooks** (every tool call pays for these) | | | |
| `hook.preToolUse.p95` | ≤ 80 ms | ≤ 200 ms | Spec 001/012 budget for per-tool hooks: 80 ms p95, of which about 50 ms is Node start |
| `hook.postToolBatch.p95` | ≤ 80 ms | ≤ 200 ms | Same budget |
| `hook.sessionStart.max` | ≤ 750 ms | ≤ 2000 ms | SessionStart waits up to 750 ms for the daemon; every hook has a 2 s timeout |
| `hook.stop.max` | ≤ 1500 ms | ≤ 2000 ms | `stop.waitMs` is capped at 1500 ms; 2 s timeout |
| **Commands** | | | |
| `cmd.status.p95`, `cmd.statusJson.p95` | ≤ 300 ms | ≤ 1 s | An agent polls status; Node starts in about 50 ms, so 300 ms leaves room for the store read |
| `cmd.start.main` | ≤ 2 s | ≤ 5 s | `squeal start` returns once the daemon is spawned |
| `cmd.start.others.max` | ≤ 2 s | ≤ 5 s | The same, for a new worktree on a store other worktrees fill |
| `cmd.runAll.overhead` | ≤ 1.3× | ≤ 2× | `run --all --wait` wall time divided by plain `vitest run` |
| `cmd.runAll` | report | | Cold full run, seconds |
| **Session** (what the agent sees) | | | |
| `session.pushFail.p50` | ≤ 3 s | ≤ 10 s | From the edit that breaks a test to the hook that pushes the failure |
| `session.pushFail.missed`, `session.pushRecovery.missed` | 0 | 0 | A missed push breaks the product promise: "PASS → FAIL: notify" |
| `session.verdict.p50`, `.p95` | ≤ 3 s, ≤ 10 s | ≤ 10 s, ≤ 30 s | From a benign edit to `status --wait` settling; a wait timeout counts as infinite |
| `session.verdict.within60s` | ≥ 95% | ≥ 80% | Edits whose `status --wait 60000` settled before its timeout |
| `session.verdict.wrong` | 0 | 0 | A settled verdict that disagrees with the truth. This should never happen |
| `session.broad.verdict` | ≤ 180 s | ≤ 300 s | Edit to `src/core.ts` until the whole suite is current. Catch-up waits 120 s of quiet by design, so 180 s allows about 60 s of running |
| **Resources** | | | |
| `res.idleCpu.maxPct` | ≤ 1% | ≤ 5% | Daemon CPU, children included, over 60 s with no edits, as % of one core |
| `res.daemonRss.max` | ≤ 300 MiB | ≤ 600 MiB | Peak RSS of one daemon process; spec 021 measured 281 MiB idle on a large project |
| `res.cpuPerEdit` | report | | Daemon CPU, children included, during the sessions, divided by the edits |
| **Store** | | | |
| `store.longWrites` | 0 | ≤ 3 | Writes the daemon logs as held over 250 ms (`LONG_WRITE_MS`) |
| `store.lockFailures` | 0 | ≤ 3 | `SQLITE_BUSY` or "database is locked" in the daemon logs |
| `store.size`, `store.results` | report | | `store.sqlite` + WAL + `code.sqlite` in MiB, and rows in `results` |

## Files

| File | Purpose |
|---|---|
| `boat-run.sh` | Local driver: sandbox, push, run, fetch, delete |
| `run-all.mjs` | Machine facts, calibration, templates, every cell, scorecard |
| `run-cell.mjs` | One cell |
| `session.mjs` | One scripted agent session |
| `gen-project.mjs` | The synthetic project |
| `load.mjs` | Ambient CPU load |
| `summarize.mjs` | `scorecard.md` and `scores.json` from a results directory; the limits live here |
| `lib.mjs` | Timing, `/proc` reading, the seeded random generator |
| `results/` | Committed scorecards and raw data of past runs |

## What it does not cover yet

- **Store age.** Every cell starts on a fresh store. A store that holds a week of history (retention is 7 days) is larger, and its reads and prunes cost more.
- **Other runners and harnesses.** It tests only Vitest through the Claude Code plugin; not node:test, pytest, Codex, OpenCode or Pi.
- **Disk and memory pressure.** The ambient load is CPU only.
- **Real model sessions.** The edit rhythm is scripted. `evals/` has real sessions.
