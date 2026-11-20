# Squeal performance benchmark

This benchmark measures what an agent feels when Squeal runs beside it: hook latency, command latency, how fast a verdict follows an edit, and what Squeal costs the machine. It also tests the shared store under several worktrees and under ambient CPU load. It makes no model calls: a scripted session calls the Claude Code plugin's hooks and the `squeal` CLI the same way a real session does.

## Run it

```sh
bench/boat-run.sh                                            # all cells on this worktree's plugin; about 4 h
bench/boat-run.sh --cells ref --steps 12                       # a quick check of the reference cell
bench/boat-run.sh --ref squeal--v0.1.572                       # the plugin as released at that tag
bench/boat-run.sh --ref squeal--v0.1.572 --ref origin/main --cells ref,wt-6   # two versions on one machine
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

**The CPU model is not fixed by the type.** In 15 sandboxes on 2026-11-19 we saw a Ryzen 9 9950X, a Ryzen 7 9700X, an EPYC 9455, an EPYC 4585PX and an EPYC 8224P, for default and large alike, and on 2026-11-20 twelve starts in a row gave a Ryzen 7 9700X. Hunting for one model wastes the plan's start limits (12 a minute, 60 an hour, 200 a day), so **compare versions in one sandbox**: give `--ref` once per version. Every cell then runs once per version, alternating which goes first, and the scorecard adds a table of the differences. `meta.json` records the CPU model and a single-thread score (SHA-256 MiB/s); `TREND.md` groups runs by CPU model, and only runs on the same model compare across sandboxes. `--cpu "<model>"` still retries starts until that model comes up.

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
| store-1.7g | 500 | 1 | 0% (store aged 70 rounds, 2.0 GB) |
| store-7g | 500 | 1 | 0% (store aged 326 rounds, 9.2 GB) |
| churn | 500 | 1 | 0% (as store-7g, history over 8 days, prune and integrity check due) |

The two store cells run the reference cell on a store that already holds a week of history. After the full run, `age-store.mjs` adds rounds of history: every test file gets a new content key, with its results, one `loaded_modules` list of real-store size (about 50 KB) and the runs that recorded them. All of it is dated within the last 7 days and is older than the real rows. The shape follows Squeal's own store on 2026-11-20: 7.2 GB, 82% of it in `loaded_modules` (163k rows, 46 KB each) and 1.74M `results` rows. 326 rounds gives that store's `loaded_modules` row count; 70 rounds gives its rows per test file, scaled to 500 test files. The code store (`code.sqlite`, coverage and complexity) gets the same history: for every new key, a copy of that test file's real coverage record, dated like its results, and an 8 KB part that no record lists, standing for the larger records of a real repository. At 326 rounds that is about 1.4 GB; Squeal's own `code.sqlite` was 1.5 GB (coverage 193k rows) on 2026-11-20.

The churn cell measures the daily upkeep of a large store. Its history spans 8 days, so about one day of it is past the 7-day retention, as after a day with no daemon running. `age-store.mjs --churn` also clears the store's record of the last prune and the last full integrity check. The restart then checks the whole file, and the first prune (prune runs at most once an hour per repository and is asked every 6 minutes) has to delete that day. The cell records, from the restart, when old results start to go and when none is left (`prune-watch.json`), and when the daemon logs "full integrity check: ok".

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

### Score

**Correctness is a gate.** A wrong verdict, a missed push (failure or recovery), a false alarm, a notice that names the wrong test or reaches the wrong session, a hook call over its 2 s timeout or a session that crashed, in any cell, marks the whole run **FAILED**, whatever its points. These metrics have no partial credit: Squeal's promise is "PASS → FAIL: notify", and a fast wrong answer is worse than a slow right one.

**Speed is scored in five areas of equal weight:** Hooks, Commands, Verdicts, Resources and Store. A metric within its healthy limit scores 1, within its warn limit 0.5, beyond it 0. An area's score is the mean of its scored metrics. A cell's score is the mean of its areas × 100, so an area with four metrics weighs the same as one with two. A metric that does not apply to a cell (starting other worktrees, with one worktree) is left out. The overall score is the mean of the cell scores, so it compares only between runs of the same cells; the cell scores always compare. "report" metrics have no limit: they are recorded so a change can be compared with an earlier run. `bench/results/TREND.md` lists every committed run.

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
| `session.pushFail.missed`, `session.pushRecovery.missed` | 0 (gate) | | A missed push breaks the product promise: "PASS → FAIL: notify" |
| `session.verdict.p50`, `.p95` | ≤ 3 s, ≤ 10 s | ≤ 10 s, ≤ 30 s | From a benign edit to `status --wait` settling; a wait timeout counts as infinite |
| `session.verdict.within60s` | ≥ 95% | ≥ 80% | Edits whose `status --wait 60000` settled before its timeout |
| `session.verdict.wrong` | 0 (gate) | | A settled verdict that disagrees with the truth. This should never happen |
| `session.failed` | 0 (gate) | | A scripted session that crashed or timed out |
| `hook.overTimeout` | 0 (gate) | | Hook calls over 2 s. Every hook in `hooks.json` has `timeout: 2`; Claude Code kills a slower call and drops its output. The scripted session allows 30 s, so it records the time instead of losing the call |
| `store.failedBatches` | 0 (gate) | | Code-store batches the store process or a daemon logged as failed: lost writes |
| `notice.falseAlarm` | 0 (gate) | | A FAIL line pushed while the session has broken nothing (after a benign edit, a status check or the broad edit). "Silence is a feature" |
| `notice.unnamed` | 0 (gate) | | A failure notice after a break that names neither the edited file nor a test the break reaches |
| `notice.wrongTest` | 0 (gate) | | A FAIL line for a test file the session's break does not reach (the module and the modules that import it) |
| `notice.wrongSession` | 0 (gate) | | A FAIL line for a test another worktree's open break reaches: a notice delivered to the wrong session |
| `session.broad.verdict` | ≤ 180 s | ≤ 300 s | Edit to `src/core.ts` until the whole suite is current. Catch-up waits 120 s of quiet by design, so 180 s allows about 60 s of running |
| **Resources** | | | |
| `res.idleCpu.maxPct` | ≤ 1% | ≤ 5% | CPU over 60 s with no edits, as % of one core: the busiest daemon with its children, plus the code store's process |
| `res.daemonRss.max` | ≤ 300 MiB | ≤ 600 MiB | Peak RSS of one daemon process; spec 021 measured 281 MiB idle on a large project |
| `res.cpuPerEdit` | report | | CPU during the sessions (daemons with their children, plus the code store's process), divided by the edits |
| `res.storeProcess.cpuS`, `res.storeProcess.rss` | report | | The code store's process (spec 021 D22, from 0.1.575): CPU during the sessions and peak memory. It is a separate process, not a daemon's child |
| **Store** | | | |
| `store.longWrites` | 0 | ≤ 3 | Writes the daemon logs as held over 250 ms (`LONG_WRITE_MS`) |
| `store.lockFailures` | 0 | ≤ 3 | `SQLITE_BUSY` or "database is locked" in the daemon logs |
| `store.size`, `store.results` | report | | `store.sqlite` + WAL + `code.sqlite` in MiB, and rows in `results` |
| `store.prune.doneMin` | ≤ 12 min | ≤ 20 min | Churn cell: from the restart until no result past retention is left. Prune is asked every 6 minutes, so 12 allows two asks |
| `store.prune.s`, `store.fullCheck.s` | report | | Churn cell: how long the prune deleted for, and the restart until the integrity check passed |
| `store.process.queueWaitMax`, `.busy`, `.direct`, `.stops` | report | | From the store process's per-minute log and the daemons' matching lines: the longest wait of a batch in its queue, time spent writing, batches a daemon wrote itself because the process was gone, and its stops |

## When to run

Agreed with the human on 2026-11-20 (paired runs the same day); `docs/process.md` step 6c holds the same rule.

1. **Weekly.** A full run (every cell) of the latest release tag paired with the release before it, in one sandbox: `bench/boat-run.sh --ref squeal--v<previous> --ref squeal--v<latest>`, about 8 hours of sandbox time. A cockpit automation starts it on Mondays at 06:00 Europe/Warsaw. The task commits the results directory and `results/TREND.md` as a docs commit and reports to the human.
2. **On demand, for performance work.** A row that changes the store, the daemon, the scheduler, the hooks or delivery runs `ref` and the cells it targets as one paired run: `--ref <the release it starts from> --ref <its candidate>`. The comparison goes into the row's notes before review. It is evidence for the review, not a gate.
3. **Never a release gate.** As with the evals (human, 2026-10-19).
4. **What a result triggers.** A correctness failure goes to the human at once. A cell where the newer version scores 15 points or more below the older one in the same paired run is run again as a pair (`--cells <that cell>`); if the drop holds, it goes to the human, who decides whether it becomes a row. Until run-to-run noise is measured (the first weekly run repeats `ref` three times as a pair), 15 points is a first guess.
5. **Where.** Only on boat.dev sandboxes, never on the shared development host or the lab VM.

## Files

| File | Purpose |
|---|---|
| `boat-run.sh` | Local driver: sandbox, push, run, fetch, delete |
| `run-all.mjs` | Machine facts, calibration, templates, every cell, scorecard |
| `run-cell.mjs` | One cell |
| `session.mjs` | One scripted agent session |
| `gen-project.mjs` | The synthetic project |
| `age-store.mjs` | Adds a week of history to a store, for the store cells |
| `load.mjs` | Ambient CPU load |
| `summarize.mjs` | `scorecard.md` and `scores.json` from a results directory; the limits and the score live here |
| `trend.mjs` | `results/TREND.md`, every committed run by CPU model; `boat-run.sh` runs it |
| `lib.mjs` | Timing, `/proc` reading, the seeded random generator |
| `results/` | Committed scorecards and raw data of past runs |

## What it does not cover yet

- **Store fragmentation.** Aged rows are inserted in one go, so the file has few free pages and its pages are in order. A store that has lived for weeks is more scattered.
- **Other runners and harnesses.** It tests only Vitest through the Claude Code plugin; not node:test, pytest, Codex, OpenCode or Pi.
- **Disk and memory pressure.** The ambient load is CPU only.
- **Real model sessions.** The edit rhythm is scripted. `evals/` has real sessions.
