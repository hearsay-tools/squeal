# An edit made just before `squeal run <group> --wait` (row 011-332)

Research for decision 5 of `research/waits.md` (brief R1 in `tasks/wave-85.md`). Source examined: branch `cez/3214dce5` at `f206c9146` (main as of 2026-11-14). Probe: `probes/group-wait-edits/`. Runs on 2026-11-14 from 09:38Z to 09:50Z.

**Verdict.** Yes. The daemon takes a `run-group` request without first storing the edits made before it. A client that reaches the daemon before the edit's revision is stored gets a verdict at the revision before the edit, with exit 0 for a failing edit or exit 1 for a passing one. The spawned CLI did not hit it in 24 runs on a 12-file fixture, because its own start-up was slower than the change feed there. Taking the status waits' sync first removed the miss in 24 of 24 runs, at 57 to 233 ms per command.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Can the request be taken at the revision before an edit made just before it? | Yes: 24 of 24 in-process requests; 0 of 24 spawned CLI requests. | verified by experiment |
| 2 | Can the group's verdict then be wrong? | Yes: 12 of 24 in-process runs gave the opposite exit code to the file's content, each at the revision before the edit. | verified by experiment |
| 3 | Why can it happen? | `groupRequest` and `narrowRequest` have no `afterPass` start rule; `run --all` has one (row 011-198). The group wait's first store read is at once, and ends when no file of the group is pending. | read in source code |
| 4 | How large is the window? | 37 to 368 ms (median 157 ms) from the write to the stored revision on the fixture at load 117 to 125. Lessons defect 30 recorded 0.9 to 3.1 s on a real repository on a loaded host. | verified by experiment (fixture); read in source code (defect 30) |
| 5 | What does the fix cost? | The status waits' sync before the request: 57 to 233 ms (median 123 ms) on the fixture; 0 of 24 missed after it. | verified by experiment |
| 6 | Was it repeated on an idle host? | No. The 1-minute load stayed between 57.9 and 144.7 on 24 CPUs for the whole session (`uptime` at 09:35Z: 58.4); it never fell below 1 per CPU. | verified by experiment (uptime) |

## Method

`probes/group-wait-edits/probe.test.ts` starts a real daemon on the scheduler fixture with the helpers of `test/cli/run-group-daemon.test.ts`: fixture under `test/fixtures/scheduler/.tmp`, `XDG_RUNTIME_DIR` and `XDG_CONFIG_HOME` in a private `/tmp/sq-*` directory, and `HOME` moved there too. The fixture adds group `e2e` (`test/e2e/**`, `at: "stop"`) with one test file that reads `src/value.ts`.

Each run waits until the store's revision has been still for 1.5 s, writes `src/value.ts` (odd runs fail, even runs pass, a new key each time), and at once starts the wait. Then it reads the first revision above the one before the write: the edit's revision. A run **missed** the edit when the request's revision (from the `requested` line) is below the edit's. A verdict is **wrong** when the exit code does not match the file's content. Four batches of 24 runs, one after another; the load was host load from other sessions, none made on purpose.

| Batch | Client | 1-min load (24 CPUs) | Missed | Wrong verdict | Command time |
|---|---|---|---|---|---|
| `cli` | spawned compiled CLI, `run e2e --wait 300000` | 71.9 to 101.7 | 0 / 24 | 0 / 24 | 3.1 to 5.4 s |
| `inproc` | `runGroupCommand` in the probe's process | 112.9 to 117.7 | 24 / 24 | 12 / 24 | 0.12 to 5.2 s |
| `latency` | none; store polled every 5 ms | 117.9 to 124.8 | n/a | n/a | stored after 37 to 368 ms, median 157 |
| `inproc-sync` | `syncDaemon` (poll 50 ms), then `runGroupCommand` | 131.3 to 144.7 | 0 / 24 | 0 / 24 | sync 57 to 233 ms, median 123 |

Per-run records with the load of each run: `probes/group-wait-edits/evidence/<batch>-gap0.ndjson`; `uptime` before each batch: `evidence/uptime.txt`.

## Findings

**F1. The request does not wait for the edits made before it.** `Scheduler.requestGroup` hands `groupRequest` to the request intake (`src/core/scheduler/scheduler.ts:676`). Its start rule is a plain `skip` (`request-intake-requests.ts:98`); the narrow run's is too (`narrow-run.ts:118`). Only `fullSuiteRequest` sets `afterPass: true` (`checkpoint-requests.ts:136`), which makes the intake wait for a reconciliation pass that started after the request (`request-intake.ts:118`, `#afterPass`). The daemon's `run-group` handler calls `requestGroup` directly (`daemon.ts:1160`); only the `sync` request runs `this.#loop.reconcile()` first (`daemon.ts:1176`). *read in source code, `f206c9146`.*

