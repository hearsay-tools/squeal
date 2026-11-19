# 021-34: one daemon per project (per clone), design

Worker 5458ecdb, 2026-11-19. Brief: `../wave-9.md`, section 021-34. Shape: survey and design; no product code. Source read at `9c2efc64f` (0.1.566). Live daemons read only through `squeal ps`, `/proc` and their log files at 12:20Z to 12:40Z, load 16 to 19 on 24 CPUs; no socket opened, no signal sent. Scripts and the raw sample: `probes/` (throwaway). Tags: **[exp]** measured, **[src]** read in source code, **[inf]** inferred.

## Summary for the human

One daemon per project would fix one problem that we can now measure: the background processes of one repository wait for each other to write the shared results file. On the two busiest repositories each daemon sleeps in that wait for about a tenth of its time (cezar 10.1% with 8 worktrees at work; this repository 8.8% to 10.0% with 6 to 14), and cezar's logged waits add up to 25.5 hours of daemon time a day. The wait grows with the number of worktrees (cezar 2% with 4, 10% with 8), and shorter writes did not remove it, because each daemon now also does the writes the hooks used to do. One writer per repository removes these waits. A project daemon would also stop the restarts: 67% of this repository's 351 daemon starts a day restart a worktree whose daemon ended less than 10 minutes before, and in its first five minutes each start holds the shared write lock for 4 s here and 16 s on cezar on average. The memory saving is small: about 0.3 to 0.9 GiB for 6 worktrees, 3 to 8% of what Squeal uses. In October we rejected the idea for two reasons. The question then was memory, and the saving was 5 to 7%. Also, test runs ran inside the daemon, so one process could not serve two worktrees. Since then test runs have moved to their own processes and hooks have stopped writing, but the lock waits stayed. Three October objections still hold. One crash or hang stops every worktree of the repository (cezar: 13 daemons ended with no logged reason in 4.7 days). Every worktree must run one Squeal version (19 releases installed in 4.7 days). And one thread cannot do all the work: this repository's 6 daemons used 1.47 cores of main-thread time in one sample, more than one thread gives. So I propose steps. First, one writer per repository inside today's daemons. It gets the lock gain alone, and when the writer is gone, Squeal works as it does today. Build the project daemon itself, with each worktree's work in its own thread, only if that step's measurement and a profile show that it pays. With one writer, SQLite's lock stays as a safety net. It costs nothing when nobody else writes. A second writer that should not exist only waits, or fails within its time limit, and never damages the file. The writer serves a queue of writes on its own thread, so a long write (up to 29 s today) delays the writes behind it but not the answers to hooks.

## 1. What one daemon per clone improves

