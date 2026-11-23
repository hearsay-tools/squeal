# Research: boat-sandboxes

Topic `boat-sandboxes` of `README.md`. Researcher cdbcd98f, 2026-11-23 (times UTC). It extends `../../021-remote-store-and-execution/research/remote-execution.md`, `runner-split.md` and `boat-trial.md` and does not repeat them. Squeal source read at `1bbd7b4c5` (0.1.611). boat CLI 1.0.103; boat.dev docs fetched 2026-11-23. Five sandbox starts (`new`, `fork`, `resume`, `new`, `fork`), all `--no-env`, all deleted; 0.80 plan hours used (about $0.03). Throwaway probes and raw output: `probes/boat-sandboxes/` (`results/other.txt` holds the numbers read off the terminal). This host's one-minute load stayed between 3.5 and 14.6 (16 CPUs) during the session.

Tags: **[exp]** verified by experiment, **[docs]** read in official docs, **[src]** read in source code, **[inf]** inferred.

**Verdict.** A per-worktree sandbox can run every tier fast enough, but only on some machines. On a Ryzen 9 9950X sandbox, edit to verdict over a kept SSH connection was 1.1 s for one Vitest file and 3.1 s for ten, coverage on or off. On a Ryzen 7 9700X sandbox the same runs took 10.5 s and 41 s, with 6 to 11 false timeout failures. D5 of `boat-trial.md` is a property of the machine, not of `fork`: a fresh sandbox on a 9700X was as slow as the forks (34 to 38 ms per disk flush, against 0.1 ms on the 9950X). boat.dev does not let a user pick the CPU, and 9 of the 16 benchmark runs in `bench/results/TREND.md` and 3 of today's 4 machines were 9700X.

## Questions answered

