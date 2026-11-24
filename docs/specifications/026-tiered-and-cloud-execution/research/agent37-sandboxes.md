# Research: agent37-sandboxes

Topic `agent37-sandboxes` of `README.md` (round 2). Researcher 5a55435a, 2026-11-23 23:50 to 2026-11-24 00:35 UTC. It extends `boat-sandboxes.md` and reuses its probes unchanged, so the numbers compare directly. Squeal `62e4e3b56` (0.1.611) cloned on each instance. Agent37 docs fetched 2026-11-23 (`llms.txt` and the pages under Sources); template `agent37-base`, image `base:2026.10.24a`; agent37 CLI 0.4.1 read, not run. Three instances at 4 vCPU / 8 GB / 10 GB disk and two forks, all deleted; `GET /v1/instances` and `GET /v1/ssh-keys` returned `{"data":[]}` at the end. Spend $0.051 (99 awake minutes). Probes and raw output: `probes/agent37-sandboxes/`. This host's one-minute load was 22 to 32 (24 vCPUs) during the session; only round trips and the SSH driver ran here, and the load is beside each of those numbers in `results/`.

Tags: **[exp]** verified by experiment, **[docs]** read in official docs, **[src]** read in source code, **[inf]** inferred.

**Verdict.** Agent37's EU `vm` type is the best remote runner host measured so far for Squeal: edit to verdict over a kept SSH connection was 0.61 s for one Vitest file and 1.50 s for ten (boat.dev on its good 9950X machines: 1.12 s and 2.9 to 3.2 s), with no slow-disk lottery across 3 VMs and a fork. The US `default` type (gVisor) is 3 to 4 times slower and stored 5 false failures in one 50-file run. The EU `performance` type was slower than `vm` on this sample, not faster. Agent37's weak points are start latency of a warm copy (fork 44 to 55 s, against boat.dev's 8 s) and the client side of SSH.

## Questions answered

| # | Question | Answer |
|---|---|---|
| 1 | Create, fork, sleep and wake; EU rejects `default` | Create 0.96 to 1.24 s, all three types. Fork of a warm instance (1.7 GB used) 44 s (gVisor) and 55 s (vm). Wake from sleep: 0.68 to 1.14 s through `exec`, 1.65 to 4.47 s through a new SSH connection; processes survive. EU `default` returns `400 invalid_request` as documented **[exp][docs]** |
| 2 | `dsync` and `test/capacity` | Every type is on the boat.dev 9950X side of D5: 0.22 to 0.87 ms per 4 KiB `dsync` write in the home, 10 `test/capacity` files in 1.7 to 3.6 s, 72 of 72 pass every time **[exp]** |
| 3 | Edit to verdict over SSH and `exec` | EU vm median 0.61 s (1 file), 1.50 s (10 files), 0.71 s (1 source file); EU performance 0.71, 1.87, 0.75 s; US gVisor 2.16, 5.58, 2.83 s. node:test 0.20 to 0.22 s (EU), 0.58 to 0.70 s (gVisor). The vendor tunnel ignores `HTTPS_PROXY`; a 90-line replacement worked with ControlMaster and the runner-host framing **[exp][src]** |
| 4 | CPU consistency, gVisor effects | EU vm: steady 4 cores, 0.1% steal. EU performance: 15 to 30 k MB per 5 s window, 2% steal. gVisor: half the per-thread speed, slow process spawns; `nice`, process groups, WAL, `fs.watch` and `realpath` all work **[exp]** |
| 5 | Cost, limits, recommendation | 4/8 awake: default $0.012/h, vm $0.030/h, performance $0.048/h, plus $0.09 per GB-month of disk while asleep. Solo $11 to $19 a month on vm; 12-worktree host $98 to $184. No start limit; an awake-memory limit instead. Recommend Agent37 EU `vm` behind a provider-agnostic SSH runner-host driver, not gVisor **[docs][exp][inf]** |

## Findings

### Q1. Create, fork, sleep and wake

| Step | US `default` (gVisor) | EU `vm` | EU `performance` |
|---|---|---|---|
| `POST /v1/instances` returns `running` | 1.03 s | 1.24 s | 0.96 s |
| Node 26.13.0 / `git clone` (344 tags) / `pnpm install` | 7.1 / 50.2 / 18.1 s | 2.0 / 22.5 / 5.6 s | 2.5 / 24.2 / 9.5 s |
| `POST /fork` (synchronous `201`) to first `exec` | 44.5 s | 55.5 s | not run |
| Fork state | `git status` clean, 27 of 27 Git tests pass | same | |
| `POST /sleep` returns | 1.2, 1.4 s | 4.5 to 6.4 s | 5.2 s |
| Wake by `exec` (plain `exec` 0.18 to 0.56 s) | 1.14 s | 0.68 s | |
| Wake by a new SSH connection (plain 0.74 to 1.65 s) | 2.36 s | 1.65 s | 4.47 s |

**[exp]** One sample per wake cell. A process started before the sleep was alive after every wake, and on the EU vm `/proc/uptime` advanced 8 s across more than 65 s of wall time: the memory checkpoint was restored, not rebooted. The docs warn that a wake "rebuilds the instance instead" when the checkpoint cannot be restored or the instance moved host **[docs]** (`instance-auto-sleep.md`).

The EU `default` create returned `400 invalid_request`: "Europe runs VM and Performance instances only: send "type": "vm" or "performance", or create in US." **[exp]** The docs say so in two places: "`us` is the only region that runs every instance type" (`instances/create.md`) and "The default gVisor instance type cannot run a Docker daemon" (`vm-instances.md`) **[docs]**. So gVisor is US-only; EU work runs on KVM VMs. The workspace had the $5 starter credit only (tier 0); `vm` and `performance` creates worked on it, as `vm-instances.md` says ("which the $5 starter credit covers for every size") **[exp][docs]**.

Fork copies the disk, not memory, and "boots fresh with the same files" **[docs]** (`instances/fork.md`). At 44 to 55 s for 1.7 GB used, it is about 6 times slower than boat.dev's snapshot fork (7.8 to 8.7 s), and slower than a fresh create plus clone plus install on the EU vm (about 31 s). A warm pool of sleeping instances (wake 0.7 to 1.7 s) does what boat.dev's fork does **[inf]**.

Two things woke a sleeping instance during the test and had to be removed: an SSH ControlMaster with `ServerAliveInterval 30`, and a log poller calling `exec` every 20 s **[exp]**. The docs agree: "Keepalives keep bytes moving, so an auto-sleep instance stays awake for as long as you are connected" (`ssh.md`) **[docs]**. A remote lane must close its connection to let the instance sleep **[inf]**.

### Q2. Disk sync and `test/capacity`

200 writes of 4 KiB with `oflag=dsync` (`../boat-sandboxes/dsync.sh`), ms per write, at the start and the end of the suite **[exp]**:

| Instance | `/tmp` | home | 10 `test/capacity` files (2 runs) | 3 Git files |
|---|---|---|---|---|
| US default, gVisor | 0.011, 0.015 (tmpfs) | 0.31, 0.50 (9p gofer) | 3.2, 3.6 s; 72/72 | 20.0 s |
| US default fork | 0.011 | 0.22 | 2.5, 2.4 s; 72/72 | 13.7 s |
| EU vm | 0.52, 0.22 (overlay) | 0.37, 0.24 (ext4 on `vdc`) | 1.7, 1.7 s; 72/72 | 4.6 s |
| EU vm fork | 0.87 | 0.71 | 2.5, 2.1 s; 72/72 | 8.1 s |
| EU performance | 0.68, 0.27 | 0.51, 0.33 | 2.0, 1.8 s; 72/72 | 5.3 s |
| boat.dev 9950X (`boat-sandboxes.md`) | 1.4; 0.35 resumed | 1.1; 0.52 resumed | 1.9, 2.0 s | 6.5 s |
| boat.dev 9700X | 69 to 123 | 20 to 65 | 26 to 72 s, up to 15 fail | 8.6 s |

No Agent37 instance showed D5's slow flush. Three VMs (all Xeon E-2388G) and two forks is a small sample, but the boat.dev lottery showed on 3 of 4 starts. gVisor's `/tmp` is a tmpfs: a `dsync` there is not durable and its pages count against RAM **[inf]**. The flush counter of `dsync.sh` reads `vda`, and the VM home is `vdc`, so it printed 0 flushes; per-write times stand instead **[exp]**.

### Q3. Edit to verdict over SSH and `exec`

`driver.mjs` (unchanged protocol: edit rides on `invalidate`, then `affected`, `closure`, blob proof, `run`) ran twice per type: on the instance itself (`"local"`), and from this host over one kept SSH connection. Medians, 5 runs for 1 file, 3 for 10, 2 for the source edit; all runs passed **[exp]**:

| | 1 test file | 10 test files | 1 source file | node:test, 1 file | first `affected` |
|---|---|---|---|---|---|
| EU vm, on instance | 0.33 s | 1.20 s | 0.41 s | 0.09 s | 6.2 s |
| EU vm, over SSH | **0.61 s** | **1.50 s** | 0.71 s | 0.21 s | 7.7 s |
| EU vm, over SSH, coverage on | 0.70 s | 1.67 s | 0.71 s | | 7.7 s |
| EU performance, over SSH | 0.71 s | 1.87 s | 0.75 s | 0.22 s | 9.5 s |
| US gVisor, over SSH | 2.16 s | 5.58 s | 2.83 s | 0.58 to 0.70 s | 30.2 s |
| boat.dev 9950X, over SSH | 1.12 s | 2.88 to 3.16 s | 1.04, 1.62 s | 0.19 to 0.23 s | 6.7 to 9.7 s |

Over SSH each call costs about one round trip more: on the EU vm, for a 1-file edit, `invalidate` 79 to 97 ms and `closure` 49 to 61 ms, against 23 to 33 ms and 2 to 3 ms on the instance. The coverage event (1.03 MB for 1 file, 1.47 MB for 10) added 0.09 to 0.17 s over the tunnel **[exp]**.

Round trips from this host (load 22 to 32): `exec` 178 to 316 ms (EU), 425 to 562 ms (US gVisor); a command over a kept ControlMaster 99 to 141 ms (EU), 272 to 302 ms (US); a new SSH connection 739 to 922 ms (EU), 1.6 s (US). boat.dev: 145 to 173 ms and 0.74 to 1.95 s **[exp]**. `exec` has no stdin stream, a 1 MB request cap and 512 KB output caps (`exec.md`) **[docs]**, so the runner-host protocol needs SSH.

The tunnel. SSH reaches an instance only through a WebSocket to `<id>-22022.agent37.app` that carries the workspace API key in `X-Agent37-Key` (`ssh.md`) **[docs]**. The vendor's `agent37 tunnel` (CLI 0.4.1, `src/cli.js` `wsHandshake`) calls `tls.connect` to port 443 directly, so it ignores `HTTPS_PROXY` and needs the key in the environment or in `~/.config/agent37/config.json` **[src]**. This host must use a proxy, so `probes/agent37-sandboxes/tunnel.mjs` (90 lines: CONNECT, TLS, WebSocket frames) replaced it, after the human approved a proxy rule for `*.agent37.app` **[exp]**. With it, ControlMaster worked, and the runner host's marker-line framing carried every request and the 1.0 to 1.5 MB coverage events of 4 driver runs with no error **[exp]**. The docs turn host-key checking off on purpose ("an instance regenerates its host key when the platform relocates it") and SSH keys are workspace-wide ("A registered key opens every instance your workspace owns") **[docs]**.

### Q4. CPU consistency and gVisor

| | US default (gVisor) | EU vm | EU performance |
|---|---|---|---|
| CPU seen | "unknown", kernel `4.19.0-gvisor` | Xeon E-2388G, kernel 7.0 | Xeon E-2388G, kernel 7.0 |
| SHA-256, 1 thread | 882 MB/s | 1,796 MB/s | 1,418 to 1,616 MB/s |
| 4 threads, MB per 5 s window, 60 s | 14,004 to 19,815 | 33,698 to 34,606 | 14,837 to 32,353 |
| CPU steal during the 60 s run alone | not exposed | 0.18 of 240 CPU-s (0.1%) | 4.77 of 240 CPU-s (2%) |
| 50 `test/scheduler` files, 4 workers, 2 runs | 565 s; 656 s with 5 fail | 189 s; 206 s | 224 s with 1 fail; 224 s |

**[exp]** The failures are timing assertions and deadlines: "no quiet point in 120000 ms", an idle slot of 985 ms, "within 2x a direct vitest run", and on performance a CPU ratio of 21.21 against a limit of 21.20. They are false failures of the same kind as on boat.dev's 9700X. The `performance` instance was slower and noisier than `vm` in both CPU runs, against the docs' "gets the same CPU in a busy hour as in a quiet one" (`billing.md`) **[docs]**. One instance of each, so this may be one busy host; it is not determined which type is faster in general.

gVisor compatibility, run in the home (9p) and in `/tmp` (tmpfs) **[exp]**: `setPriority` and `nice -n 10` read back 10; a process-group kill ended the parent and its grandchild; SQLite WAL worked across two processes (600 rows, 0 read errors), 0.03 ms per commit at `NORMAL`, 0.51 ms at `FULL` in the home and 0.03 ms in `/tmp`; `fs.watch` saw own writes in 0.1 to 0.6 ms, recursive too; `realpath` and `realpath.native` resolved a two-link chain. Nothing broke. The cost is speed: the Git files take 4 times as long as on the VM (20.0 s against 4.6 s), the first `affected` 22 to 25 s against 6 s (both on the instance), and process spawns (node:test 0.32 s against 0.09 s on the instance) **[exp]**.

### Q5. Cost, limits and comparison

Rates for 4 vCPU / 8 GB: compute $8.80 a month, times 1 (`default`), 2.5 (`vm`) or 4 (`performance`), metered per minute while awake; disk $0.09 per GB-month always, asleep or not; "Sleeping and stopped ones never count" against the memory limit (`billing.md`, `instance-sizing.md`) **[docs]**. So awake hours cost $0.0121, $0.0301 and $0.0482, and a 10 GB disk $0.90 a month per instance **[inf]**. boat.dev `default`: $0.036 per hour.

Same usage model as `boat-sandboxes.md` Q6 (a: 3 worktrees, 22 days, 8 h, 50 to 100% awake, 264 to 528 h; b: 12 worktrees, 30 days, 16 h, 2,880 to 5,760 h), plus 10 GB disk per worktree **[inf]**:

| Case | Agent37 default | Agent37 vm | Agent37 performance | boat.dev default |
|---|---|---|---|---|
| (a) solo | $5.9 to $9.1 | $10.7 to $18.6 | $15.4 to $28.2 | $9.5 to $19.0 |
| (b) coordinator host | $45 to $80 | $98 to $184 | $150 to $289 | $104 to $207, and the $100 plan for starts |

Limits **[docs]**: no start or wake rate limit is documented (`errors.md` lists `rate_limited` only for backups and upstream providers); boat.dev allows 200 starts a day on the $20 plan. Agent37 limits awake memory instead: 32 GB on the free credit, 40 GB after any top-up, 200 GB once top-ups total $50. Case (b) at 8 GB each needs 96 GB awake, so $50 of top-ups; at 40 GB only 5 instances are awake at once. "There is no fallback": a full region returns `503 no_capacity`.

EU residency **[docs]**: an `eu` instance, its disk and its backups stay in the EU (France or the UK), but "every instance's own control-plane record (its id, shape, and status)" is stored in the US. `ap-south` keeps backups in the US too.

## Recommendation for Squeal

1. **Agent37 EU `vm` is the target to build against, through a provider-agnostic SSH driver.** It gave 0.61 s edit to verdict, no false failures in its whole suite and fork check, and no slow-disk class in this sample. Squeal's shipped protocol (spec 021 D6) ran unchanged over its SSH; only the connection (tunnel, start, wake, sleep) is provider-specific. The same driver serves boat.dev, so the slow-machine question of `boat-sandboxes.md` stops blocking Track 2.
2. **Do not use the gVisor `default` type** for test execution, although it is cheapest: 3 to 4 times slower, and 5 false failures in a 50-file run. Use `performance` only if a second sample shows it beats `vm`; this one did not.
3. **Use sleep and wake, not fork, for per-worktree instances.** One instance per worktree with `auto_sleep` (or an explicit `POST /sleep` when the lane goes idle) wakes in 0.7 to 1.7 s and keeps the warm Vitest host in memory. A new worktree takes a fresh create plus clone and install (about 31 s on the EU vm) or a fork from a warm template instance (55 s). The lane must drop its SSH connection, or stop keepalives, before the instance can sleep.
4. **Ship our own tunnel or require the vendor CLI.** A user behind a proxy cannot use `agent37 tunnel`; ours is 90 lines with no dependency. Either way the client holds a workspace-wide API key and SSH key; there are no per-instance keys.

## Open questions for the human

1. Is a workspace-wide API key on each developer machine acceptable? It can create, delete and open every instance in the workspace.
2. Is the US control-plane record acceptable for EU work, or must residency be complete?
3. For a coordinator host, $50 of top-ups lifts the awake-memory limit to 200 GB. Agree?
4. Should one more `performance` and `vm` pair be run on another day before choosing the type? This sample is one instance each.

Not determined: idle-triggered auto-sleep (the explicit `POST /sleep` was measured; the docs describe the same checkpoint); how often a wake rebuilds instead of restoring; RSS of the runner host alone; pytest through the host (not run, as in `boat-sandboxes.md`); whether every EU host is an E-2388G (3 VMs, possibly one host).

## Sources

- Experiments: `probes/agent37-sandboxes/` (scripts, `results/`), instances `tcgutmnxqn`, `c0myhlo00m`, `8g96zbc4r3`, forks `0pw82zjcfb`, `n9sbdno5an`, all deleted (`results/cleanup.txt`).
- Agent37 docs, fetched 2026-11-23: https://www.agent37.com/docs/llms.txt, and under https://www.agent37.com/docs/agents-api/: billing.md, instance-sizing.md, vm-instances.md, ssh.md, instance-auto-sleep.md, instances/create.md, instances/fork.md, instances/sleep.md, instances/start.md, instances/stop.md, instances/delete.md, instance-lifecycle.md, exec.md, errors.md, concepts.md.
- agent37 CLI 0.4.1 (npm `agent37`), `src/cli.js` (`wsHandshake`, `runTunnel`, `proxyCommand`), read in a `$TMPDIR` install.
- Earlier: `boat-sandboxes.md` and `probes/boat-sandboxes/` (driver, `dsync.sh`, `run-tests.sh`, `setup-node.sh`).
