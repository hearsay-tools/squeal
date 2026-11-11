# Research: daemon-model

Row 021-05, topic `daemon-model` of `README.md`. Researcher, 2026-11-11. It extends `../../011-core/research/daemon-scope.md` (011-52, 2026-10-21) and does not repeat it. It does not read `store-contention.md` or `runner-split.md`. Squeal source read at `1e8b62a10` (0.1.430). Live daemons were read only through `/proc` and `squeal ps`: no socket opened, no process signalled. Stores were copied to `$TMPDIR` and read with `node:sqlite` read-only. One-minute load during every live read: 41 to 68 on 24 vCPUs. No timing in this file is a measurement of run speed. Probes: `probes/daemon-model/` (throwaway).

Tags: **[exp]** verified by experiment, **[docs]** read in official docs, **[src]** read in source code, **[inf]** inferred.

## Questions answered

| # | Question | Answer |
|---|---|---|
| 1 | Today's model | A daemon owns one worktree: watcher, revisions, keys, queue, its Vitest instances in its own process, a store connection, its socket. Already per clone: the store and claims. Already per user: the CPU pool **[src]**. Every recorded lock error needs a second connection. Four failure kinds stay with one writer: checkpoint and recovery (#8), main-thread stalls (#176), success reported after a failed write (#108, #158, #162), an unretried refinement (#138) **[src]**. Live, cezar's 8 daemons slept in SQLite's busy wait in 21% of main-thread samples, and ran on the CPU in 72% **[exp][inf]**. |
| 2 | Candidate primitives | (a) project daemon: removes daemon-against-daemon waits; one event loop for a clone whose daemons use 0.5 to 1.0 core of main thread each today **[exp]**; blast radius the clone. (b) store broker: removes the waits too, but 103 synchronous transaction call sites on the store must become a write protocol **[src]**. (c) runner-host pool per host: no memory saving, because a Vite graph is per root (011-52); it fixes no lock failure **[inf]**. |
| 3 | Runner host | Start (handshake with versions and environment), list, closure, invalidate and affected, run (streamed), cancel, close; liveness from the transport. `RunnerAdapter` is already async and serializable except callbacks and abort signals **[src]**. Prior art agrees: stdio or one socket, a version handshake, one answer per cancelled request, liveness from the transport **[docs]**. |
| 4 | Scheduling across worktrees | A host budget must span repositories, so the per-user pool is the right scope, not a per-clone scheduler **[src][inf]**. In the last week a 16-vCPU background ceiling would have deferred 112 of 432 background core-hours (26%), for a median of 4.3 h; edit-tier wall time would fall 13% **[inf from exp]**. Edit tiers have no CPU priority over other worktrees' background tiers today: all test processes run at `nice` 10 **[src]**. |
| 5 | Store per primitive | One writer removes writer contention. It does not need another engine. Remote runner hosts never write: results return over the connection to the one local writer **[inf]**. |
| 6 | Migration | Five steps, each shipping alone: targeted fixes; runner host as a local child; the same over SSH; short-lived writers through the daemon; then, gated on a measurement, one daemon per clone **[inf]**. |
| 7 | Recommendation | The primitive is the **runner host**. Build it first, inside today's per-worktree daemon. Keep one daemon per worktree until runner hosts have landed and main-thread load and lock waits are measured again. One daemon per clone stays the target for the store's single writer, not the first slice. |

## Findings

### Q1. Today's model

**What one daemon owns [src].** `openDaemon` (`src/core/daemon/open.ts`) takes the worktree's exclusive lock (`<common>/squeal/locks/<worktree-hash>.sqlite`), opens the store, binds `/run/user/<uid>/squeal-<hash>.sock`, and adopts a scratch cwd and `TMPDIR`. The daemon then owns the watcher, the revision counter, hashing and keying (`src/core/scheduler/keying.ts`), the queue and tiers (`scheduler.ts`, `tiers.ts`, `slow-tier.ts`), the runner adapters (`runner-set.ts`, `composite-runner.ts`), a second Vitest instance for the slow lane (`slow-instance.ts`), heartbeat, pruning and exit rules (`lifecycle.ts`), and answers to `status`, waits and holds on its socket. Vitest runs in the daemon's process (019-04 Q1).

**Already shared [src].** Per clone: the store (decision 0002), including the content-keyed `results`, `test_files`, `checks`, `failure_texts` and observed-input `meta` rows; a daemon also writes other worktrees' `known_states` when a pass heals a key. Cross-worktree claims on keys go through the store and are polled every 250 ms (`claims.ts`, `CLAIM_POLL_MS`). Per user on one host: the permit pool and its marks under `$XDG_RUNTIME_DIR/squeal` (`src/core/capacity/pool.ts`, `marks.ts`), which spans every repository.