| # | Question | Answer |
|---|---|---|
| 1 | 2A, 2B or hybrid | 2A keeps hooks, the store, its cross-worktree reuse and offline cheap checks local, and needs a remote environment key for macOS. 2B gives Linux keys that match CI but loses the shared store and needs a local process for hooks anyway **[src][exp][inf]** |
| 2 | Warm snapshot, fork, `.git` | Fork to SSH-ready 7.8 and 8.7 s, with `.git` and `node_modules` in place (021's first connect: 44 to 52 s). 10-file delta 118 to 156 ms. The 3 Git test files from D2 pass on the fork (27 of 27 tests) **[exp]** |
| 3 | `ascii-lazyfs` and `dsync` | The fork is slow (17 to 93 ms per 4 KiB `dsync` write over 21 minutes, no recovery), but so is a fresh sandbox on the same CPU type. The cause is the 9700X machines' disk flush, not the fork **[exp]** |
| 4 | Edit to verdict, all tiers | Fast machine: Vitest 1 file 0.88 to 1.49 s, 10 files 2.88 to 3.16 s, node:test 1 file 0.19 to 0.23 s. Coverage on adds nothing measurable; its wire event is 1.0 MB for 1 file, 1.5 MB for 10. Slow machine: 9.5 to 12.2 s and 37 to 44 s **[exp]** |
| 5 | Mutagen, delta sync, `boat push` | Squeal's own delta (changed files on `invalidate`, blob proof) is enough for both shapes. In 2B Mutagen's proof gap becomes a freshness gap that still needs local blob ids. `boat push` is not incremental: 13.0 s to resend 334 MB for one changed file **[exp][docs][inf]** |
| 6 | Cost, limits, sizing, lifecycle | Default $0.036/h, small $0.018/h. Create, fork and resume each count as one start (200/day on the $20 plan). Auto-stop is a TTL from start or resume, not idle time. Solo developer about $10 to $19 a month; a 12-worktree coordinator host $52 to $207 a month and above the $20 plan's start limit **[docs][exp][inf]** |
| 7 | Gaps and recommendation | Seven gaps (list in Q7). Recommend a hybrid on the 2A shape, opt-in, with a disk check at connect. No row before the human decides the slow-machine question **[src][inf]** |

## Findings

### Q1. 2A against 2B

| | 2A: thin local daemon, remote runner hosts | 2B: whole daemon in the sandbox |
|---|---|---|
| Local CPU and RAM | Daemon only, if planning moves remote too. Today the lane keeps planning local: `affected`, `closure`, `testFiles` and `environment` call the local adapter (`remote/lane.ts:403-407`), so a local Vitest host stays warm (278 to 561 MiB for Squeal, up to 2.4 GiB for Squawk on this host, `squeal ps`) **[src][exp]** | A hook and a sync process. A hook cannot open SSH per call: a new `boat ssh` took 0.74 to 1.95 s, a new ssh process over a kept ControlMaster 145 to 173 ms. So 2B also needs a local process that holds the connection **[exp][inf]** |
| Hook latency | Unchanged, local store **[inf]** | One round trip per hook at best: 36 ms ping to the sandbox, about 150 ms through a new ssh process. Under the 2 s timeout, above the 80 ms target **[exp][inf]** |
| Cross-worktree reuse (decision 0002) | Kept: one store under the git common directory **[src]** | Lost: each sandbox has its own store. A fork copies the base's store at snapshot time; results do not flow between sandboxes after that **[inf]** |
| CI import, macOS laptop | Today the lane refuses a remote whose platform or arch differs, at connect and at each run (`remote/environment.ts:39-52`; descriptor fields `environment-descriptor.ts:136-137`), so a macOS laptop never uses it. CI re-keying tolerates only `watch`, `coverage` and `browser` (`environment-descriptor.ts:220-262`), so darwin never matches Linux CI either **[src]** | Sandbox and CI are both Linux x64: a CI export matches when Node and the install match. This is 2B's one clear gain on macOS **[inf]** |
| `status --at`, `proof` | Spawn local daemons in a local `git worktree` checkout (`src/cli/status-at-run-child.ts`, `status-at-daemons.ts`); each would upload its own full tree **[src][inf]** | Run where `.git` is; nothing new **[inf]** |
| Coverage | Forced off remote (`remote/connect.ts:207`). Payload paths are remote and absolute; no converter exists **[src]** | Local to the daemon; nothing crosses **[inf]** |
| Offline or lost | Edit-time complexity and lint go on; tests run here or stay `unknown` by D13 policy **[src]** | Nothing but "unreachable" **[inf]** |

### Q2. Experiment A: warm snapshot and fork

Base: `boat new --no-env`, ready in 1 s on a 9950X. Node 26.13.0 in 4 s. A git bundle of `HEAD` plus 265 `squeal--v*` tags (169 MB) copied in 5.0 s, cloned in 12.1 s; `pnpm install --frozen-lockfile` in 10.1 s (651 MB `node_modules`, 169 MB `.git`). Stop took about 4 s to a completed snapshot (607 MB, 71,453 files after clone and install) **[exp]**.

| Start | Command returned | First SSH | Hydrated | CPU |
|---|---|---|---|---|
| fork 1 | 6.6 s | 7.8 s | 21 s after create | Ryzen 7 9700X |
| fork 2 | 6.9 s | 8.7 s | 28 s after create | Ryzen 7 9700X |
| resume of the base 4 min after its stop | 0.64 s | 1.6 s | not restored: same machine, same endpoint | Ryzen 9 9950X |

**[exp]** `git status` on the fork was clean: boat.dev rewrites each Git index under the sandbox home (`~`) at start and downloads `.git` first (readiness.md: "boat updates the Git index of each repository under" the home "(up to 4 folders deep)") **[docs][exp]**. The three D2 files (`test/evals/fake-daemon`, `test/policy/repository-inputs`, `test/keys/key-format`) passed on the fork, 27 of 27 tests **[exp]**. A 10-file delta over a kept connection: tar.gz (15 KB) 118 to 156 ms, a diff through `git apply` 118 ms; the driver's `invalidate` carrying the 10 files 96 to 474 ms **[exp]**.

### Q3. Experiment B: `dsync` and `test/capacity`

200 writes of 4 KiB with `oflag=dsync`, and the virtual disk's flush time from `/proc/diskstats` **[exp]**:

| Sandbox | ms per write, `/tmp` / home | ms per flush | 10 `test/capacity` files |
|---|---|---|---|
| base, fresh, 9950X | 1.4 / 1.1 | n/a | 1.9, 2.0 s; 72 of 72 pass |
| base resumed, same 9950X | 0.35 / 0.52 | 0.14 | not run |
| fork 1 at once, 9700X | 93 / 28 | n/a | 57 s, 7 fail; 72 s, 15 fail (5 s timeouts) |
| fork 1 at 3 to 21 min | 17 to 93 (monitor, 33 samples) | 21.5, then 16.7 | 28 s at 21 min; 72 of 72 pass |
| fork 2 at once, 9700X | 93 / 20 | 22.7 | 26 s; 72 of 72 pass |
| fresh 2, `boat new`, 9700X | 123 / 60, then 69 / 65 | 38.3, then 34.4 | not run |

After hydration `/home` is ext4 on `/dev/vda1` and the `ascii-lazyfs` mount is under `/var/lib/ascii-lazy/retired/`, so writes do not pass through FUSE **[exp]**. The fresh 9700X sandbox never ran `ascii-lazyfs` and was the slowest. So the answer is: `boat fork` landed on 9700X machines twice, and those are slow; the fork itself is not the cause **[exp]**. Ordinary unit tests do not notice: 021's set B took 6.9 to 7.6 s on fork 1 and 5.6 to 8.7 s on the resumed 9950X **[exp]**. Benchmark history agrees weakly: the Store area's median score is 53 on 9 runs on 9700X, 67 on 5 runs on 9950X, 75 on each EPYC run, across different versions and cells (`bench/results/TREND.md`) **[inf]**. 021 D5's machine was not identified.

### Q4. Experiment C: edit to verdict

`probes/boat-sandboxes/driver.mjs` drives `squeal runner-host --tree` on the sandbox over one ssh connection, with the 021 D6 protocol: the edit's bytes ride on `invalidate`, then `affected`, `closure`, the blob proof (`expected`) and `run`. Edits append a comment to test files; "src" edits `src/core/capacity/quiet-demand.ts` and runs its one direct test file. Ranges over 5, 3 and 2 edits **[exp]**:

| Machine | 1 test file | 10 test files | 1 source file |
|---|---|---|---|
| 9950X, coverage off | 0.88 to 1.49 s (median 1.12) | 2.88 to 3.16 s | 1.04, 1.62 s |
| 9950X, coverage on | 0.89 to 1.69 s (median 1.12) | 1.73 to 1.94 s | 0.74, 0.78 s |
| 9700X (fork 1), coverage off | 9.5 to 12.2 s | 37.0 to 43.7 s, 6 to 11 false failures | 7.1, 9.9 s |

Of a 1.12 s median, the run is 0.78 s and Vitest's own duration 0.47 s; `invalidate` 0.10 s, `affected` 0.15 s, `closure` 0.07 s. The first `affected` of a new host took 6.7 to 9.7 s (module graph), so a sandbox must be warmed before the agent's first edit. One `run` reply was 12 KB (1 file) and 54 to 86 KB (10 files) **[exp]**. node:test through the host, one file: 0.19 to 0.23 s on both machines; bare `node --test` 85 to 110 ms **[exp]**. `boat exec` answered in 83 to 141 ms per command, faster than a new ssh process but one HTTP call per command, with no stdin stream for the protocol **[exp]**.

Coverage: the host's `coverage` event carried 1.03 MB for one file and 1.47 MB for ten (each executed source's code and source map, once per run) **[exp]**. The raw V8 payload stays a file on the sandbox that no local writer can read (`code/coverage/types.ts:56-57`) **[src]**. A compact record is about 25 KiB per file (`src/core/code/store/schema.ts`, via `runner-split.md` Q1). Mapping payloads to records on the host was not run: no such code exists. At the 34 MB/s measured for `scp`, even the 1.5 MB event costs about 45 ms **[inf]**.