**F2. The wait then ends at the old revision.** `queueGroup` queues nothing for a file that is current at the request's revision, so the request answers `No test files of group e2e to run at revision N`. `runWait` reads the store at once (`wait/wait.ts:52`), finds no file of the group pending, and ends `ended` with the verdict at revision N (`wait/table.ts:254`). In the `inproc` batch this happened in every run whose file was current before the edit: 12 of 24, each in 119 to 235 ms. Example, run 1: `Group e2e completed at revision 0: no known failures` with exit 0, while `src/value.ts` returned 2 and the test failed at revision 1. *verified by experiment; read in source code.*

**F3. A miss can also give the right answer by chance.** In the other 12 `inproc` runs the request was also taken at the old revision, but the previous run's missed edit had left the file stale, so the request queued it. The run started after the edit was stored, and the verdict came at the edit's revision. The alternation is the probe's order, not a property of Squeal: a user whose group was current before the edit is in the wrong-verdict case. *verified by experiment; inferred for the user case.*

**F4. The spawned CLI is protected only by its start-up time.** In the `cli` batch every request was taken at the edit's revision. `squeal --version` of the installed CLI took 0.22 to 0.35 s at load 118; `run <group>` also locates the daemon (a store read and a ping) before it sends the request. The edit was stored after 37 to 368 ms on the fixture. The margin is small, and it depends on the tree: the change feed debounces 100 ms quiet, 500 ms at most (`watcher/change-feed.ts:91`), and lessons defect 30 recorded an edit's revision 0.9 to 3.1 s after the edit on a real repository on a loaded host (`src/cli/status-sync.ts:51`). Above about 0.3 s, a spawned CLI would miss. *verified by experiment (fixture, CLI start-up); read in source code (defect 30); inferred (real repository).*

**F5. The status waits' sync removes the miss.** `syncDaemon` asks the daemon for a reconciliation pass and polls until it is stored (`status-sync.ts:61`); the pass reads `git status`, so it finds an edit the watcher has not delivered yet (`change-feed.ts:275`). With it first, 24 of 24 requests were taken at the edit's revision and 24 of 24 verdicts matched the content. The sync took 57 to 233 ms (median 123 ms) at load 131.3 to 144.7; part of that is the edit's own window, which the command would otherwise skip. On a larger tree the pass costs at least its `git status`: 0.14 to 0.18 s on this repository (12,665 tracked files) at load about 118. *verified by experiment (fixture); verified by experiment (`git status` time); inferred (pass cost on large trees).*

## Recommendation for Squeal

Take the proposed row. Two placements give the same order; the evidence does not choose between them:

- **In the daemon:** `afterPass: true` on `groupRequest` and `narrowRequest`, as `run --all` has (row 011-198). One rule in the request intake covers every client of the request, the lint group's release included (it goes through `groupRequest`), and a newer daemon fixes an older CLI. It inherits `NO_PASS` when the pass fails or the daemon closes first.
- **In the CLI's run wait:** the status waits' sync before the `run-group` request, as decision 4 brings the status waits' rules to the run waits. It fixes only new CLIs, and an older daemon that cannot sync answers "unsupported".

Cost either way: one reconciliation pass per command, about 0.06 to 0.23 s on a small tree at this load, and at least `git status`'s time on a large one. The test for the row: the probe's `inproc` order (edit, then the request at once, file current before the edit) must give the edit's revision.

## Open questions

- **A large tree with the spawned CLI.** Not run: the probe used only the 12-file fixture. A run on a large tree would show how often the real CLI misses; defect 30's 0.9 to 3.1 s suggests often. Not determined, because no large fixture was set up within the 30 minutes.
- **An idle host.** Not run: the load never fell below 1 per CPU during the session.
- **Groups with an edit moment.** Not run. An edit-moment group's file is queued by the edit itself, but a request taken before that is stored still meets a current file, so the same verdict at the old revision is expected. *inferred.*

## Sources

- `src/core/scheduler/request-intake.ts`, `request-intake-requests.ts`, `checkpoint-requests.ts`, `narrow-run.ts`, `scheduler.ts`; `src/core/daemon/daemon.ts`, `handlers.ts`; `src/core/watcher/change-feed.ts`; `src/cli/run-group.ts`, `run-group-wait.ts`, `wait/wait.ts`, `wait/table.ts`, `wait/reads.ts`, `status-sync.ts`; all at `f206c9146`.
- `test/cli/run-group-daemon.test.ts`, `test/daemon/helpers.ts` (the fixture and daemon helpers the probe reuses).
- `probes/group-wait-edits/`: `probe.test.ts`, `vitest.config.ts`, `run-all-modes.sh`, `README.md`, `evidence/`.