| Item | Today (source) | With one daemon per clone |
|---|---|---|
| Daemons asleep in SQLite's busy wait | cezar 2.0% (4 daemons), **10.1%** (8.4); squeal **8.8%** (9.1), 3.9% (3.5) (`one-daemon-gate.md` Q2); squeal **10.0%** of 540 main-thread samples, 6 daemons, 12:23Z **[exp]** | 0: one connection writes; a daemon thread never sleeps on another's lock **[inf]** |
| Logged busy episodes, 2026-11-14 20Z to 11-19 12Z | cezar 76,714, **25.5 h of daemon time a day**, p50 0.7 s, p90 6.9 s, p99 64 s; at least 38.5 h of it delayed "the next tier". Squeal 11,988, 0.9 h a day (`probes/busy-episodes.py`) **[exp]** | Gone as lock waits. Writes still queue behind one another in one writer, so a long write still delays the writes after it **[inf]** |
| Lock busy, 25-minute windows | cezar store 28.3%, code store 42.2%; squeal code store 46.5%; cezar store over 50% in 3 evening windows (gate Q1, Q3) | The writer is busy for about the same time, because the writes are the same. The difference is that nobody polls the lock **[inf]** |
| Writes lost to the lock | `complexity: database is locked` 4,692 (cezar), 646 (squeal); heartbeats that waited 30 s or more: 1,575 (cezar), 17 (squeal) (`probes/unlogged-ends.py`) **[exp]** | 0 for lock reasons **[inf]** |
| Prune | Every daemon prunes both shared stores 60 s after start and every hour: N daemons, N prunes (gate Q3) | One per clone. **Row 021-33 already does this without a project daemon** |
| Restarts of the same worktree | Squeal: 1,636 daemons served in 4.7 days (351 a day) for 273 worktrees; **1,091 (67%) started less than 10 min after that worktree's previous daemon ended** (gap p50 107 s). cezar: 1,117 (239 a day), 288 (26%) (`probes/restarts.py`) **[exp]** | A quiet worktree's state stays in the project daemon at tens of MiB, not a 200 to 375 MiB process, so a new session finds it warm **[inf]** |
| Work at each start | Long-write holds in a daemon's first 5 minutes: squeal 7,069 s of lock time, 2,412 s of it in restarts; cezar 17,349 s, 4,461 s in restarts. A start takes 7 to 13 s of daemon CPU on this repository in the first 50 s, beside 30 to 40 s in its Vitest host (`squeal ps`, 12:22Z) **[exp]** | The restart part goes away. The host's cold start stays: D20 closes idle hosts in any model **[inf]** |
| Memory | Daemons without hosts: squeal 6 daemons 4.6 GiB (268 MiB to 1.6 GiB each), cezar 2 daemons 0.9 GiB; Squeal in all 10.6 GiB (`squeal ps`) **[exp]**. Idle daemon 355 to 375 MiB before 021-28, which removed about 150 MiB (`daemon-heap.md`) | About 110 to 150 MiB of runtime, bundle, tree-sitter and allocator per extra worktree, minus 30 to 60 MiB per worker thread if each worktree gets its own thread: **0.3 to 0.9 GiB** for 6 worktrees, 3 to 8% of Squeal's memory **[inf]** |
| CPU budget and scheduler | The CPU budget is one per user and machine already (D18, the pool) **[src]** | No change. A clone daemon sees one repository, and the budget must span repositories (`daemon-model.md` Q4) |
| Edit tiers before other worktrees' backlog | No CPU priority today: all test processes run at `nice` 10 (`daemon-model.md` Q4) **[src]** | Within one clone only. The pool's marks can give the same priority across clones without a new process model **[inf]** |

**What it does not change [inf].** It does not shorten holds under host load (gate open question 2). A transaction that runs 29 s now still runs 29 s; it only stops others from polling meanwhile. It does not fix the prune's whole-table search under the lock (021-33 fixes it). The cost of a cold runner host (23 to 25 s on cezar, D20) stays.

## 2. What it costs or risks