### Q5. File sync

**Both shapes need Squeal's own delta.** In 2A the shipped protocol already does it: whole changed files, gzip and base64, on `invalidate`; a proof by git blob id before and after the run (`remote/tree-wire.ts`, `host.ts` `runOf`) **[src]**. In 2B the remote result is right for the remote's content (decision 0002), but a local hook still has to know whether the sandbox has the agent's latest edit. That needs the local blob ids of changed files, which is all a delta sender needs **[inf]**.

**Mutagen in 2B.** What improves: the remote daemon sees writes through its own inotify watcher, so `flush` no longer has to prove anything to Squeal **[inf]**. What stays: no `.gitignore` reading, so `.env` reaches the sandbox; 10 s polling for cold files on a Linux laptop; `flush` returning 0 with stale or missing files, which now means a hook can report a verdict for content the agent has already changed; a hung remote seen only by Squeal's own deadline; SSPL parts and no release since 2025-02-24 (`remote-execution.md` Q3, Q6, Mutagen v0.18.1, not re-run) **[exp][src] from 021**. These still disqualify it **[inf]**. A thin local git-aware watcher sending changed files and blob ids over a kept ssh pipe did a 10-file delta in about 0.1 s here **[exp]**.

**`boat push`** copies only files Git tracks or does not ignore ("In a git repository, only the files git tracks or does not ignore", `boat push --help`) **[docs]**. It is not incremental: pushing an 18,162-file copy took 14.4 s, and again with one file changed 13.0 s with the same 334 MB reported. A one-file directory took 0.88 s **[exp]**. It is a first-copy tool at best.