**Repeated per worktree [src][inf].** The Node runtime and Squeal's code (85 to 101 MiB with no runner, 011-52 Q1), one store connection, and the Vite module graph. The graph cannot be shared between roots (011-52 Q1). The watcher and keying are per worktree by nature: each worktree has its own files.

**Who writes the store [src].** Every daemon; every hook (`src/harness/shared/context.ts:95`, consumers and delivery, `BEGIN IMMEDIATE` held until the host has the text, `src/core/delivery/held-connection.ts:75`); and the CLI's `stop`, `start`, `hold`, `retry`, `import` and named `status --wait`. Writes are `BEGIN IMMEDIATE` (`src/core/store/connection.ts:47`). Busy timeouts: daemon 120 s while starting and 5 s after (`open.ts:44,54`), with 250 ms slices and retries for timer and pump writes; hooks 1 s; CLI 1 to 2 s. Nothing sets `wal_autocheckpoint`, so SQLite's default applies.

**The lock issues by cause [src].** Each row was checked against its issue, research file and the code path it names.

| Issue | Writer that waited or failed | With one writer per clone |
|---|---|---|
| #1 (closed), 011-126 (done), #138 busy part | daemon pass, pump or refinement against another connection; the holder was never named | gone |
| #86 (closed), #108, #158, #162 (#186 duplicate) | CLI `retry`, `start`, `stop`, `hold` against a daemon | gone, if CLI writes go through the writer |
| 011-113 (done) | a status read that wrote | gone; readers are read-only since |
| #8 / 011-01 (done) | readers failed by the last close's checkpoint of a large WAL, or crash recovery (`001-core-loop/research/issue-8-contention.md`) | **stays** |
| #176 | daemon start: heartbeat stalled for minutes; reproduced with a synchronous delay and no lock (`issue-176.md` Q3) | **stays** |
| #108, #158, #162 report defect | exit 0 or "done" after a failed write; `hold` launches the command anyway | **stays** for any write failure |
| #138 retry defect | a refinement that throws is never retried (`runner-work.ts:315`) | **stays** for any failure |

**Live reading [exp].** `squeal ps` at 14:26:55Z: 17 daemons (9 squeal, 8 cezar), all 0.1.430, 17.4 GiB, 6 flagged `hung` (heartbeat past two intervals), all 6 in cezar (`ps-snapshot.txt`). Main-thread state every second for 120 s (`wchan.txt`, load 52 to 68):

| | Samples | Running (R) | `hrtimer_nanosleep` | `ep_poll` (idle loop) |
|---|---|---|---|---|
| cezar, 8 daemons | 857 | 72.5% | 21.1% (per daemon 18 to 43%, one at 0%) | 4.9% |
| squeal, 9 daemons | 1,080 | 14.0% | about 1% | 80.9% |

**[inf]** A Node main thread in `hrtimer_nanosleep` is in a synchronous sleep. In the daemon the only one is SQLite's busy handler: Squeal's own synchronous waits use `Atomics.wait`, a futex wait, and only at the WAL switch in the daemon (`src/core/store/open.ts:188`). So cezar's daemons spent about a fifth of their main thread waiting for another connection's write lock. Over 30 s (`threads.txt`), cezar daemons' main threads used 0.46 to 1.00 core each, and their other threads under 0.11. One daemon (3767355) ran its main thread at 100% for the whole 120 s, with a heartbeat 4 minutes old. That is a stall in one process, not a lock wait. What the main thread computes (Vite transforms in the daemon, or keying) is not determined: it needs a profile of a live daemon, which the rules exclude.

### Q2. Candidate primitives

