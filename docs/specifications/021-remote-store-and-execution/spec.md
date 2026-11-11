# Store contention and runner hosts, local and over SSH

Stage: approved by the human 2026-11-11 ("Spec 021: Approve, build"; remote lost: "Run locally"). Written 2026-11-11 from `research/store-contention.md`, `research/runner-split.md`, `research/daemon-model.md` and `research/cpu-budget.md`, after the human's "Spec all five steps".

## Problem

Two problems share one cause: every worktree's daemon does everything in one process, and every process writes one SQLite file.

1. **The store fails under contention.** One clone has one store file. Every daemon, every hook and eight CLI commands write it, and SQLite admits one writer at a time. More than 40 lock failures are on record (`store-contention.md` Q1). Two classes are open. One-shot CLI writes give up after 1 to 2 s and do not retry: `hold` reports nothing on hold and still runs the command (#162, #186), `stop` reports success without its mark (#158), `start` cannot clear the mark (#108); about 20 reports since 2026-11-06. Daemon writes outside the retry path leave a revision applied late or a file without a key (#138, row 011-104). Live, cezar's daemons held the write lock 55% of one 4-minute window in holds up to 1.2 s, hooks held it 0.9 to 1.8 s to write one page, and cezar's daemons spent 21% of their main-thread samples in SQLite's busy wait (`store-contention.md` Q3, `daemon-model.md` Q1). No incident since 2026-10-09 named the holder.
2. **Test runs cannot leave the daemon.** The Vitest instance runs inside the daemon process (019-04). A runner crash or a blocked transform stops the daemon's socket and heartbeat; on 2026-11-11 one cezar daemon's main thread ran at 100% for 2 minutes with a heartbeat 4 minutes old (`daemon-model.md` Q1). And test runs cannot move to another machine. This host was above the slowdown knee (16 busy vCPUs) in 10 to 43% of samples per day from 3 to 10 November; test runs were 82% of busy CPU, and Squeal's background tiers 94% of Squeal's work above the knee (`remote-execution.md` Q1).

The human rejected moving the whole workspace to another machine ("just shrugging off the problem") and asked for "a good primitive that could contain this properly".

## Goals

1. No one-shot command reports success after a failed store write, and none fails on a lock whose holder ends within its bound (#162, #186, #158, #108).
2. No daemon write that can be busy is lost or left unretried (#138, 011-104).
3. The longest regular holders are shorter, and any write transaction over 250 ms names itself in the daemon log, so the next incident names its holder.
4. **The runner host** is the primitive: one process per worktree root and runner, which hosts the project's own runner adapter and answers a small protocol over its stdin and stdout. The daemon drives it the same way as a local child or as `ssh <host> squeal runner-host <root>`.
5. A runner crash or hang no longer stops the daemon.
6. A user can send one runner's background tiers to one SSH host they name, opt-in. A remote result is stored only when the remote tree is proven equal to the revision and the remote environment equals the local one.
7. Hooks and CLI commands write through the serving daemon, so the daemons are the only regular writers.
8. A measurement, after goals 1 to 7, decides whether one daemon per clone is needed.
9. Nothing is tuned to this host (the human, 2026-11-07).

## Non-goals

- A live or remote store, or another engine. The git-ref route of spec 018 shares main's results (`store-service.md`); no engine on the list gives multi-process concurrent writes Squeal can ship (`store-contention.md` Q4).
- Splitting the store file into per-worktree files. Only if the lock stays busy more than about half the time after this spec (`store-contention.md` Q6), with its cross-file atomicity cost.
- One daemon per clone. Goal 8 measures whether it is needed; its design is a later amendment (`daemon-model.md` Q6 step 5).
- Mutagen, rsync on every save, or any sync tool beside the protocol (`remote-execution.md` Q3: Mutagen's `flush` reported success with stale and missing files).
- Machines started on demand (boat.dev and others). SSH is the surface they share (`remote-execution.md` Q5); a later spec may start one and hand its SSH target to D11.
- Edit tiers on a remote host, and coverage on a remote lane, in this spec.
- A shared pool of runner hosts across repositories (`daemon-model.md` Q2 (c): it fixes no store failure and saves no memory).

## Design

### Part 1: the store, one file, used correctly

#### D1. One-shot writers retry and report honestly

`hold`, the `stop` mark, the mark clear in `start`, and `start`'s handoff claim use the bounded retry of row 011-212 (`whileBusy`, `src/cli/store-writes.ts`): 2 s per try inside a 10 s bound. When the write does not land within the bound:

- `hold` does not start the held command. It exits non-zero and names the holder when D5 can (#162).
- `stop --until-start` exits non-zero: "could not record the stop: the store is busy" (#158).
- `start` exits non-zero when the mark is still there (#108).

A test holds `BEGIN IMMEDIATE` in a second process for 1.5 s (the fixture holder of `store-contention.md` Q3) and for longer than the bound, and checks both outcomes for each command.

#### D2. Daemon writes go through the retried path

Revision apply, refinement apply, socket requests that write (retry, promote, focus, group, full suite), `#reconcilePaths`, CI import, `#register`, the baseline's ledger commit and shutdown use the sliced, retried path of 001-422 (`src/core/store/busy.ts`) instead of one 5 s wait. A refinement that throws is queued again, not dropped (#138; `runner-work.ts:315`). A revision whose apply is still busy stays pending and is applied by the next pass, never skipped (011-104).

#### D3. Shorter holds

- The hook's hand-off hold (`delivery/held-connection.ts`, row 011-288) no longer waits on `code.sqlite` or for the host to read its output while it holds `store.sqlite`. Whatever it reads from the code store, it reads before it takes the write lock. The rule it protects (a report is marked delivered only once the host has it) stays; how is the worker's choice, within: no wait on another file and no wait on the host inside the hold.
- Any write transaction that holds the lock for more than 250 ms writes one daemon log line with its operation name, duration and rows written (2026-11-11: frames cannot be read without dropping the lock; see status). This finds the daemons' 0-frame holds of up to 1.2 s (`store-contention.md` open question 1).
- Import (`transfer-import.ts`) and prune write in slices like tier records.

#### D4. WAL size

The store sets `journal_size_limit` and the daemon runs a `TRUNCATE` checkpoint when it has been idle for a minute and holds no read. This bounds the WAL (cezar's was 443 MB beside 4.0 GB) and the recovery work that failed readers in #8. Values are the worker's, measured on a copy of cezar's store.

#### D5. Naming the holder

`squeal ps --locks` (Linux) lists the processes that hold or wait for each store's write lock, from `/proc/locks` on byte 120 of the `-shm` file, without opening the database (`store-contention.md` Q3, `probes/store-contention/lock-watch.mjs`). The busy messages of D1 name the holder's pid and command when this source exists. Elsewhere they say the holder is not known.

### Part 2: the runner host

#### D6. The process and its protocol

`squeal runner-host <root> --runner <name>` is a process that builds the project's own adapter for one runner over one root (`createVitestAdapter`, `createNodeTestAdapter`, `createPytestAdapter`), with the root as its working directory (`runner-split.md` Q2: otherwise failure text changes). It never opens the store. It speaks request and reply over stdin and stdout, one JSON object per line, each line starting with a fixed marker; its own stdout and every library's go to stderr (`runner-split.md` Q3).

Messages, shaped by `RunnerAdapter` (`src/core/types/runner.ts`):

| Message | Answer |
|---|---|
| `start` with protocol version, Squeal version, policy values (the adapter's `exclude`, `observe` and similar options as data) | the environment descriptor (spec 018 D1), the values of the synchronous members (`slowWidth`, `tierWidth`, `focuses` and the rest), capabilities |
| `testFiles`, `enumerate`, `closure`, `invalidate`, `affected` | the adapter's answer, paths relative to the root |
| `blobs` with paths | the git blob id of each path, or absent |
| `run` with files, run options and the expected blob ids of each file's closure | streamed `fileEnded` events, then the `RunReport`, observed inputs, the blob ids of closure and observed paths after the run, and the run's log files |
| `cancel` | the cancelled run still answers once |
| `close` | the host closes its adapter and exits |

Events from the host: `note` and `optimizer` (today's callbacks), and a new values message when an instance restart changes a synchronous member. `beforeForce` runs on the host. Every request has a deadline the daemon sets. When its input ends, the host stops its run and its workers and exits (`runner-split.md` Q6: 1.5 s in the prototype). Protocol versions are compared at `start`; a host of another Squeal version is refused.

Prior art for this shape: the LSP's process per root and the Bazel worker protocol (framed JSON over stdio, a handshake, one answer per cancelled request), Develocity Test Distribution for declared inputs and path mapping (`daemon-model.md` Q3, `runner-split.md` Q7).

#### D7. The daemon's side

A proxy adapter implements `RunnerAdapter` by sending these messages. It is one more `create` under `createRecoveringRunner` (`src/core/daemon/daemon.ts`). Watcher, hashing, keys, scheduler, store, the stability check and delivery stay in the daemon. The synchronous members answer from the values the host last reported. A host that exits or misses a deadline is a run that did not complete (`crashed` or `timed-out`, every check of the tier `unknown`); the recovering runner starts a new host.

#### D8. Local runner hosts first

The daemon starts its Vitest runner as a local runner host child: same messages over a pipe, no SSH. Its environment and `execPath` come from the worktree's hook, as the daemon's do today. node:test and pytest follow in later rows of this spec, by the same cut (`runner-split.md` Q5). Cost: 26 to 46 MiB per worktree and runner (`daemon-model.md` Q7), one more process in `squeal ps`. Nothing for the user to set up.

### Part 3: a runner host over SSH

#### D9. Opt-in, and where the target lives

A remote lane is off by default (vision principle 8). The SSH target is per user, not per repository, because a host name and its access are the user's: a user-level setting names, per repository (by its remote URL or path), the SSH target, the runner and the lanes it serves. The repository's `squeal.config.json` may forbid remote lanes. `squeal status` names the target whenever a lane is remote. Exact names and file are the first row's choice, listed in open question 1.

#### D10. The tree on the remote

- First connect: the daemon sends every tracked and every non-ignored untracked file of the worktree, never an ignored one (`remote-execution.md` Q3: Mutagen copied a git-ignored `.env`). The remote root is a directory the host owns under its cache directory, one per local worktree.
- Each revision: the daemon sends the changed paths with their bytes and blob ids in one message; the host writes them and answers `invalidate` and `affected` (`runner-split.md` recommendation 2: two messages per revision).
- Dependencies: the host installs from the lockfile with the project's package manager when the lockfile's blob differs from its last install. This runs the project's install scripts on the remote, as tests run its code there; the opt-in of D9 covers both. A failed install is the existing runner failure ("vitest/node does not resolve ...").

#### D11. Proof and environment

A remote result is stored only when both hold:

1. **The tree is proven.** The host's blob ids of the run's closure, before and after the run, and of its observed inputs after the run, equal the revision's (`runner-split.md` Q3; the remote form of `changedSince`). A difference is a refusal: nothing is stored, the daemon sends the files again and retries once.
2. **The environment is equal.** `compareEnvironment` (spec 018 D1) of the host's descriptor against the local one answers `equal`. 018's `passes` tolerance for CI does not apply. A difference is a refusal and status names it ("remote Node v24.21.0, this worktree v24.22.1"). Without this rule a remote on another Node patch version passed under the local key (`runner-split.md` Q6).

#### D12. Which work goes remote

The first remote lane carries background tiers (start and restart baselines, backlog) of one runner, Vitest first. Edit tiers stay local. Coverage is off on the remote lane until a later row converts coverage payloads to relative records on the host (`runner-split.md` Q2).

#### D13. When the remote is lost or hung

Every message has a deadline; nothing else notices a hung remote (`runner-split.md` Q6, `remote-execution.md` Q6). A run on a lost or hung remote ends incomplete: its checks are `unknown`, never a failure and never a pass. Then the policy decides, set per project by the user (the human, 2026-11-11: "Policy setting"; default "Run locally"):

- `local` (default): the lane's files run locally, under the CPU budget of D18, and status says "remote <target> unreachable since <time>; running here". The daemon tries to reconnect with backoff and moves the lane back when the remote answers.
- `not-run`: the lane's files stay not run, and status says "remote <target> unreachable since <time>; N files not run".

#### D14. Squeal on the remote

At first connect the daemon copies its own runtime bundle over the same SSH connection to `<remote cache>/squeal/<version>/`, verifies a checksum, and starts `squeal runner-host` from there (the human, 2026-11-11: "Daemon copies itself"). A version already present is reused. Node on the remote is the user's; D11's environment check refuses a different Node version. Squeal never installs Node, never edits the remote's shell profile, and never reads or forwards credentials: SSH runs as the user's `ssh` with the user's own configuration.

### Part 4: writes through the daemon

#### D15. Hooks and CLI send writes to the serving daemon

When a daemon serves the worktree, hooks and the writing CLI commands (`stop`, `start`, `hold`, `retry`, `import`, named waits) send their writes to its socket, and the daemon writes them in its own retried path. They write the store directly only when no daemon serves, with D1's bound. The daemons are then the only regular writers. `daemon-model.md` Q2 counts 8 transaction call sites in `src/cli` and `src/harness` to move.

### Part 5: the gate for one daemon per clone

#### D16. Measure, then decide

After Parts 1 to 4 have shipped and run for a week, a research row repeats `store-contention.md` Q3's lock watch and `daemon-model.md` Q1's main-thread sampling on the same stores. If daemons still wait on each other's lock in more than 5% of main-thread samples, or the lock is busy more than half of a 25-minute window, the coordinator proposes one daemon per clone (`daemon-model.md` Q2 (a)) as an amendment, for the human. Otherwise this spec ends here.

### D17. Status and `squeal ps`

`squeal ps` lists runner hosts under their daemon, local or remote with the target. `squeal status` names a remote lane, its last proof or refusal, and an unreachable target (D13). Busy messages name the holder (D5).

### D18. A CPU budget for background runs

From `research/cpu-budget.md` (row 021-06), a replay of 2026-11-04 to 2026-11-11 on recorded runs and sar history.

**What a budget does, measured by replay.** The human asked whether a ceiling would finish work sooner because runs stop competing. For CPU, yes: Squeal spends 9.5% less CPU, because each background file costs 7% less on a quieter host and 2.5% of background work need not run once a later revision or a removed worktree overtakes it. Agents' own test runs get 8.8% faster and edit tiers 6.4% faster; host time above 20 busy vCPUs halves (13.2% to 6.7%). For background results, no: every budget delivers them later on this host, a median 9 s and a p90 2.4 min per tier, backlog p90 30 to 47 min. Other load alone sat at 12 cores or more in 106 of 107 samples above 20 busy, so background's own work rate still rose with each core it took. A budget finishes background work sooner only where Squeal's background alone pushes a machine past its throughput peak, such as a quiet laptop (`cpu-budget.md` Q1, Q4).

**The budget.** The adaptive own-slowdown controller of `../011-core/research/background-backoff.md`, not a fixed ceiling, as first written (2026-11-11: the human is open to a machine-derived ceiling; see status):

- Signal: the pooled median ratio of each recent file run's duration to that file's own fast reference, across the user's daemons on the machine. It needs no core count and sees a container's CPU quota.
- Control: halve the background budget after two 60 s windows in a row above θ = 1.25; add one permit after a window at or below it; never above `hostSlots`.
- Scope: one budget per user and machine, in the pool directory, across every daemon and repository. It governs backlog tiers and baselines. Edit tiers, named waits and agents' runs stay outside it and feed the signal. The `grants < hostSlots / 2` term in `src/core/capacity/cores.ts` goes.
- Floor: one permit for the oldest waiter, so background work never stops. Without it, edit tiers gain 11.2% instead of 6.4% and backlog p90 grows to 59 min (`cpu-budget.md` Q6 item 3).
- A remote runner host (Part 3) counts against its own machine's budget, with its own per-file references (`cpu-budget.md` Q5).
- The daemon log records each budget step (time, budget, signal, record count). A row after it ships measures on this host and one other machine: CPU per file against its reference, background tier finish, edit-tier wall, and whether background alone passes the peak there.

The budget is sold as protection for foreground work and less CPU, not as faster background results.

## Slices

Each row ships and works alone.

| Row | Part | What |
|---|---|---|
| 021-07 | 1 | D1, the one-shot writers |
| 021-08 | 1 | D2, daemon writes in the retried path |
| 021-09 | 1 | D3 and D4, shorter holds, the 250 ms log line, WAL size |
| 021-10 | 1 | D5, `squeal ps --locks` and named holders |
| 021-11 | 2 | D6 to D8, the runner host and the local Vitest host |
| 021-12 | 2 | node:test and pytest as local runner hosts |
| 021-13 | 3 | D9, D10, D14, the SSH connection, the tree and the bundle |
| 021-14 | 3 | D11 to D13 and D17, proof, environment, lanes, failure policy and status |
| 021-15 | 3 | proof on a real second machine: this repository over a real network (cost: a machine the team has, or a boat.dev sandbox; the human's choice) |
| 021-16 | 4 | D15, writes through the daemon |
| 021-17 | 5 | D16, the measurement |
| 021-18 | budget | D18, the adaptive background budget, with its log line |
| 021-19 | budget | D18's measurement on this host and one other machine, after a week |

021-07 to 021-10 touch disjoint files and can run in parallel. 021-11 can run beside them. The holder lookup of D5 has a contract file, `src/core/store/lock-holders.ts`, committed before wave 1 so 021-07 and 021-10 can build against it. 021-13 and 021-14 follow 021-11. 021-18 can run beside Part 1.

## Testing

- Part 1: a second process that holds `BEGIN IMMEDIATE` for chosen times, against each one-shot command and each daemon write path (D1, D2). The six-worktree fixture of `store-contention.md` Q3 as an end-to-end test of D1. D5 on Linux against a known holder.
- Part 2: the protocol against a fake adapter (framing, marker, deadline, cancel answered once, input end stops the run). The proxy against the real Vitest adapter over a pipe, with the existing runner tests, so the local host gives the same results as today's in-process adapter.
- Part 3: an end-to-end test against a container with `sshd`, `HOME` under a temporary directory: first connect copies the bundle; an edit runs remotely; a tree difference is refused and retried; a different Node is refused; a paused container ends the run `unknown` within the deadline; `not-run` and `local` policies.
- No test reaches the real `HOME` or `~/.ssh`.

## Open questions

1. **Where the SSH target lives (D9).** A user-level file per repository is proposed; the name and format are the first row's choice, reviewed in its candidate.
2. **D18's floor**: one permit (proposed) or none, a product value (`cpu-budget.md` Q6 item 3).
3. **The real-network proof (021-15):** a team machine or a boat.dev sandbox ($20 minimum a month by its docs). The human chooses when the row starts.
4. **Coverage on a remote lane**: a later row, after 021-14.

## References

- Research: `research/store-contention.md` (021-03), `research/runner-split.md` (021-04), `research/daemon-model.md` (021-05), `research/remote-execution.md` (021-02), `research/store-service.md` (021-01).
- `research/cpu-budget.md` (021-06).
- Earlier: `../019-run-triggers/research/remote-runner.md` (019-04), `../011-core/research/daemon-scope.md` (011-52), `../011-core/research/load-slowdown.md`, `../011-core/research/background-backoff.md`.
- Decisions: `docs/decisions/0002-content-keyed-shared-store.md`; spec 018 D1 (environment descriptor), D14 (the git-ref reader).
- Issues: #1, #8, #86, #108, #138, #158, #162, #176, #186; rows 001-422, 011-104, 011-212, 011-288.