### Q6. Cost, limits, sizing, lifecycle

Read in `boat limits --all` and docs.boat.dev (llms.txt, pricing.md, long-running-tasks/auto-stop.md, readiness.md, snapshots/whats-saved.md, ssh-access.md) **[docs][exp]**:

- Sizes: small 2 vCPU / 4 GB $0.018/h; default 4 / 8 GB $0.036/h; large 8 / 16 GB $0.072/h. $20 plan: 555.56 default-hours, 100 sandboxes at once, starts 12/min, 60/h, 200/day. $100 plan: 30/min, 210/h, 840/day. "Create, fork and resume each count as one start"; above the limit $0.03 to $0.07 each.
- Auto-stop "counts from creation or from the last resume, not from your last activity", default 1 h, up to 30 days or off. A 15-minute idle stop is Squeal's job (`boat stop` when idle).
- Stop: no pause; "boat keeps the machine 10 minutes": a resume inside it got the same machine in 1.6 s **[exp]**. After that each resume and fork is a new machine, new IP and new host key; `boat ssh` re-pins it per sandbox in its own `known_hosts` file with a `HostKeyAlias` **[exp]**. Disk kept at least 14 days; 10 saved snapshots per $20.
- `~/.cache` is not saved; `.boatignore` (not `.gitignore`) leaves folders out of snapshots.
- RAM: a new default sandbox used 932 MiB of 7,941 MiB. Vitest at 4 workers over `test/scheduler` (346 files) peaked at 2,333 MiB used **[exp]**. On this host a Squeal daemon holds 295 to 331 MiB; the busiest Squawk worktree holds 1.4 GiB plus a 2.4 GiB Vitest host **[exp]**. Small (about 3 GB free) fits a 2A runner host for Squeal; a 2B Squawk worktree needs default **[inf]**.

Monthly cost, 22 working days for (a), 30 days for (b), default size; small halves the money **[inf]**:

| Case | Sandbox hours | Cost | Starts |
|---|---|---|---|
| (a) solo, 3 worktrees, 8 h/day, idle stop after 15 min, 50 to 100% busy | 264 to 528 | $9.5 to $19.0, inside the $20 plan | about 24/day at one resume per worktree-hour |
| (b) coordinator host, 12 worktrees (10 to 15), 16 h/day, 50 to 100% busy | 2,880 to 5,760 | $104 to $207 | 384/day at one resume per 30 min: above 200, needs the $100 plan |

### Q7. Gaps in `src/core/runner-host/remote/` **[src]**