| | (a) Project daemon per clone, runner hosts as children | (b) Daemons per worktree + store broker per clone | (c) Daemons per worktree + runner-host pool per host |
|---|---|---|---|
| What it owns | watchers, keys, scheduler, the only store connection that writes, socket per clone; runner hosts per (worktree, runner), local or over SSH | the broker owns the only write connection; daemons keep the rest | a pool process hands runner hosts to daemons |
| Failures removed | daemon against daemon (21% of cezar main-thread samples), CLI against daemon, claims become in-memory | the same | none of Q1's: the store keeps its writers |
| Failures kept | Q1 rows marked "stays" | the same | all |
| Blast radius | a hang or crash of the event loop stops every worktree of the clone. On 2026-11-11 one cezar main thread ran at 100% for 2 min or more; under (a) that would have stopped 8 worktrees, not 1 **[exp][inf]**. A runner crash stays in its host | a broker hang stops writes for the clone; daemons keep watching and running but cannot record **[inf]** | a pool crash loses hosts for every repository **[inf]** |
| Mixed versions | one version per clone. A step-down waits until every session of the clone has a consumer at the new version (011-52 Q4). All 17 live daemons ran 0.1.430; whether worktrees overlap on different versions is not determined: the store keeps only each worktree's last daemon version | the broker's write protocol must accept every live daemon version, or daemons of another version exit (today a newer schema already makes an older daemon exit) | the host protocol must be versioned; pool and daemons upgrade apart |
| Config, `node_modules`, env | per runner host: cwd at the root, env and `execPath` from that worktree's hook, sent at registration; meets 011-52's cwd constraint | as today | per host, as (a) |
| Harness delivery | hooks reach one socket per clone, naming their worktree; hook writes go to the daemon | hooks write through the broker | as today |
| Memory against 011-52 | saves 0.8 to 1.1 GiB (011-52 design c); each runner host adds 26 to 46 MiB **[inf]** | adds one process of about 85 to 100 MiB per clone **[inf]** | no saving: graphs are per root **[inf]** |
| Code to change | the hooks' and CLI's writes move to the socket (8 transaction call sites in `src/cli` and `src/harness`, plus single statements). The other store transactions stay synchronous, in one process | the 103 synchronous `transaction(...)` closures on the store (`grep`, `code` and `lint` stores left out; 22 in `scheduler/`) become messages, because a closure cannot cross a process | a pool process and its protocol |

(b) removes the same failures as (a) at a larger code cost and with two processes to keep alive. (c) answers none of the store's failures and saves no memory.

### Q3. The runner host as a primitive

**What the scheduler needs [src].** `RunnerAdapter` (`src/core/types/runner.ts:576`) has `invalidate`, `affected`, `closure`, `enumerate`, `testFiles`, `environment`, `run`, `lane`, `releaseLane` and `close`, all `Promise`-returning with plain data. Four things do not cross a process: `RunOptions.signal` and `stop` (abort signals), `fileEnded` and `beforeForce` (callbacks), and `logDir` (an absolute local path). Each maps to a message: cancel, a streamed `fileEnded` event, a request back to the daemon, a log stream. In outline: `start` (protocol version, Squeal version, environment descriptor of spec 018 D1, capabilities such as `focuses`), `testFiles`, `closure`, `invalidate` and `affected`, `run` (streams file ends and results, ends with the `RunReport`), `cancel` (the run still answers once), `close`. A remote host returns relative paths only.

**Prior art [docs]** (quotes and versions in `probes/daemon-model/prior-art-quotes.md`, fetched 2026-11-11):

| Tool, version | Unit | Transport | Inputs | Cancel | Liveness, version | Crash |
|---|---|---|---|---|---|---|
| Bazel persistent workers (`worker_protocol.proto` `2acd34ba`) | per mnemonic and flags; multiplex per exec root | stdin/stdout, length-prefixed protobuf or one JSON per line | paths with advisory digests | opt-in; "must be answered exactly once" | no ping; per-action requirements | `--strategy=Javac=worker,local` |
| REAPI v2 (`c43de619`) | one action, any matching worker | gRPC, streamed `Operation` | `input_root_digest` in the CAS | optional `CancelOperation`; action timeout | `GetCapabilities` low and high version | `WaitExecution` reattaches |
| Buck2 (no version shown) | "1 daemon per project root" | gRPC; local workers over a Unix socket | daemon watches; REAPI digests remote | `buck2 kill` per tenant | binary version checked on connect | hybrid local and remote |
| Gradle 9.9.1, Develocity TD 3.8 | daemon per compatible JVM and version; agents in pools | local socket; WebSocket, agents dial out | daemon hashes inputs; TD copies declared inputs | interrupt, daemon exits after 10 s | exact version match | TD reschedules a partition on "another local or remote executor" |
| Pants 2.33 | pantsd per build root, one run at a time | nailgun port; REAPI remote | daemon watches | not in fetched docs | not in fetched docs | not in fetched docs |
| Vitest pool API 5.1.0 | `PoolWorker` per project and worker name | the implementer's; birpc | file paths; modules over RPC or disk | `cancel` message | 60 s start and stop timeouts, no version | "Worker exited unexpectedly" |
| LSP 3.17 | "one server serves one tool" | Content-Length JSON-RPC over stdio | client pushes changes | `$/cancelRequest`, must still answer | `initialize` capabilities; exits when its parent dies | client restarts it, capped |

