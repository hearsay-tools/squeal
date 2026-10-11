# Who kills a daemon started inside a cezar worktree?

Research task 001-180 for spec 001, 2026-10-11, from `004-slow-suites/lessons.md` defect 16 (004-46 addendum). Linux 6.8, 24 CPUs, Node v24.21.0, Vitest 4.1.10 (cezar's install), Squeal 0.1.110 (the hub plugin). Cezar in a scratch clone at `c07b0bfc` (the 004-46 commit) and `ac1ea1a8` (`origin/main`). Evidence from 2026-10-09: the 004-46 session transcript (`~/.claude/projects/-home-agent-projects-squeal--ai-cezar-worktrees-58239afe-*/bfd3e50e-*.jsonl`), its probes and logs (`004-slow-suites/research/probes/dogfood2/`), Cezarion's run stores (`<project>/.ai/cezar/runs.db`, all four projects), Squeal's stores (`<repo>/.git/squeal/store.sqlite`, three repositories) and the kernel log. Every store was opened read only (`node:sqlite`, `readOnly: true`). `/var/log/kern.log*` and `/var/log/syslog.1` were read with `sudo -n grep`, which changes nothing. No live worktree, store or daemon of the human's was touched. Probe: `probes/daemon-sigkill/` (throwaway). Times are UTC unless marked local (UTC+2).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does Cezarion's worktree setup, its runner or its timeout, kill a process group or the processes under the worktree? | No. Setup runs `bash -lc <command>` detached, in a new group, and signals only that group. No setup ran in any of the four projects within 15:20 to 15:35 on 2026-10-09, and the three cezar trees of 004-46 were made by `git worktree add`, not by Cezarion. The "about 18 s" is the median of cezar's setups (17.7 s over 54), a coincidence. | read in source code; read in the run stores |
| 2 | Does a Squeal daemon started by a hook during setup land in that group? | No. Setup finishes before the first agent step starts, so no SessionStart hook runs during it. A daemon is spawned detached and leads its own group. | read in source code |
| 3 | Does setup replace `node_modules` from under a running daemon? | No. It runs in the new run's own worktree before any agent works there. A replaced `node_modules` would break imports, not send SIGKILL. | read in source code |
| 4 | Is the leftover fake `gh` from `src/ci-wait/process.test.ts` the killer? | No, it is a victim. The fixture sends no signal. Its wrapper runs inside the daemon's group, and the wrapper starts `gh` detached. A kill of the daemon's group kills the wrapper and leaves `gh` running with nobody to stop it, as was found. | read in source code; inferred |
| 5 | Is it Squeal's own D12 sweep? | No. The sweep sends SIGTERM first and writes a note for every process it stops. No note in any store names a daemon. A daemon's sweep reaches only its own mark's carriers and its own group, and another daemon is neither. | read in source code; read in the stores |
| 6 | The kernel's OOM killer? | No. The kernel log from 2026-10-04 to 2026-10-10 22:07 has no OOM line. Neither do the three rotated logs before it. | read in the kernel log |
| 7 | Does a cezar-managed worktree as the start cwd matter? | No evidence that it does. Today a daemon started from this cezar worktree, with the agent's environment, survived 8 min of its first tiers. In 004-46 the cwd moved with the time: the two killed daemons ran at 5.3 to 7.6 load per CPU, the three survivors at 2.3 to 3.9. | verified by experiment; read in 004-46 logs |
| 8 | Then who? | Cezar's own test suite: the `afterEach` of `src/autosave-timeout.test.ts` (line 47 at `c07b0bfc` and at `ac1ea1a8`). It reads a pid file, gets an empty line, and sends `process.kill(Number(""), "SIGKILL")`, which is `kill(0, SIGKILL)`, to its own process group. Squeal runs Vitest inside the daemon, and Vitest's fork workers share the daemon's group, so that kill takes the daemon with no note. I caught that call once, at `c07b0bfc`, with the suite pinned to 3 CPUs to match 2026-10-09's per-CPU contention. At today's unpinned loads, about 11,000 test runs never sent it. Which test's teardown fired on 2026-10-09 cannot be shown, because its run records are gone, but this is the only own-group kill in cezar's suite. | verified by experiment; read in source code |

## Findings

### 1. What died, and what survived (2026-10-09)

From the 004-46 transcript and logs:

| Daemon | Started from | Started (UTC) | First tiers | End | Load per CPU |
|---|---|---|---|---|---|
| 116600 | `node ready.mjs` (`squeal start`), cwd `probes/dogfood2` in the 004-46 cezar worktree | 15:25:16.7 | 15:26:50.1 | last heartbeat 15:27:14.785; gone at 15:27:31; no note | 5.29 at 15:25:16, 5.28 at 15:26:59; load 121.6 at 15:26:35, 1.3 GB free, 24% iowait (`top`) |
| 239247 | `nohup setsid node daemon-fg.mjs`, same cwd | 15:28:17.6 | 15:29:09.0 | `signal=SIGKILL` at 15:29:27.594; no note | 7.64 at 15:28:28 |
| 470631 (A), C, B | `cd /tmp && nohup setsid node .../daemon-fg.mjs` | 15:34:28, 15:38:13, 15:40:07 | from 15:34:46.6 | `squeal stop` | 3.92 at 15:33:01, 2.3 to 3.1 from 15:36 to 15:44 |

All five came from the same Bash tool of the same Claude session. Each carried the same environment (`CEZ_*`, the task's `TMPDIR`), except `PWD` and `OLDPWD`. *Read in the transcript and `cz.poll.txt`.*

What survived the two deaths: the wrapper `daemon-fg.mjs`, in another session, which printed the signal. The slow node:test file, which ran 3 more minutes as an orphan. A fake `gh`, started at 15:27:09, 5 s before the last heartbeat. *Read in `lessons.md` defect 16.*

That pattern fits a SIGKILL to the daemon's process group:

- `squeal daemon` is spawned `detached`, so it leads its own session and group (`ensure.ts:181-183`; `daemon-fg.mjs`).
- Squeal hosts Vitest in the daemon process (`createVitest`, `src/runners/vitest/adapter.ts`). Vitest 4.1.10 starts each fork worker with `child_process.fork(entrypoint, [], { env, execArgv, stdio: "pipe", serialization: "advanced" })` and no `detached` (`vitest/dist/chunks/cli-api.BK8pd4xc.js:3084`). Every worker, and every child a test spawns without `detached`, is in the daemon's group. *Read in source code.*
- Node:test files run in their own groups (`startGroup`, `detached: true`, `src/runners/node-test/run/process.ts:35-39`, the same at `98874f1`, which is 0.1.69). So a node:test file cannot kill the daemon this way, and the slow file survived. *Read in source code.*
- `ci-wait/github.ts:41-62`: the CI wrapper starts `gh` with `detached: true` and kills it only when its own controller dies. Test 1 of `process.test.ts` spawns the controller and wrapper without `detached`, so both are in the daemon's group. A group kill takes both and orphans `gh`. *Read in source code; inferred.*

### 2. The mechanism, reproduced

`probes/daemon-sigkill/` mini repository (`/tmp/sq180-mini-*`, its own store): two Vitest files, one of them `process.kill(Number(""), "SIGKILL")` inside a `try`. Squeal 0.1.110 started through `daemon-fg.mjs` from `/tmp`:

```
05:40:06.172 daemon pid 977622 for /tmp/sq180-mini-94e1b872
squeal daemon: serving /tmp/sq180-mini-94e1b872 on /run/user/1001/squeal-9568ceb7427d54a8.sock
05:40:06.878 daemon exit code=null signal=SIGKILL
```

The store holds no note, and `squeal status` read afterwards says `Daemon: running, last heartbeat 4 s ago`, then, once the heartbeat ages, "no daemon running since". Defect 16 had the same signature. *Verified by experiment.*

### 3. The cezar code that can send it

`process.kill(0, sig)` signals the caller's whole process group. `Number("")` and `Number("\n")` are `0`. Three cleanups in cezar's Vitest suite read a pid file and SIGKILL the number, inside a `try` that hides nothing because the call succeeds:

| File (at `ac1ea1a8`) | At `c07b0bfc` | Reads | Written by |
|---|---|---|---|
| `src/autosave-timeout.test.ts:45-47`, `afterEach` | line 47 | `bin/pid`, `trim().split("\n")`, each `Number(pid)` | the fake `git`: `fs.appendFileSync(bin/pid, String(process.pid) + "\n")` (line 61) |
| `src/core/runner-shutdown-parity.test.ts:102-104`, `finally` | line 92 | `leftover-group.pid`, `leftover-session.pid` | the mocks' leftover children: `require('fs').writeFileSync(file, String(process.pid))` (`scripts/mock-claude.mjs:25` and the other mocks) |
| `src/core/harness-autosave-settlement.test.ts:129-131`, `finally` | not present | `bin/pid` | `fs.writeFileSync(bin/pid, String(process.pid))` |

`src/headless-repo-handle.test.ts:68-69` has the same shape with SIGTERM. A SIGTERM would have left the note "daemon stopped: SIGTERM", so it is not this one. *Read in source code.*

`writeFileSync` and `appendFileSync` open, then write. The file exists empty in between, and stays empty if the writer is killed in between. The leftover-group child sits in the session group the test stops, and the fake `git` is stopped by cezar's autosave timeout. A cleanup that runs in that window, or after such a kill, sends `kill(0, SIGKILL)`. The group is Vitest's main process and all its workers, or, under Squeal, the daemon. *Read in source code; the window is inferred.*

No other kill in cezar's test or product code targets 0, the caller's group or the caller's parent. Checked by `grep` for `process.kill(` and `kill -`, `PPID`, `pkill` and `killall` over `packages/*/src`, `packages/cezar/test`, `packages/cezar/scripts`, `scripts` and `.github/scripts`. *Read in source code.*

### 4. Catching the test: not reproduced today

`kill-guard.cjs`, preloaded through `NODE_OPTIONS` into every Node process of a run, logs and drops a `process.kill` aimed at 0, at minus the caller's own group, or at the run's leader. Its sanity check: in the mini repository it logged `target 0, SIGKILL, own group (0)` from `test/z-kill.test.js:5`. Each run below led its own session, as the daemon does, from this cezar worktree, with the agent's environment:

| Run | Cezar | What | Load | Guard hits |
|---|---|---|---|---|
| run1 | `ac1ea1a8` | `server` project under `strace -f` on `kill`, `tkill`, `tgkill` and `pidfd_send_signal`, 6 workers; stopped at the 30-min tool limit with about 4,000 tests done | up to 1.8 per CPU | 0 kills of the own group or the leader, by any process, shell children included (`signals.mjs`) |
| run2 | `ac1ea1a8` | whole `server` project, 419 files and 9,184 tests, 12 workers, 763 s | up to 2.5 | 0 |
| stress1 | `ac1ea1a8` | the three files in §3, 8 instances at once, 3 rounds (24 runs, 2,088 tests) | 0.4 to 1.3 | 0 |
| run3 | `c07b0bfc` | whole `server` project pinned to 3 CPUs (`taskset -c 0-2`), 12 workers: 7 to 10 runnable processes on those CPUs, about the per-CPU contention of 2026-10-09 | about 3 per CPU on its CPUs | **1**, at 06:31:14.709, 6 min 35 s in: fork worker 2426979 (group 2181321, the leader's) called `process.kill(0, "SIGKILL")` from `src/autosave-timeout.test.ts:47:23`, the `afterEach`. That file had 4 of 13 tests failing in this run. I stopped the run after the hit (`logs/run3.*`). |
| focus | `c07b0bfc` | `autosave-timeout.test.ts -t "terminates descendants ..."` alone, pinned to 1 CPU, 6 at once, 5 rounds | 6 runnable per CPU | 0. All 30 failed with `ENOENT` on `bin/pid`: the descendant was killed before it created the file, the far side of the same window (`logs/focus-desc.summary.txt`). |
| d1 | `c07b0bfc` | a real Squeal 0.1.110 daemon, 004-46's config without the slow project, started through `daemon-fg.mjs` from this cezar worktree: baseline tiers for 8 min 12 s, then `squeal stop` | ≤ 0.53 | n/a: the daemon survived and exited 0 |

*Verified by experiment.* Without contention the window in §3 never opened. With 3 runnable processes per CPU it opened once in 6.5 minutes, and only in `autosave-timeout.test.ts`. The guard does not record the file's contents. A target of 0 from `Number(pid)` means the line was empty, or whitespace only: `"".trim().split("\n")` is `[""]`. *Inferred.* On 2026-10-09 each death came about 20 s into a 200-file Vitest tier, at 5 to 7.6 load per CPU across the whole host. That is how the race could fire on 2 of 2 starts there.

### 5. The excluded candidates

- **Kernel OOM.** `/var/log/kern.log.1` runs from 2026-10-04T00:01 to 2026-10-10T22:07 (rsyslog). It has no "Out of memory", "Killed process" or "oom-kill" line, and neither do `kern.log.2.gz` to `.4.gz`. Its 16 lines on 2026-10-09 are AppArmor audits and one workqueue warning at 17:21:21 local, 6 minutes before the first death. In `syslog.1`, 17:25 to 17:30 local holds only cron and sysstat lines. The host has since rebooted (`oom_kill 0` in `/proc/vmstat`). `systemd-oomd` and `earlyoom` are inactive, and `cezar.service`'s cgroup has `memory.max` set to `max`. *Read in the logs.* Note that every agent child runs at `oom_score_adj` 200 and a daemon's RSS is about 0.5 to 0.9 GB, so a daemon would be the OOM killer's first choice. It just did not run.
- **Cezarion's worktree setup** (`origin/main`, `src/worktree-setup.ts`, `src/workflows/grouped-command.ts`, `src/workflows/run.ts:6441-6443` and `:8000-8085`). `runGroupedCommand` spawns `bash -lc` with `detached: true` and sends SIGTERM, then SIGKILL after 3 s, only to `-child.pid`, the group it created. `prepareWorktree` is awaited before the first agent step and runs in `state.cwd`, the run's own worktree; an in-place run gets none. No SessionStart hook can start a daemon inside it. In the run stores, no `worktreeSetup.startedAt` or `finishedAt` falls between 15:20 and 15:35 on 2026-10-09 in cezar, squeal, toolkit-dev or mvp-unveiled-july26. The nearest cezar setups ran at 11:42 (40.9 s) and 15:51 (81.0 s). Cezar's 54 recorded setups take 6.1 to 161.5 s, median 17.7 s. Today a scratch `npm ci` of cezar took 10.6 s at `ac1ea1a8` and 6 s at `c07b0bfc`, from a warm cache. *Read in source code and the run stores; verified by experiment.*
- **Cezarion's orphan reaping** (`terminateRecorded`, `run.ts:1129-1151`) signals only processes and groups recorded for a run, and its own cwd scan never signals a cwd-only match (`autosave-holders.ts`). The killed daemons' wrapper survived with its cwd inside the 004-46 worktree. *Read in source code.*
- **Squeal's D12 sweep** (`escaped.ts` at `98874f1`). It stops carriers of the daemon's own `SQUEAL_DAEMON_CHILD` mark and members of the daemon's own group, never itself. It sends SIGTERM, then SIGKILL after 1 s, and `afterRun` writes "stopped N processes ..." for each stop. Squeal's other SIGKILLs go to node:test groups it spawned. Notes are kept from 2026-10-04 (squeal store) and 2026-10-06 (cezar store). Between 15:24 and 15:31 the only stop note is the dogfood daemon stopping `tsc` (243206) at 15:28:27.854. This session's environment carries no Squeal mark. *Read in source code and the stores.*
- **The fake `gh`**: `ci-wait/fixtures/gh.mjs` contains no `kill`. See §1. *Read in source code.*

### 6. Verdict

The killer is cezar's `src/autosave-timeout.test.ts` `afterEach`. On an empty pid file it sends `kill(0, SIGKILL)` to its own process group, and under Squeal that group is the daemon's. The evidence: it was caught in the act under matched contention (§4, run3); the mechanism reproduces defect 16's exact signature (§2); the survivors fit a group kill (§1); and every outside sender is excluded (§5). Two more cleanups have the same shape and can do the same (§3). The cwd was not the cause. Load is the variable that moved with the deaths, and it opens the window.

The fix belongs to cezar (issue draft below). Squeal has a gap of its own. The daemon shares its process group with the test workers it hosts, so a test's group kill takes the daemon down silently. Status then shows a live daemon on a stale heartbeat, then "no daemon running since", with no cause.

### 7. Side finding: cezar's suite writes into the task that runs it

My guarded runs started Vitest from this task's worktree, with the agent's environment. They left three things behind:

- 3 lines "mock: implemented the change (dry run)" in this task's handoff file (`$CEZ_HANDOFF_FILE`), at 05:20:56, 06:00:25 and 06:15:17. `scripts/mock-claude.mjs:94-105` appends them when `CEZ_HANDOFF_FILE` is set. *Verified by experiment; read in source code.*
- `notes.md` in the worktree root, with 12 "mock notes" lines from 05:20 to 06:29, staged with `git add`, as were my uncommitted probe files. These came from the process cwd, which my probe left at the worktree. Under Squeal, Vitest runs with the tested root as its cwd, so this part is my probe's doing. *Verified by experiment; the Squeal part is inferred.*

I removed the lines and `notes.md` before committing. The handoff write is a second cezar issue, appended to the draft below. It also reaches a cezar suite run by a Squeal daemon, because the daemon keeps the environment of the session that started it. *Read in source code: `ensure.ts:155-157` and spec 001 D11, "inherits the environment of the hook that started it with no additions".*

## Recommendation for Squeal

1. No change to the sweep, the node:test runner or the start path. None of them sent this.
2. A small fix row, for the coordinator to weigh. When a worktree's recorded daemon is gone without its stopping note, status and the next hook should say so: "the daemon ended without shutting down at about <last heartbeat>, while run <id> ran <files>; a test that signals its own process group (`kill(0, ...)`) or a SIGKILL does this". The runs table already holds the unfinished run and its files. That turns the next defect 16 into a named file at once.
3. Not now: moving Vitest workers out of the daemon's group. Vitest's fork options have no `detached`. Isolation would need a runner host process in its own group, or a custom pool. That is a D12 redesign, out of proportion to one cezar test bug.

## Draft issue for cezar (for the human; not filed)

> **Title:** Test cleanups that read a pid file can SIGKILL the whole test run (`Number("") === 0` → `process.kill(0, "SIGKILL")`)
>
> Three Vitest cleanups kill the pid read from a file: `src/autosave-timeout.test.ts:45-47` (`afterEach`), `src/core/runner-shutdown-parity.test.ts:102-104` (`finally`) and `src/core/harness-autosave-settlement.test.ts:129-131` (`finally`). `src/headless-repo-handle.test.ts:68-69` does the same with SIGTERM. The files are written with `writeFileSync`/`appendFileSync` by the fake `git` and the mocks' leftover children (`scripts/mock-*.mjs`). Those calls open the file, then write. In between, and forever if the writer is killed there, the file is empty. `Number("")` is `0`, and `process.kill(0, sig)` signals the caller's whole process group: Vitest's main process and every fork worker. The `try { } catch { }` around it does not help, because the call succeeds.
>
> Seen as: a Squeal daemon hosting cezar's suite died by SIGKILL with no note, twice under heavy load (lessons defect 16 in the squeal repo). Squeal runs Vitest in its daemon, so the group is the daemon's. Reproduced at `c07b0bfc` with a preload that logs and drops own-group kills, running the `server` project pinned to 3 CPUs with 12 workers: `autosave-timeout.test.ts:47:23` called `process.kill(0, "SIGKILL")`. In a plain `npx vitest run` the same call kills Vitest and the shell job's other processes. In "terminates descendants after the Git leader exits", the fake `git` also exits as soon as the pid file *exists*, before it holds a pid, and the descendant it leaves is then killed by autosave's termination. That widens the window.
>
> Fix: one helper, `killFromPidFile(path, signal)`, that signals only a value matching `/^\d+$/` and greater than 1, and reads every pid line the same way. Write pid files atomically in the fakes and mocks: write to `<file>.tmp`, then `renameSync`. Optionally, a lint rule against `process.kill(Number(`.
>
> Second issue, seen while reproducing: `vitest.setup.ts` clears the host's `CEZ_*_BIN` and mode variables but not `CEZ_HANDOFF_FILE`, `CEZ_TODOS_FILE`, `CEZ_TASK_ID`, `CEZ_DELEGATION_URL`, `CEZ_DELEGATION_TOKEN`, `CEZ_TOOL_SOCKET` or `CEZ_TOOL_TOKEN`. A suite run inside a cezar task writes into the live task. Three runs of the `server` project from a task worktree appended "mock: implemented the change (dry run)" to that task's real handoff file, once per run, from `scripts/mock-claude.mjs` `writeHandoffAndTodo` (lines 94-105). A daemon started by a session hook inherits the same variables. Fix: delete every `CEZ_*` task variable in `vitest.setup.ts`, or allow-list the few a test sets itself.

## Open questions

- Which test of `autosave-timeout.test.ts` left the empty file, in run3 and on 2026-10-09. The guard records the caller, not the file. The 2026-10-09 run records went with the 004-46 worktrees. The fix in the draft covers every test of that file.
- Whether Squeal 0.1.69, rather than 0.1.110, makes a difference. d1 and the mini repository ran 0.1.110. The structure §1 relies on (detached daemon, in-process Vitest, detached node:test groups) is the same at `98874f1`.

## Sources

- Brief: `tasks/wave-13.md` "001-180 research"; board row 001-180; `../004-slow-suites/lessons.md` defect 16; `../004-slow-suites/research/probes/dogfood2/` (README, `logs/cz.start.txt`, `cz.daemon-fg*.txt`, `cz.poll.txt`, `czbc.setup.txt`, `sq1.timeline.txt`).
- 004-46 transcript: `~/.claude/projects/-home-agent-projects-squeal--ai-cezar-worktrees-58239afe-abaa-4600-a223-e812f96cb773/bfd3e50e-eb09-466e-90ca-78b1e60ad874.jsonl` (Bash calls at 15:25:16, 15:28:16, 15:34:27, 15:38:13, 15:40:07; results at 15:26:35, 15:26:52, 15:27:31).
- Cezar (`/home/agent/projects/cezar`, read through a clone at `/tmp/sq180-cz-94e1b872`, removed): `packages/cezar/src/worktree-setup.ts`, `src/workflows/grouped-command.ts`, `src/workflows/run.ts`, `src/delegation/process-liveness.ts`, `src/autosave-holders.ts`, `src/core/session-process.ts`, `src/ci-wait/github.ts`, `src/ci-wait/process.test.ts`, `src/ci-wait/fixtures/gh.mjs`, `src/preview/dev-server.ts`, the test files in §3, `scripts/mock-claude.mjs`, `vitest.config.ts`, `packages/cezar/vitest.config.ts`, `packages/cezar/vitest.setup.ts`; `.ai/cezar/config.json` (`worktreeSetup: { commands: ["npm ci"] }`).
- Vitest 4.1.10: `node_modules/vitest/dist/chunks/cli-api.BK8pd4xc.js:3084`.
- Squeal: `src/core/daemon/escaped.ts`, `src/core/daemon/terminate.ts`, `src/core/daemon/ensure.ts`, `src/core/daemon/signals.ts`, `src/runners/node-test/run/process.ts`, each at `HEAD` and at `98874f1` (0.1.69).
- Run stores: `/home/agent/projects/{cezar,squeal,toolkit-dev,mvp-unveiled-july26}/.ai/cezar/runs.db`. Squeal stores: `/home/agent/projects/{cezar,squeal,mvp-unveiled-july26}/.git/squeal/store.sqlite`.
- Host: `/var/log/kern.log.1`, `kern.log.{2,3,4}.gz`, `/var/log/syslog.1`, `/proc/vmstat`, `/sys/fs/cgroup/user.slice/user-1001.slice/user@1001.service/app.slice/cezar.service/memory.*`, `/proc/<pid>/oom_score_adj`.
- Probe: `probes/daemon-sigkill/README.md`.