1. **Tiers.** Only backlog and turn tiers that are not promoted are `background` (`scheduler/tiers.ts:364-366`); `goesRemote` also refuses slow, group and beside lanes (`remote/lane.ts:76-79`); `remote.json` accepts only `"lanes": ["background"]` (`remote/settings.ts:150-152`). Edit, catch-up joined to an edit tier, and slow tiers need these changed, and the slow lane a remote instance of its own.
2. **Runners.** `remote.json` accepts only `"runner": "vitest"` (`settings.ts:146`), and the daemon wraps only Vitest (`remote/daemon-lane.ts:90`). The host already builds node:test and pytest (`protocol.ts:22`); their start options carry local `tempDir` and `cacheDir` paths.
3. **Planning stays local** (`remote/lane.ts:403-407`), so a local Vitest host stays warm. A thin daemon needs `affected` and `closure` from the host (measured 0.1 to 0.5 s and 0.04 to 0.7 s).
4. **Coverage** is stripped (`remote/connect.ts:207`). Needed: map payloads to relative `CoverageRecord`s on the host and send records, as 021 D12 planned.
5. **Environment of record.** The lane needs `equal` against the local descriptor, so darwin to Linux is refused at connect. Running on a macOS laptop needs results keyed under the remote's descriptor, a second key space in one store; that also makes them match Linux CI exports **[inf]**.
6. **Sandbox lifecycle.** Nothing starts, forks, warms, stops or re-pins a boat.dev sandbox; 021 left on-demand machines out. Needed: fork from a warm snapshot, wait for the first `affected` before edits, idle stop, a new host key per start.
7. **Slow disks.** Nothing measures the machine. A `dsync` check at connect (0.2 s on a good machine, 4 to 25 s on a slow one) could mark a sandbox slow and keep sync-heavy files local, or refuse it.

## Recommendation for Squeal

1. **Hybrid on the 2A shape, opt-in.** Keep the daemon, the store, hooks and cheap edit checks local. Send all test tiers and all runners to one sandbox per worktree, forked from a warm snapshot with `.git`, through the shipped runner host and delta protocol. This keeps decision 0002's reuse and offline behaviour and measured 1.1 s edit to verdict on a good machine. Mutagen and `boat push` add nothing.
2. **Do not build it before the slow-machine question is answered.** On 9700X machines the same edit took 10.5 s and stored false failures. Until boat.dev can pin a machine class or fix the flush, every start is a lottery that favoured the slow class 3 times in 4 today.
3. **2B only for macOS users who want CI reuse**, and only as a documented setup ("run agent, clone and Squeal in the sandbox"), as 021 Q2 (b) said. It loses the shared store and still needs a local process for hooks.

## Open questions for the human

1. Ask boat.dev whether a sandbox can be placed off the slow machine class, or whether its flush latency is a known issue? Without it, a remote edit tier is not dependable.
2. Is a second key space acceptable (results keyed by the sandbox's Linux environment in a macOS user's store)? It is the price of 2A on macOS.
3. For the coordinator host, is $100 to $210 a month plus the $100 plan for starts acceptable against the local load it removes?

Not determined: whether all 9700X hosts are slow (3 sandboxes, possibly one physical host); payload-to-record mapping time on the host (no code); pytest through the host (not run); RSS of the runner host alone during a run (the probe summed the wrong process names; memory in use is reported instead).

## Sources

- Experiments: `probes/boat-sandboxes/` (scripts, `results/`), 2026-11-23, sandboxes `bx_unkn32fy`, `bx_zmx5h9sv`, `bx_epwnfmhy`, `bx_4e696bh8` (deleted).
- boat.dev, fetched 2026-11-23: https://docs.boat.dev/llms.txt, /readiness.md, /snapshots/resume-and-fork.md, /snapshots/whats-saved.md, /ssh-access.md, /long-running-tasks/auto-stop.md, /pricing.md, /machines.md; `boat --help` and subcommand help (CLI 1.0.103); `boat limits --all`.
- Squeal at `1bbd7b4c5`: `src/core/runner-host/{protocol,host}.ts`, `src/core/runner-host/remote/{lane,settings,connect,environment,daemon-lane,tree-wire,tree-host}.ts`, `src/core/scheduler/tiers.ts`, `src/core/keys/environment-descriptor.ts`, `src/core/code/coverage/types.ts`, `src/cli/runner-host.ts`.
- Earlier: `../../021-remote-store-and-execution/research/{remote-execution,runner-split,boat-trial}.md`, `../../021-remote-store-and-execution/spec.md`, `bench/results/TREND.md`, `bench/boat-run.sh`.