**[inf]** The shape Squeal needs is LSP's and Bazel workers': one process per root, a framed JSON stream over stdio, a version and capability handshake, one answer per request even when cancelled, and liveness from the process or the SSH connection. Over SSH that stream is `ssh host squeal runner-host <root>`. The two systems that cross machines (REAPI, Test Distribution) name or copy inputs by content; the runner host's `start` and each `run` should name the revision's blob ids so the remote can prove its tree, the rule `remote-execution.md` set. Buck2 alone has one daemon per project root with workers apart, which is shape (a).

### Q4. Scheduling across worktrees

**Scope [src][inf].** cezar and squeal share this host. A scheduler per clone sees one repository's demand, so a host CPU budget must stay per user, as the pool already is. A project daemon would only make the clone's share of it in-memory. Today the pool gates backlog and checkpoint tiers. `gatedPermits` still grants while `grants < hostSlots / 2` at any load (`cores.ts:77`). Edit tiers take no permit. Every test process runs at `nice` 10 whatever its tier (`low-priority.ts`, `TEST_NICE`); a `"low"` run only adds `ionice -c 3`. So an edit tier in one worktree has no CPU priority over a backlog tier in another.

**What a host-wide budget would have done in the last week [inf from exp].** `budget.py` over runs of cezar and squeal (store copies 14:25Z) and sar from 2026-11-04 14:30Z to 2026-11-11 14:20Z (937 samples, 234 above 16 busy vCPUs). Background CPU is Squeal's `%nice` times the background share of its running files. Deferred work waits in a queue and runs when the host is under the ceiling.

| Ceiling | Background core-h | Deferred | Samples deferring | Wait of deferred work, median / p90 | Still queued at the end | Edit-tier wall, all 3,838 tiers | Edit tiers above the ceiling, median |
|---|---|---|---|---|---|---|---|
| 16 | 432 | 112 (26%) | 232 | 4.3 h / 10.0 h | 8.7 core-h | 12.3 h to 10.8 h (−13%) | 6.1 s to 4.8 s (1,884 tiers) |
| 14 | 432 | 166 (38%) | 314 | 5.5 h / 18.7 h | 9.4 core-h | 12.3 h to 10.5 h (−15%) | 5.8 s to 4.6 s (2,352 tiers) |

The edit-tier figures apply 011's slowdown curve (`load-slowdown.md` finding 1) to the load with the deferred work removed. How much deferred work a later revision would have made moot, and so dropped, is not determined: the store does not record why a queued tier was cancelled. The budget's gain (about 0.2 h of edit-tier wall per day) is of the size of `load-slowdown.md` finding 4 (0.19 h/day). It does not touch the larger cost there, the time to the first answer.

### Q5. Store under each primitive

**(a)** One write connection per clone, in the project daemon. No writer contention. Readers in CLI and hooks keep WAL snapshots and still meet #8 (checkpoint by the last close, recovery); a checkpoint policy owned by the one writer answers that. Long write transactions (11 to 67 s for one 198-file tier record on cezar, comment at `open.ts:46-53`) no longer fail other processes, but still block the writer's own event loop. SQLite stays sufficient; another engine is not needed for contention **[inf]**. **(b)** The same for SQLite, with the broker as the writer and every daemon a client. **(c)** Unchanged: as many writers as today. **Remote runner hosts, in any primitive:** a host never opens the store. Its `RunReport` and observed inputs come back over the connection, and the local writer records them after the blob-id proof and the environment check (`remote-execution.md` Q3, Q4). This matches the styleguide rule that a runner writes nothing to the store itself **[src][inf]**.

### Q6. Migration

Each step ships and works alone **[inf]**.