| Risk | Measured today | With one daemon per clone |
|---|---|---|
| Event loop of N worktrees | Main-thread CPU used, summed per clone: **1.47 cores** for squeal's 6 daemons (90 s, 0.07 to 0.56 each, 12:23Z) **[exp]**. Main threads running: cezar 8.4 × 14.9% = 1.25 cores, squeal 9.1 × 12.4% = 1.13 cores (gate Q2) **[inf from exp]**. On 2026-11-11, with Vitest still inside: 8 × 72.5% = 5.8 cores | **One thread cannot carry a busy clone.** Runner hosts cut the main-thread load 4 to 5 times, but it is still above 1 core at peaks. What the main thread computes (keying, hashing, the code pass, revision apply, writes) has never been profiled (`daemon-model.md` open question) |
| Blast radius | 13 cezar daemons and 1 squeal daemon ended with no logged reason in 4.7 days (crash, kill, out of memory) out of 1,117 and 1,636 that served **[exp]** | Each such end would stop every worktree of the clone: cezar had 4 to 9 daemons at once in the gate windows. In one process with N times the work, the rate of such ends per process grows too **[inf]** |
| Mixed versions | 19 releases installed on this host in 4.7 days. Three versions live at once in the gate's window 2 (gate, header) **[exp]** | A clone runs one version. With today's step-down rule, one older session anywhere holds back the upgrade of every worktree (011-52 Q4). At 4 releases a day, and with worktrees active for up to 13 h at p90 (011-52 Q5), the clone would often wait **[inf]** |
| Per-worktree environment | The environment hash reads the daemon's own `process.version` (`src/core/keys/environment.ts:45`). Scratch cwd, `TMPDIR` and signals are per process (`scratch.ts`, `signals.ts`) **[src]** | Each worktree's environment descriptor and `execPath` come at registration from its hook and go to its runner hosts, as D8 already does for hosts. Key computation must take the worktree's descriptor, not the process's own |
| Harness delivery | Hooks reach `squeal-<worktree-hash>.sock`, answered by a front-desk worker thread within 100 ms (`front-desk.ts`) **[src]** | One socket per clone; each request names its worktree. The front desk already answers from memory, so the 100 ms budget is kept. A desk of N worktrees holds N snapshots **[inf]** |
| cgroup | The daemon stays in the unit of the harness that spawned it (011-52 Q4) | A stop of one harness's unit ends validation for every worktree of the clone |
| Migration | Two layouts, one release or more (011-52 Q4) | Per-worktree daemons of older hooks keep their worktrees until their sessions end |

## 3. What changed since October

| October (011-52, 2026-10-21) | Now |
|---|---|
| The question was memory. Saving 0.8 to 1.1 GiB, 5 to 7% of daemon memory; CPU under 0.2 core | The question is the lock. D16's gate is met on both clones, also without the prune (gate Q4). The memory saving is still small (0.3 to 0.9 GiB per 6 worktrees) |
| Vitest ran in the daemon: one cwd per process, so one process could not run two worktrees' tiers (011-52 Q2); 0.5 to 1.0 core of main thread per busy cezar worktree | Runner hosts are child processes with the worktree's cwd and environment (D8, D20). **This objection is gone.** Main thread per clone is now 1.1 to 1.5 cores, down from 5.8 |
| Hooks and CLI wrote the store; contention was not measured by holder | Hooks write through the daemon (D15). Hook holds fell from 4.5% to 0.1 to 0.4%, but **held time per daemon did not fall** (gate Q1). The waits are now daemon against daemon, and they grow with the number of daemons |
| Store broker priced as 103 closures rewritten as messages (`daemon-model.md` Q2 (b), 2026-11-11) | D15 built the general mechanism: `SendingConnection` keeps any transaction's statements and sends them as one batch to the daemon, with a per-worktree write lease and a fallback to direct writes (`tasks/021-16-notes.md`). **A single writer per clone no longer needs a new process** |
| Blast radius, mixed versions, per-worktree env | Still true. Releases are more frequent (19 in 4.7 days) |

**Where your earlier push was right.** The lock contention comes from many writers. Shorter transactions shrink each hold. They do not stop N processes from polling one lock, and the measured waits rise with N. Only one writer per clone removes them, and Squeal's repeated per-worktree work (prune, restarts, heartbeats on a shared file) points the same way. **Where it would be wrong now.** If "one daemon" means one process that does everything on one thread, it would be slower than today at peak (1.1 to 1.5 cores of main-thread work), and one crash would stop a whole repository. **What would decide it later.** A profile of a busy daemon's main thread. If its per-worktree work can drop to about 0.15 core, or can run in a thread per worktree, the full project daemon is feasible. If step 1 below removes the waits and the restarts cost little, the full project daemon is not needed.

## 4. The design

**Target process model [inf].**

