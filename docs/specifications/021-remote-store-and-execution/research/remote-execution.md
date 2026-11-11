# Research: remote-execution

Row 021-02, topic `remote-execution` of `README.md`. Researcher, 2026-11-11. It extends `../../019-run-triggers/research/remote-runner.md` (019-04, 2026-11-03) and does not repeat it. Squeal source read at `a3579d787` (0.1.430). Mutagen v0.18.1 (release binary, SHA-256 `7735286c…f6f8f` checked against the release's `SHA256SUMS`; source tag `a225ae50a`). The remote is a throwaway container on this host: `node:24.22.1-bookworm-slim` with `openssh-server`, reached over SSH on loopback. Every key, `known_hosts`, `HOME` and Mutagen state lived under `$TMPDIR`. Probes: `probes/remote-execution/` (throwaway). Vendor docs fetched 2026-11-11.

Tags: **[exp]** verified by experiment, **[docs]** read in official docs, **[src]** read in source code, **[inf]** inferred.

## Questions answered

| # | Question | Answer |
|---|---|---|
| 1 | The case for it now | This host is above the slowdown knee again: 10 to 43% of samples per day above 16 busy vCPUs (3 to 10 November), and saturated (95% busy, swap full) while this file was written **[exp]**. Test runs are most of the busy CPU: 82% in the 011-181 sample, Squeal's `nice` runs 27 to 31% of busy CPU per day **[exp]**. Squeal's work above the knee is 94% background (baselines, backlog), 3% edit tiers **[exp, 011 load-slowdown]**. Laptops: not determined, no measurement exists. |
| 2 | Two shapes | (a) runner remote, agent local: the whole runner adapter, a sync with a proof, the remote's environment descriptor; adds sync and round trips to each verdict **[src][inf]**. (b) everything remote: no Squeal change on a fixed host; on a machine started on demand, the store must sit on the persisted disk, and 018's import fills it at start **[src][docs][inf]**. |
| 3 | Mutagen | Four modes, polling plus native watches on Linux, VCS ignore group, no `.gitignore` reading, conflicts kept in session state **[docs][src]**. `flush` returned success while the remote held an old or no copy, in 2 of 2 failure cases; it is not a proof **[exp]**. Save-to-remote latency: not measured, because the load stayed above 24. A proof is the remote's git blob ids of the files the run reads: 11,493 files in 3.2 s **[exp]**. MIT plus SSPL parts, Docker, Inc.; last release 2025-02-24 **[src][docs]**. |
| 4 | Environment on the remote | Squeal already records an environment descriptor per project (spec 018 D1) and compares two with `compareEnvironment` **[src]**. The remote reports it the same way, and a result is refused unless the comparison is `equal` **[inf]**. Same Node image here: equal key inputs, but `TZ` and `LANG` differed and no key holds them **[exp][src]**. |
| 5 | Machines on demand | boat.dev is persistent Ubuntu VMs with native SSH, an HTTP API and snapshots; resume in "a few seconds" **[docs]**. All seven options reach SSH, five only through a proxy or a user-built sshd **[docs]**. SSH is the common surface **[inf]**. |
| 6 | Failure and policy | A hung remote blocked `flush` for 45 s with status "watching", connected, no error **[exp]**. Squeal needs its own deadline. Mutagen copied the gitignored `.env` **[exp]**. |
| 7 | Recommendation | Still no remote runner in Squeal now. Document shape (b) as the supported way and check it on one persistent sandbox. If (a) comes later, its first job is background tiers, not the slow tier. |

## Findings

### Q1. The case for it now

**Since 019-04 the host is busy again [exp]** (`sar-days.txt`, sysstat 10-minute samples, local days):

| Day | Busy vCPUs, mean | `%nice` share of busy | Samples above 16 busy | Samples at 95% busy or more |
|---|---|---|---|---|
| 11-03 to 11-07 | 10.2 to 13.0 | 28.5 to 30.9% | 14 to 43% | 0 to 4.4% |
| 11-08 (partial, 90 samples) | 9.2 | 8.9% | 10% | 0% |
| 11-09, 11-10 | 8.9, 12.9 | 26.8, 27.2% | 27.5, 33.6% | 2.1, 2.1% |
| 11-11 to 13:20 local | 7.9 | 31.3% | 12.5% | 0% |

At 13:16 to 13:28 local on 11-11 the one-minute load was 44 to 78, `top` read 5% idle and 10.6% `nice`, and swap held 4,087 of 4,096 MiB. 019-04's premise ("0 of 143 samples saturated on 1 November") no longer holds. Load-slowdown (2026-11-07) measured the cost: above 16 busy vCPUs a test file runs 1.3 times slower, above 20 busy 2 times slower.

**What share is test runs.** Squeal's runs are `nice` 10 (`src/runners/process/group.ts`), so `%nice` approximates Squeal's share: 27 to 31% of busy CPU on 8 of 9 days **[exp]**. In the 011-181 sample `%nice` read 4.13 cores against 5.79 in Squeal's process trees, so it reads low. The 011-181 process-tree sample (3.7 h, 11.02 busy cores) gave Squeal's trees 5.79 cores (53%) and test trees outside Squeal 3.25 cores (29%): **82% of busy CPU was test runs** **[exp, 011-181]**.

**What moving would free [inf].** Shape (a) moves only Squeal's runs: 27 to 53% of busy CPU. Agents' own `vitest` commands stay; they were 44% of agents' test time above the knee (load-slowdown finding 2). Of Squeal's 299 worker-hours above the knee, baselines were 47%, backlog 47% and edit tiers 3% (load-slowdown finding 5). So the work that loads this host is the work that tolerates latency. That changes 019-04's "slow tier first": the background tiers are the better first candidate here. Shape (b) frees everything: put half the worktrees, with their agents, on a second host.

**Laptops: not determined.** No store, sar or transcript from a laptop exists in this repository (searched `docs/` for "laptop"). The only related evidence is 011 `edit-load.md`, measured on 8 pinned CPUs of this host.

### Q2. Two shapes compared

| | (a) Runner remote, agent and code local | (b) Workspace, agent and daemon remote |
|---|---|---|
| What Squeal changes | The whole adapter behind `RunnerAdapter` moves (019-04 Q1). New: a sync per revision, a remote proof of the tree (Q3), the remote's environment descriptor and a refusal rule (Q4), a deadline and fallback (Q6), a credential **[src][inf]** | Fixed host (Remote-SSH, dev container over SSH): nothing. Squeal runs where the code is **[docs][inf]**. On-demand machine: the store is `<git common dir>/squeal/store.sqlite`, inside the clone, so it persists only where the clone's disk persists (Q5). A fresh machine starts empty; the daemon imports main's results at start (`squeal ci export` and `refs/squeal/<sha>`, spec 018) **[src][inf]** |
| What the user sets up | A second machine with the same Node patch, platform, install and browsers; an SSH key; Mutagen or rsync; ignore rules for secrets **[inf]** | The agent and its credentials on the remote; an editor or terminal over SSH **[docs]** |
| Edit to verdict | Local one-file median 2.6 s (019-04 Q4) plus sync, proof and 3 to 5 round trips. Sync: rsync naming changed files 0.05 to 0.21 s (019-04); Mutagen in Q3; proof per test file 350 paths average **[exp][inf]** | Same as local on that machine: 2.6 s one-file median on this host (019-04). The agent's keystrokes cross the network, the tests do not **[inf]** |

Shape (b) also covers agents that already run in a vendor sandbox. Whether those sandboxes let a Squeal daemon run was not determined: their docs are not among this brief's sources.

### Q3. Code sync with Mutagen

**Modes [docs]** (mutagen.io/documentation/synchronization). `two-way-safe` (default), `two-way-resolved` (alpha wins), `one-way-safe` (beta's own edits kept and reported), `one-way-replica` ("beta becomes an exact replica of alpha"). Measured with a remote edit and a local edit to one file, and a file the remote created **[exp]** (`conflict.sh`): `one-way-safe` kept the remote edit and listed 1 conflict. `one-way-replica` overwrote it and deleted the created file. `two-way-safe` listed 1 conflict and copied the created file back into the local tree. For Squeal only `one-way-replica` fits: a remote test that writes into the tree (a new snapshot) must not create a local revision **[inf]**. Then such writes are lost on the remote, so a Vitest run there must not rely on writing snapshots **[inf]**.

**Change detection [docs]** (…/synchronization/watching). macOS and Windows use native recursive watching. "On Linux, this polling is coupled with a restricted set of native watches on the most recently updated contents". Polling "defaults to 10 seconds". A flush forces "a full (warm) re-scan rather than using acceleration" (`controller.go:1020-1027`) **[src]**. Idle cost of one session over this repository (11,494 files): 0.71 s CPU local and 0.98 s remote per minute, about 2.8% of one core **[exp]**, at load 71.

**Ignores [docs][src].** Rules use Git-like syntax, given per session (`-i`) or in `~/.mutagen.yml`. `--ignore-vcs` ignores `.git` and others. Mutagen reads no `.gitignore` file: the `ignore` package has no such code. The docs plan groups "for … node_modules directories" in "future versions". Measured: `.git` and `node_modules` stayed local, and the gitignored `.env` reached the remote **[exp]**.

**Save to remote, and how a client knows [exp].** The save-to-remote latency was **not measured**. The brief skips timings while the one-minute load is above 24. A check every 10 s from 12:30 to 13:30 UTC never saw it below 24, and the sysstat samples from 12:00 to 13:20 UTC read 30 to 86. The probe is ready (`latency.mjs`, `remote-watch.mjs`: hot file, cold file, each with and without `flush`). From the docs, a file outside the recently watched set can wait up to the 10 s poll unless the client flushes **[docs][inf]**. `mutagen sync flush` asks for one cycle and returns when a cycle that began after the request completes (`controller.go:327`, `:1438`) **[src]**. It does not wait for equality:

- The remote's parent directory was missing. `flush` exited 0, and the session held `transitionProblems: "unable to walk to transition root parent"`. No file had arrived.
- A file was rewritten every 20 ms (`race.sh`). Five flushes exited 0. After each, the remote held `14` or nothing while the local file held 9 to 71, and the state held a transition problem for that path.

So a client must read `mutagen sync list --template '{{json .}}'` for `transitionProblems`, `scanProblems` and `conflicts` after each flush. Even a clean state covers only the scan that the cycle took, not the revision Squeal keyed. Mutagen does not mix bytes: the remote kept the last whole version.

**Can Squeal prove that the remote tree equals revision N? [exp][src][inf]** Not from any sync tool's status. Mutagen hashes with SHA-1 of raw content by default (`version.go:40-43`), or xxh128 in SSPL builds, and exposes counts, not per-file digests. Squeal's file hash is the git blob id (018 `result-import` Q1), which the remote computes with `git hash-object --stdin-paths`. After the first sync, 11,493 of 11,493 tracked files had equal ids, in 3.2 s for both sides at load about 60 (`compare-tree.sh`). A proof per run is the remote's ids of the run's closure, before and after the run, against revision N's: the remote form of `SourceStamps`. That works the same over rsync and Mutagen.

| Route | Per revision | Proof of revision N | Ignored files |
|---|---|---|---|
| rsync `--files-from` (019-04) | 0.05 s plus 2 RTT | Remote hash check | Sent if named |
| Mutagen `one-way-replica` | Not measured (load); a cold file up to the 10 s poll without `flush` | Remote hash check; `flush` alone is not one | Sent unless ignored |
| Git tree commit (019-04) | push 0.03 to 0.15 s, fetch 1.5 to 2.0 s | By construction: the tree names the blob ids | Not sent |

**License and maintainer [src][docs].** `LICENSE` at v0.18.1: MIT, "Copyright (c) 2016-present Docker, Inc.", except `sspl/` under the Server Side Public License, which is "included by default in official Mutagen release builds" (fanotify watching, xxh128, zstd). The site's banner: "Mutagen is Joining Docker". Last release v0.18.1 on 2025-02-24. The default branch has 85 commits since then, the last on 2026-04-22, signed off by `jacob@mutagen.io`. No release in 20 months.

**Unison [docs]** (github.com/bcpierce00/unison, v2.54.0 of 2026-05-01, GPL-3.0). Two-way sync over SSH with conflict detection and a "repeat" mode with a filesystem monitor. Its README: "An estimate is 2.5 people and 0.1 Full-Time Equivalents". Two-way is the wrong direction for Squeal, and the proof question is the same.

**lsyncd [docs]** (github.com/lsyncd/lsyncd, v2.3.1 of 2022-11-17, GPL-2.0). inotify events, aggregated "for a few seconds", then rsync. One-way only. The README opens with "Needs new maintainer. Up for adoption". Squeal already knows each revision's changed paths, so it can call rsync directly.

### Q4. The environment on the remote

**How the remote reports it [src].** Since 019-04, spec 018 D1 added `EnvironmentDescriptor` (`src/core/keys/environment-descriptor.ts`). It holds the key format, runner name and version, adapter version, `process.version`, platform, arch, installed-dependency fingerprint, allow-listed variables as one hash, one hash per resolved config field, config files, and whether `CI` is set. `compareEnvironment` (`src/core/status/import-environment.ts`) answers `equal`, `passes` (only the D10 CI fields differ), `differs` with named parts, or `unknown`. A remote runner computes its descriptor on the remote, from the remote's process and install **[inf]**.

**Refused, not stored [inf].** The remote result is accepted only when the descriptors are `equal`. D10's `passes` tolerance exists for CI imports, where `allowOnly: false` proves the local pass. It does not apply to a runner that should run with local settings. On `differs`, nothing is stored under the local key, and status names the part that differs ("remote Node v24.21.0, this worktree v24.22.1"). Today's keys hold the daemon's `process.version` (`environment.ts:45-47`), so without this check a remote result would be a wrong hit (019-04 Q3).

**Measured [exp].** The container from `node:24.22.1-bookworm-slim` matched Node v24.22.1, linux, x64, and `CI` unset. File bytes matched (0 of 11,493 blob ids differ), so line endings did not change. The container differed in `TZ` (UTC against Europe/Warsaw), `LANG` (unset against `C.UTF-8`), user (`root`) and `HOME`. None of them is a key input (018 `result-import` Q1). A test that reads them would get a wrong hit, the known incomplete closure of decision 0002. `node_modules` must be installed on the remote from the lockfile. The descriptor's `installedDependencies` then shows staleness. Not measured: a cold remote install and its download. It would move hundreds of MB on a loaded host, and 019-04 measured only a warm install (0.32 s).

### Q5. Machines on demand

All from each vendor's own docs, retrieved 2026-11-11 **[docs]**. Quotes are in the sources list.

- **boat.dev.** "boat gives AI agents full Linux VMs, built for agent factories. A sandbox is a persistent Linux (Ubuntu) virtual machine with SSH and SCP access, Docker inside the VM". An HTTP API (`https://boat.dev/api/v1`, bearer key) with sandboxes, commands, files, snapshots, environments and repositories, and webhooks; Python and TypeScript SDKs. "A resume, a fork or a deploy is ready in a few seconds, whatever the size of the disk". A cold create time is not determined: the site says only "Get a VM in seconds". "There is no pause. A stopped sandbox costs nothing, and boat keeps its disk for at least 14 days". `/home/user` is saved, `~/.cache` is not. SSH is native: "Connect to `sshEndpoint` when it is set. Else connect to `machineIp` on port 22", but after "each resume and fork. The machine, its IP address and its host key change". Price: 4 vCPU and 8 GB at $0.036/h, billed per second, $20 minimum a month. EU only. A self-hosted option is not determined.
- **Fly Machines.** Start "well under a second", create "low double digit seconds", resume from suspend "a few hundred ms". The root disk is "ephemeral … a blank slate on every startup"; volumes persist. SSH via `fly ssh console`, or WireGuard plus `fly ssh issue --dotssh`. Per second; no free tier.
- **E2B.** "~150 ms from a snapshot or custom template". Pause keeps filesystem and memory, "kept indefinitely". No native SSH: a user-built sshd behind a `websocat` ProxyCommand. Per second ($0.000014 per vCPU-second). BYOC for Enterprise.
- **Daytona.** "<90ms" for a container. Stop keeps the filesystem. SSH through a token gateway (`ssh <token>@ssh.app.daytona.io`). $0.0504 per vCPU-hour. Bring-your-own-compute runners.
- **Modal Sandboxes.** No start time stated. Lifetime "5 minutes" by default, up to 24 hours; filesystem snapshots kept 30 days. No native SSH: a user-run sshd over a raw TCP tunnel. Per second at "3x list price".
- **Namespace Devboxes.** Ready "after a few seconds". A persistent Devbox keeps its storage; auto-suspend after 15 minutes. "Works with `ssh`, `scp`, `rsync`, and IDEs | Yes, with `devbox configure-ssh`". Per minute ($0.004 for 4 vCPU and 8 GB).
- **Dev containers on a cloud host.** Remote-SSH works with "any remote machine, virtual machine, or container with a running SSH server". Dev Containers over SSH need Docker only on the host. Codespaces: stop and restart keep `/workspaces`; SSH through `gh codespace ssh`; $0.18/h for 2 cores. The code stays on the user's own host only when that host is theirs.

**Is SSH the common surface? [inf]** Yes, with two limits. Every option reaches an SSH server: two natively (boat.dev, a fixed host), five through a vendor proxy or a user-built sshd. Mutagen and rsync call the system `ssh`, which reads `~/.ssh/config` and its `ProxyCommand`. Mutagen finds `ssh` on `PATH` or `MUTAGEN_SSH_PATH` (`pkg/ssh/ssh.go:53-58`) **[src]**. The limits: host keys that change on each resume (boat.dev) need pinning per start from the API; and a start, stop or snapshot is a vendor API call, not SSH. For shape (b) the persisted disk matters more than start time: boat.dev, E2B, Daytona, Namespace and Codespaces keep it; Fly needs a volume; Modal keeps only snapshots. In every vendor option the code leaves the user's machine.

### Q6. Failure and policy

**Measured [exp]** (`unreachable.sh`). With the container paused (TCP open, no answer), `flush` did not return in 45 s. `sync list` said "watching", beta connected, `lastError` empty. After unpause the next flush took 0.35 s. With the remote agent killed (connection dropped), Mutagen reconnected and a flush took 0.25 s. So Mutagen hides a hung remote, and Squeal must put its own deadline on every remote step.

**What the agent hears [inf].** As 019-04 Q4: a remote error is never a test failure, and keys keep principle 2. On the fallback choice (019-04 open question 2), the new evidence is Q1. The load comes from background tiers, so a local fallback for them adds back the load that the remote was meant to remove. "Not run, remote unreachable since T" fits background tiers. An edit tier can fall back to local runs, since it is 3% of the load above the knee.

**Policy [inf].** Code leaves the machine on every save, together with whatever the ignore rules miss (the `.env` here). Mutagen copies its agent binary to the remote (7.9 MB for linux/amd64, taken from a 97 MB bundle of all platforms) and keeps it with its staging files under `~/.mutagen` there **[exp]**. The remote needs an SSH key on the laptop. A vendor machine adds an API key and a bill. Principle 8 ("externally visible … needs explicit policy") makes all of this opt-in, with the target, the ignore rules and the deadline visible in status.

## Recommendation for Squeal

**Do not build a remote runner (shape a) now.** The new evidence makes the host case real again, but it points at shape (b) and at local scheduling, not at moving Squeal's runner:

1. **Shape (b) costs Squeal nothing and frees the most.** It moves agents' own test runs too (29% of busy CPU in 011-181), which shape (a) cannot. On this host, the step is a second machine for some worktrees with their agents. For users, it is a documented setup: "run the agent, the clone and Squeal on the remote; keep the clone on a persisted disk". The one Squeal gap to check is a fresh machine's empty store, which 018's import at daemon start already addresses.
2. **If shape (a) comes later, scope it to background tiers** (baselines and backlog, 94% of Squeal's work above the knee) of one runner on one SSH host. Use `one-way-replica` Mutagen or rsync of named paths, with a remote blob-id check of each run's closure as the proof (never `flush` alone). Accept results only on an `equal` environment descriptor, put a deadline on every step, and show "not run" when the remote is unreachable. The user's cost: a second machine with the same Node patch and install, an SSH key, and the code and unignored files leaving the laptop.

**First experiment on a real second machine (a later row, not run).** One boat.dev sandbox, 4 vCPU and 8 GB at $0.036/h, $20 minimum a month by its docs. Alternatively, a team machine on the LAN at no cost. Steps:

1. Clone this repository on the remote and run Squeal there as shape (b), with an import at daemon start.
2. Measure Mutagen save-to-remote latency and `flush` over a real RTT.
3. Measure a cold `pnpm install` and its download.
4. Stop and resume the sandbox, then check that the store and `node_modules` survived.
5. Compare the environment descriptors of both sides.

About 3 to 4 hours of machine time, so the $20 minimum dominates.

## Open questions for the human

1. Who is the target: this host (now above the knee again on 3 days in 8) or users' laptops (no data)? The answer picks shape (b) on a second host, or shape (a) for a laptop.
2. Is a documented shape (b), with no code, an acceptable answer to the request, or is the goal a Squeal feature?
3. May the first experiment above spend the $20 boat.dev minimum, or should it run on a machine the team already has?

Not determined: Mutagen save-to-remote latency, even on loopback (load 30 to 86 for the whole session); latency over a real network (no second machine); laptop load; whether vendor agent sandboxes (outside this brief's sources) allow a daemon; boat.dev cold create time and self-hosting; cold install size.

## Sources

- Squeal at `a3579d787`: `src/core/keys/environment.ts:45-47`, `src/core/keys/environment-descriptor.ts`, `src/core/status/import-environment.ts`, `src/runners/process/group.ts`; spec 018 D1, D10 (`../../018-ci-and-shared-results/spec.md`).
- Earlier findings: `../../019-run-triggers/research/remote-runner.md`; `../../018-ci-and-shared-results/research/result-import.md`; `../../011-core/research/load-slowdown.md`; `../../011-core/research/host-load/011-181.md`.
- Mutagen v0.18.1: release `mutagen_linux_amd64_v0.18.1.tar.gz` and `SHA256SUMS` (github.com/mutagen-io/mutagen/releases/tag/v0.18.1); source at tag v0.18.1 (`a225ae50a`): `LICENSE`, `pkg/synchronization/controller.go`, `pkg/synchronization/version.go`, `pkg/ssh/ssh.go`, `pkg/synchronization/core/ignore/`; GitHub API for releases and commits (2026-11-11). Docs: https://mutagen.io/documentation/synchronization/, …/synchronization/ignores/, …/synchronization/version-control-systems/, …/synchronization/watching/, …/transports/ssh/.
- Unison: https://github.com/bcpierce00/unison (README at master, release v2.54.0). lsyncd: https://github.com/lsyncd/lsyncd (README at master, release v2.3.1).
- boat.dev: https://boat.dev, https://docs.boat.dev/llms.txt, /api/v1.md, /readiness.md, /ssh-access.md, /snapshots/whats-saved.md, /faq.md, /sdks/overview.md.
- Fly: https://fly.io/docs/machines/overview/, /reference/suspend-resume/, /volumes/overview/, /about/pricing/, /flyctl/cmd/fly_ssh_console, /flyctl/cmd/fly_ssh_issue, /machines/api/.
- E2B: https://docs.e2b.dev/sandbox/persistence.md, /sandbox/ssh-access.md, /template/how-it-works, /byoc.md, /billing.md, https://e2b.dev/pricing.
- Daytona: https://www.daytona.io/docs/en/sandboxes.md, /persistence.md, /ssh-access.md, /billing.md, /bring-your-own-compute.md, https://www.daytona.io/pricing.
- Modal: https://modal.com/docs/guide/sandboxes.md, /sandbox-snapshots.md, /sandbox-exit-snapshots.md, /tunnels.md, https://modal.com/pricing.
- Namespace: https://namespace.so/docs/devbox/index.md, /devbox/lifecycle.md, /devbox/connecting.md, https://namespace.so/pricing.md.
- Dev containers: https://containers.dev/implementors/spec/, https://code.visualstudio.com/docs/remote/ssh, https://code.visualstudio.com/docs/devcontainers/containers, https://docs.github.com/en/codespaces/about-codespaces/understanding-the-codespace-lifecycle, https://docs.github.com/en/billing/concepts/product-billing/github-codespaces.
- sysstat: `/var/log/sysstat/sa03` to `sa11`, read by `probes/remote-execution/sar-days.sh`.