1. **Targeted fixes, no new process.** Honest reports and retries after a failed write (#108, #158, #162), a retried refinement (#138), a checkpoint policy (#8; engine and policy belong to `store-contention`). The pool: a busy-core ceiling for background tiers without the `hostSlots / 2` floor (`load-slowdown.md` recommendation 1), and a lower priority for background tiers than for edit tiers. Users see nothing new.
2. **Runner host as a local child.** The daemon starts one host per runner it uses and talks to it over stdio. A Vitest crash or a blocked transform no longer stops the daemon's socket and heartbeat. Users see one more process per worktree in `squeal ps`.
3. **The same host over SSH**, the slice `runner-split` defines.
4. **Short-lived writers through the daemon.** Hooks and CLI send writes to the serving daemon's socket and write directly only when none serves. Remaining writers: the daemons.
5. **One daemon per clone, if a measurement asks for it.** After step 2, measure main-thread CPU per worktree and lock waits again. If waits stay near today's 21%, a project daemon takes each worktree's lock as its worktree's hook upgrades. Older daemons keep their worktrees until their sessions end (011-52 Q4). During the move a user with several worktrees sees some served by the clone's daemon and some by their own, in one `squeal ps`.

### Q7. Recommendation

**The primitive is the runner host:** one process per (worktree root, runner), started by the scheduler, local or `ssh host squeal runner-host <root>`, speaking a framed JSON protocol shaped by `RunnerAdapter`: `start` with versions, capabilities and the environment descriptor; `testFiles`, `closure`, `invalidate`, `affected`; `run` with blob ids and a deadline, streaming file ends and returning a `RunReport` of relative paths; `cancel` answered once; `close`. It is the only piece that all three designs, the remote runner and 011-52's design (c) have in common.

What it fixes: the remote runner's cut, a runner crash or hang inside the daemon, and the cwd constraint. It is also the precondition for one daemon per clone, whose event loop could not carry today's 0.5 to 1.0 core of main thread per busy cezar worktree. What it does not fix: the lock waits between daemons (21% of cezar main-thread samples) and the Q1 failures that stay with one writer. Step 1 fixes those it can; step 4 removes hooks and CLI as writers; step 5 removes the waits between daemons, if they are still measurable.

Smallest first slice: step 1 (no new process), then step 2 for the Vitest adapter alone, behind the existing `RunnerAdapter` interface, with no SSH. Cost to a user: 26 to 46 MiB per worktree and nothing to set up.

## Open questions

- What a cezar daemon's main thread computes at 0.5 to 1.0 core: Vite transforms in the daemon or keying. Not determined: it needs a profile of a daemon on a cezar-size worktree, outside the live population. Step 2's value and step 5's feasibility both depend on it.
- Whether worktrees of one clone run different Squeal versions at the same time. Not determined: the store keeps only each worktree's last daemon version.
- How much deferred background work later revisions would have made moot. Not determined: the store does not record why a queued tier was cancelled.
- For the human: is a background result that arrives a median 4.3 h later (ceiling 16) acceptable in exchange for 13% less edit-tier wall time?

## Sources

- Earlier files: `../../011-core/research/daemon-scope.md`, `../../011-core/research/load-slowdown.md`, `remote-execution.md` Q1 to Q4, `../../001-core-loop/research/issue-8-contention.md`, `../../011-core/research/issue-138.md`, `issue-162.md`, `issue-176.md`; issues #1, #8, #86, #108, #138, #158, #162, #176, #186 (`gh issue view`, read-only, 2026-11-11).
- Source at `1e8b62a10`: `src/core/daemon/{open,daemon,lifecycle,runner-set,low-priority}.ts`, `src/core/store/{open,connection,schema}.ts`, `src/core/capacity/{pool,cores,marks}.ts`, `src/core/scheduler/claims.ts`, `src/core/types/runner.ts`, `src/harness/shared/context.ts`, `src/core/delivery/held-connection.ts`, `src/cli/{stopped-mark,hold,store-writes}.ts`.
- Live host, read-only, 2026-11-11 14:26 to 14:32Z: `squeal ps`; `/proc/<pid>/task/<pid>/{stat,wchan}`, `/proc/<pid>/stat`, `/proc/loadavg`.
- Store copies 14:25Z: `~/projects/{cezar,squeal}/.git/squeal/store.sqlite*` and `runs/*/report.json`; sar `/var/log/sysstat/sa04` to `sa11`.
- Docs and source fetched 2026-11-11 (versions in the Q3 table): https://bazel.build/remote/persistent, https://bazel.build/remote/creating, https://bazel.build/remote/multiplex, https://raw.githubusercontent.com/bazelbuild/bazel/master/src/main/protobuf/worker_protocol.proto, https://raw.githubusercontent.com/bazelbuild/remote-apis/main/build/bazel/remote/execution/v2/remote_execution.proto, https://buck2.build/docs/concepts/daemon/, https://buck2.build/docs/users/remote_execution/, https://docs.gradle.org/current/userguide/gradle_daemon.html, https://docs.gradle.org/current/userguide/worker_api.html, https://docs.develocity.ai/test-distribution/3.8/, https://www.pantsbuild.org/stable/reference/global-options, https://vitest.dev/advanced/pool and `vitest` `v5.1.0` `packages/vitest/src/node/pools/`, https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/.
- Probes: `probes/daemon-model/` (README there).