- **Project daemon, one per clone.** It holds `<commonDir>/squeal/locks/clone.sqlite` and serves `squeal-<clone-hash>.sock`. The main thread owns the only write connections to `store.sqlite`, `code.sqlite` and `lint.sqlite`, the prune, the clone's heartbeat, in-memory claims, and the ordering of tier starts across worktrees (edit first). It runs no project code and no per-file work.
- **Worktree engine, one worker thread per registered worktree.** It holds the watcher, hashing, keying, the scheduler's queue and tiers, the code pass and the complexity counter. It reads through its own read-only connection, and it writes through a `SendingConnection` whose batches go to the main thread. It has its own event loop, so a busy worktree does not delay another worktree. It has a V8 heap limit (`resourceLimits`), so running out of memory ends only that engine. The main thread restarts an engine that misses its beat.
- **Runner hosts, unchanged (D8, D20).** These are child processes with the worktree root as cwd, and the environment and `execPath` that the worktree's hook sent at registration.
- **Front desk, unchanged in kind.** It is one worker thread for the socket. Each request names its worktree.

**Interfaces, in outline.**

| Interface | Messages |
|---|---|
| Hook or CLI → clone socket | `register {worktree, squealVersion, environment descriptor, execPath, env}` → `engine ready \| other version`; today's requests, each with `worktree` |
| Engine → writer (main thread) | `lease {worktree}`; `write {store, schema, batch}` → `written \| refused (schema) \| failed`; `claim {key}` → `owner`; reads stay local |
| Engine ↔ main | `beat`; `tier wanted {kind: edit \| backlog \| checkpoint}` → `go` (the per-user pool stays the CPU gate); status snapshot to the desk |
| Main → engine | `stop`, `quiet` (keep keyed state, close hosts), `step down` |

**Mixed versions.** The project daemon serves hooks of its own version. A newer hook asks it to step down once no older session's consumer remains, as today. Until then, the newer hook starts a per-worktree daemon for its own worktree. That daemon writes through the clone's writer when the schemas match (step 1's mechanism), and exits when they do not, as an older daemon already does.

**Migration, each step shipping alone.**

1. **One writer per clone, inside today's daemons.** The first daemon of a clone takes `<commonDir>/squeal/locks/writer.sqlite` and runs a writer thread. Every other daemon writes through a `SendingConnection` to that daemon's socket, with the same lease, batch, bound and fallback to a direct write that D15 gives hooks. When the writer daemon exits, the next daemon takes the lock. Users see nothing. The gain is the lock rows of section 1. The code cost is the audit of transactions that read inside themselves: of 157 transaction closures in `src`, at least 57 read inside the closure (`probes/transactions.py`, a text heuristic, so a lower bound). Rows that one worktree owns are covered by its lease. Cross-worktree rows (claims, content-keyed results, other worktrees' `known_states`) need statements that test the condition themselves, or a reply from the writer.
2. **Measure again.** Repeat the gate's busy wait and lock watch, and profile one busy daemon's main thread on a copy, away from this host's live population.
3. **Quiet worktrees keep their state.** Only if step 2 shows that the restart cost matters and the main-thread work fits in a thread per worktree: start the project daemon with engines in threads, and take each worktree's lock as its hook upgrades.
4. **Retire per-worktree daemons**, one release after step 3 has served every live session.

**Smallest first slice.** Step 1 for `code.sqlite` alone. It is the store with the busiest lock (cezar 42.2%, squeal 46.5%) and the 4,692 failed complexity writes. Its writers are mostly closures that only write (code pass, CRAP, coverage; `probes/transactions.py`: code/pass 7 of 7 and code/crap 5 of 5 only write; code/store 5 of 14 read). It holds no claims. Done when two daemons on one clone record complexity and coverage through one writer, the second daemon's busy wait on `code.sqlite` is 0, and a writer that exits mid-batch leaves the client to write directly within D1's bound.

## 5. Alternatives on the same numbers

| | Busy wait (10%) | Lock busy windows | Restarts (67% / 26%) | Memory per 6 worktrees | Event loop | Blast radius | Versions | Code cost |
|---|---|---|---|---|---|---|---|---|
| (0) Today + 021-33 + shorter holds (D3) | 5.9% / 7.9% left without prune (gate Q4) | lower; cezar evenings still over 50% | as today | none | as today | 1 worktree | per worktree | small |
| (0') + a longer session grace | as (0) | as (0) | fewer, at 200 to 375 MiB per kept daemon | costs memory | as today | 1 worktree | per worktree | small |
| (1) One writer per clone, in a daemon (step 1) | **0** | writer busy as long; no polling | as today | none | the writer's thread carries the writes: about 0.19 core a day on average, 0.7 at cezar's peak (held time, gate Q1, Q3) | writer exit: clients fall back to direct writes | batches carry the schema; another schema falls back | medium: 57 or more closures to audit |
| (2) Store broker as its own process (`daemon-model.md` Q2 (b)) | 0 | as (1) | as today | +85 to 100 MiB | as (1) | broker down: clients fall back | as (1) | (1) plus a process to keep alive |
| (3) Project daemon, one thread | 0 | as (1) | absorbed | −0.65 GiB | **over 1 core at peak: slower than today** | the whole clone | one per clone | large, no closure audit |
| (4) Project daemon, a thread per worktree (target) | 0 | as (1) | absorbed | −0.3 to −0.9 GiB | per worktree, as today | hangs and heap overflows: one worktree; a crash: the clone | one per clone, with guests | (1) plus engines and migration |

(1) is the cheapest step that removes the measured waits, and it is also step 1 of (4). (2) adds a process that (1) does not need. (3) fails on the event loop. (4) adds the restart gain and a small memory gain, at the cost of the blast radius and the version rules.

## 6. One writer: the lock and the write queue

**The lock stays [docs, inf].** SQLite always takes its file locks. No setting turns them off and still lets other processes read. `locking_mode=EXCLUSIVE` would keep hooks and `squeal status` out of the file. With one writer, the lock does three things:

- **Readers.** In WAL mode, readers (hooks, `squeal status`, the CLI) take a read mark in the `-shm` file. They never wait for the writer, and the writer never waits for them.
- **Checkpoints.** D4's `TRUNCATE` checkpoint needs all readers off old snapshots. It runs in the writer, so it no longer competes with other writers.
- **Recovery.** After a crash, the first connection rebuilds the WAL index under the lock (the #8 case). This happens once, then stops.

An uncontended `BEGIN IMMEDIATE` takes the lock in microseconds, so the safety net costs nothing.

**A second writer is safe [src, inf].** A second writer can still appear in three ways:

- an older-version daemon during the migration;
- D15's direct-write fallback, when a client finds no live writer;
- `squeal import` or a CLI write with no daemon serving.

Each one waits in SQLite's busy handler, and then gets `SQLITE_BUSY`. D1 and D2 retry within their bound, and D1 reports a failure honestly. SQLite's atomic commit does not let two writers interleave inside one file, so a second writer delays work but never corrupts it. The lock watch (D5) names such a writer. A queue does not replace the lock. It means that the lock is almost never contended.

**Step 1 as a write queue [inf].**

- **One write connection and one queue per store file.** There is one each for `store.sqlite`, `code.sqlite` and `lint.sqlite`. They are separate locks today, so a code-store write never waits behind a store write.
- **Batches.** Each daemon's transaction becomes one batch: D15's `SendingConnection` keeps its statements and sends them when the transaction ends. A batch is atomic: the writer runs it whole in one transaction, or fails it. The writer may merge small batches that are in the queue at the same moment into one transaction of at most 250 ms (D3's line), which means fewer commits.
- **Order.** Batches of one worktree keep their order, because a later batch may depend on an earlier one. Between worktrees and kinds, the writer takes edit-tier results and hook or CLI writes first, then tier records, ledger commits and revision apply, then reconciliation and code-store records, and the prune last, only when the queue is empty.
- **Off the main thread.** `node:sqlite` is synchronous: a 1.3 s write blocks the thread that runs it. The writer runs in a worker thread of the writer daemon, beside the front desk, which already answers hooks from memory (`front-desk.ts`). The writer daemon's own transactions go through the same queue as everyone else's. A long write then delays only the writes queued behind it. It does not delay that daemon's keying, its socket or its heartbeat. The client daemons do not block either: a send returns at once, and the answer comes later.

**What a long write costs [exp from gate Q3, inf].** Today on cezar's `store.sqlite`, writes over 250 ms have these lengths:

| | p50 | p90 | max | Count | Held a day |
|---|---|---|---|---|---|
| All long writes | 0.5 s | 1.3 s | 29 s | 10,356 over 1 s, 786 over 5 s | 9,192 to 13,883 s (11 to 16% of one thread) |
| Revision apply's closures | 1.3 s | | 29 s | | 10,539 s in 4.7 days |

In the queue model, such a write delays the writes behind it by its own length. That is the same delay they get today. The difference is that nobody sleeps in a busy wait, and the next write starts at once rather than at the waiter's next poll. Two things make a long write worse in one queue:

- One atomic batch of 29 s holds back edit-tier results of every worktree for 29 s. The fix is the one D3 already uses for import and prune: senders mark batches that may be split (tier records, coverage rows, prune), and the writer runs them in slices of at most 250 ms, taking edit-tier results between slices. A batch that must stay atomic, such as revision apply, runs whole.
- If holds grow with host load (gate open question 2), the queue grows with them. At cezar's peak the store and code-store writers were busy 28% and 42% of a 25-minute window. Each fits one thread, but with little room, so step 1's measurement must read the queue's wait time as well as its busy time.

**Two locks, and a stray writer's turn (coordinator, after the human's question, 2026-11-19) [inf].** Step 1 has two locks. The *writer role* (`locks/writer.sqlite`) is held for the writer daemon's whole life, hours; other daemons never need it, because they send their writes to its socket. The *database write lock* is SQLite's own and is held only for one transaction, at most about 250 ms after slicing, then released. A stray writer (an older daemon, the D15 direct-write fallback, `squeal import`) waits on the database lock only, and gets it in a gap between two of the writer's transactions. SQLite's busy handler polls with sleeps and does not queue fairly, so a writer that starts its next transaction at once can starve a stray writer (`store-contention.md`, `starve.mjs`). The writer must therefore leave a short gap between transactions while its queue is long, as row 011-350 (#220) already does for background writes, and step 1's tests must show a stray writer gets the lock within its bound while the queue is full.

## Open questions

1. What a busy daemon's main thread computes. The profile in step 2 decides between (1) alone and (4).
2. Whether holds grow with host load (gate open question 2). If they do, a single writer only queues writes and does not shorten them.
3. How much of a restart's work a warm project daemon really saves. The first-five-minute holds include the per-worktree keying that any registration does. Not separated.
4. Why 13 cezar daemons ended with no logged line. A crash, `kill -9` or the kernel's out-of-memory stop leave no line.

## Sources

- Spec 021 D8, D15, D16, D18, D20, D21; `status.md` to 2026-11-19; `tasks/021-16-notes.md`.
- Research: `one-daemon-gate.md`, `daemon-model.md` (Q1, Q2, Q4, Q6, Q7), `store-contention.md`, `cpu-ceiling-measured.md`, `daemon-heap.md`, `../../011-core/research/daemon-scope.md`.
- Source at `9c2efc64f`: `src/core/daemon/{front-desk,desk,write-batch,write-desk,sliced-writes,busy-writes,lifecycle}.ts`, `src/core/keys/environment.ts`, `src/core/delivery/{sending-connection,daemon-writer}.ts`.
- Live, read only, 2026-11-19 12:20Z to 12:40Z: `squeal ps`; `/proc/<pid>/{cmdline,stat,smaps_rollup}`, `/proc/<pid>/task/<pid>/{stat,wchan}`; `~/projects/{squeal,cezar}/.git/squeal/logs/daemon-*.log{,.1}` from 2026-11-14 20:00Z to 11-19 12:00Z.
- Probes, `probes/`: `main-thread-sample.sh` and its output, `busy-episodes.py`, `restarts.py`, `unlogged-ends.py`, `transactions.py`.
