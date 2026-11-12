# Research: the remote lane on a real second machine (boat.dev)

Row 021-15, brief `../tasks/021-15-boat.md`. Researcher d649a293, 2026-11-12 (all times UTC). Squeal at main `472a13730` (0.1.448 plus docs commits; 0.1.448 was not tagged), the clone's committed build (a rebuild changed no committed file). boat.dev docs fetched 2026-11-12. One sandbox, `bx_djmae9xd`. Throwaway probes and raw numbers: `probes/boat-trial/`.

Tags: **[exp]** verified by experiment, **[docs]** read in official docs, **[src]** read in source code, **[inf]** inferred. "Load" is this host's one-minute load average (24 CPUs).

**Verdict.** The lane works over a real network: transfer, proof, the environment refusal, a lost remote and the `local` fallback all behaved as D10 to D14 say, and the network adds little (32 ms round trip). It is not usable as shipped. Four defects stop it on this repository and on boat.dev: coverage on refuses every remote run (D1), tests that use Git store false failures (D2), a boat.dev resume onto a new machine refuses every run until a reinstall (D3), and the default cache `.cache` is not kept by boat.dev (D4).

## The sandbox and the timings

| Sandbox | Value |
|---|---|
| Size | boat.dev type `default`: 4 vCPU (AMD EPYC 4585PX, 1 thread per core), 8 GB RAM (7,941 MiB seen), root disk 79 GB ext4 (the docs say 51 GB), `machineProvider: baremetal` **[exp]** |
| Region | not in the API answer (`region: null`); the outbound IP geolocates to France; boat.dev says "EU only" **[exp][docs]** |
| Plan | the $20/month plan, started by the human during the row; the API shows `billingStatus: trialing` (7-day trial, "auto-stop max 2h, no large or xlarge types", 25 h trial compute) **[exp]** |
| OS, Node | Ubuntu 24.04.4, kernel 6.8; Node v24.22.1 preinstalled in `/usr/local/bin`; Node 26.13.0 installed for `user` by `setup-remote.sh` **[exp]** |
| Cost | 5,020 machine-seconds = **$0.0502** by `GET /sandboxes/{id}/usage`, taken from the plan's included hours; wallet charged $0 **[exp]** |

Per run, 10 test files each. "Vitest" is the run's own `durationMs` from its report, "run" the daemon's run row (start to end, network included), "edit to result" the time from writing the files to `squeal status --wait` giving their verdict (`probes/boat-trial/edit-timings.txt`, `runs.txt`) **[exp]**:

| Where | Files | Load | Vitest | Run | Edit to result |
|---|---|---|---|---|---|
| Remote, first machine | set A (`test/capacity`) | 31 to 44 | 1.25, 1.25, 1.26, 1.62, 2.50 s | 2.0 to 3.3 s | 4.1, 4.3, 4.7, 4.8, 4.8 s |
| Local | set A | 21.6 to 24.2 | 7.4, 6.0, 3.5, 3.7, 4.9 s | 3.8 to 7.7 s | 12.4, 8.0, 6.1, 5.4, 7.3 s |
| Remote, machine after a long resume | set A | 20.0 to 27.4 | 34 to 43 s, then 1 to 2 s for the retried file | 34 to 44 s | 38.8, 42.9, 39.2, 47.1, 38.8 s |
| Remote, machine after a long resume | set B (`unit-files.txt`, `test/scheduler`) | 19.5 to 21.1 | 5.8, 5.1, 5.2, 4.9, 4.9, 4.7 s | 5.8 to 6.7 s | 9.1, 8.1, 7.8, 7.8, 7.8, 8.2 s |
| Local | set B | 19.1 to 27.6 | 9.9 (cold), 6.4, 1.3, 1.5, 1.4, 1.9 s | 1.6 to 10.2 s | 12.5, 8.5, 3.5, 3.4, 3.4, 4.2 s |

The first-machine remote rows ran above load 24; no clean remote row on that machine exists, because the next resume moved the sandbox. Edit to result minus run is about 2 s on both sides, so the lane adds little beyond the run; the remote's speed is the machine's.

Whole suite, `vitest run --maxWorkers=4`, `test/e2e/**` excluded, once each **[exp]** (`full-suite.txt`):

| Where | Wall time | Load | Test files | Tests |
|---|---|---|---|---|
| boat.dev sandbox (first machine), a copy of the remote tree | 1,672 s | sandbox 2 to 6; this host irrelevant | 1,686 passed, 27 failed | 13,186 passed, 52 failed |
| This host, the clone, `flock` on the full-run lock | 1,944 s | 14 to 72, median about 42 | 1,711 passed, 2 failed | 13,294 passed, 2 failed |

Remote failures: 22 files need Git (`git rev-parse HEAD`, no `squeal--v*` tag, `git ls-files`); 4 time out at 5 s (`ps/snapshot`, `ps/work`, `slow/slot`, `runner-host/remote/admission`); 1 exit-code assertion. Local failures: two timing tests (`opencode-dispose`, `environment-growth-siblings`).

## Questions answered

| Brief item | Answer |
|---|---|
| Set up | Create to `ready` 0.6 s; SSH through `sshEndpoint` (an IPv4 port forward; the machine has IPv6 only), host key pinned from `POST /sshkey`, `StrictHostKeyChecking yes` **[exp]** |
| First connect | Bundle 6.5 MB, 2.1 s; tree 12,052 files, 233.9 MB, 27.6 to 44.8 s at load 48 to 77; `pnpm install` 3.5 s and about 288 MB downloaded from an empty pnpm store, 5.0 s with the store kept; whole connect 44 to 52 s **[exp]** |
| Remote run, edit to result | See the table. |
| Round trip | ping 31.5 ms; one line over a kept ssh session 32.5 ms median; a new ssh connection 569 ms median (load 19.7) **[exp]** |
| Proof and environment | Proof held on every remote run ("run proven over 49 paths"). Remote Node v24.22.1: "remote boat-trial refused: Node v24.22.1 on the remote, v26.13.0 here; running here" **[exp]** |
| Lost remote | Stop 8 s into a 14-file run: lost 30 s later ("did not answer run, nor tell it is alive, within 30000 ms"), "unreachable since …; running here"; all 14 files current here, 250.7 s edit to verdict at load 29 **[exp]** |
| Lane back after resume | Within 10 minutes: same machine and host key, lane back at the next background run (reconnect about 10 s). After 13 minutes: new machine, new IP and host key; the old pin refused ("Host key for boat-trial has changed"); after `sshkey` the lane reconnected **[exp]** |
| Cache across stop and resume | Default `.cache`: lost (`~/.cache/squeal` gone), so bundle, tree and install again (52 s). `"cache": "squeal-cache"`: kept, "present", "0 sent", no install, reconnect 9.1 s; but see D3 **[exp]** |

## Findings

**D1. Coverage on refuses every remote run [exp][src].** With `coverage.enabled: true` (this repository, and the default: `src/core/types/policy.ts:439`, since a6741966c), every remote attempt was "refused: config fields coverage differ; running here". The lane runs the remote host with coverage off (D12; `021-13-14-notes.md` choice 9), and `environmentDifferences` (`src/core/runner-host/remote/environment.ts`) compares the remote Vitest record with the local one, which carries coverage. The trial set `coverage.enabled: false` in the clone to go on. D12 and D11.2 contradict each other as built.

**D2. Tests that use Git store false failures [exp][src].** The remote tree has no `.git` (D10 sends only `git ls-files -co --exclude-standard`). Ten Git-dependent test files ran remote, were "proven over 411 paths", and were stored as current failures (`Command failed: git rev-parse HEAD`, exit 1); four of them run here passed 66 of 66. The proof covers the closure's blob ids, not the Git state a test reads. On this repository 22 of 1,713 test files are of this kind.

**D3. A resume onto a new machine refuses every run [exp][src].** After boat.dev restored the disk on a new machine, 613 symlinks in `node_modules/.pnpm` had the restore time (13:19:07) and `lock.yaml` the install time (13:05:03). `stalePnpmLockfile` (`src/core/keys/pnpm-install.ts:117`) compares mtimes, so the remote fingerprint fell back to package folders and differed: "refused: installed dependencies differ; running here", on every run. `installed.json` still matched the lockfile, so no reinstall came. `touch node_modules/.pnpm/lock.yaml` on the remote made the next run proven. The lane said "go there" at connect and refused only at the run; the same holds for the Node refusal.

**D4. The default cache is lost on boat.dev [exp][docs].** boat.dev: "A snapshot does not save `~/.cache`". Squeal's default `cache` is `.cache` (`settings.ts` `LANE_DEFAULTS`), so each resume onto a new machine copies the bundle and 234 MB again. `"cache": "squeal-cache"` (under the home) kept it.

**D5. The restored machine was slow on disk syncs [exp][inf].** On the machine after the long resume, a 4 KiB `dsync` write took 21 to 31 ms (133 to 193 kB/s) in `/tmp` and the home, I/O pressure stayed 22 to 40% while idle beside a process `ascii-lazyfs`, though the API said `hydrated: true`. Set A, whose tests lock and sync files, took 34 to 43 s there against 1.3 to 2.5 s on the first machine, with one 5 s timeout retried by Squeal. The first machine's disk was not measured, so the cause is inferred.

**D6. Smaller observations [exp].**
- Edits made while the daemon starts wait for it: the daemon served 50 to 82 s after its start on this host (load 20 to 48), and the first edits took 25 to 53 s.
- One `squeal start` after `squeal stop` took 2 min 44 s; not reproduced.
- The tree is sent as base64 in JSON, uncompressed (`src/core/runner-host/remote/tree.ts:100`): about 312 MB on the wire for 234 MB **[src][inf]**.
- The daemon's log goes to stderr, which `squeal start` discards; the trial ran `squeal daemon` itself to read it.
- No ceiling refusal was logged in any run; the remote machine's admission (021-21) admitted every run.
- OpenSSH reads `~/.ssh/config` from the password database's home, not `$HOME` (`ssh -G` with a fake `HOME` ignored its config); an isolated `HOME` needs `ssh -F` **[exp]**.
- boat.dev's network counters inside the VM did not count the SSH traffic of the port forward; the tree's bytes come from the local side.

## Recommendation for Squeal

1. Compare the remote environment with coverage taken out of both sides (or run coverage remote), before any user tries the lane with default settings (D1).
2. Refuse, or keep local, a remote run whose test reads `.git` or runs `git`; at least name it. Observed inputs could show `.git` reads (D2; not determined whether they do).
3. On an "installed dependencies differ" refusal, reinstall on the remote once before falling back; or base the remote's stale check on content, not mtimes (D3).
4. Document `cache` for hosts that drop `~/.cache` (boat.dev), or default it outside `~/.cache` (D4).
5. Say "connected, not yet compared" at connect, and name the refusal at once, not "go there" (D3, Node).

What a user needs today: Node equal to the local one on the login `PATH` (above the "not interactive" return of `~/.bashrc`), `corepack enable`, an ssh `Host` with the key and a pinned host key (re-pinned after each boat.dev resume onto a new machine), `coverage.enabled: false`, no Git-dependent tests, and `"cache"` outside `~/.cache`.

## The sandbox

Stopped (`archived`) at 13:38:51; a stopped sandbox costs nothing and boat.dev keeps its disk at least 14 days **[docs]**. It holds a copy of this repository's tracked files and `node_modules`. Recommendation: delete it, because a new sandbox reaches a ready lane in about a minute; keep it only if the defects are fixed and re-measured within 14 days. Deleting is the coordinator's call (`DELETE /sandboxes/bx_djmae9xd` with `X-Ascii-Confirm-Delete`).

## Open questions

- A clean remote timing on a fresh (not restored) machine at load under 24: not determined, because the only first-machine series ran at load 31 to 44 and the next resume moved the sandbox.
- Whether boat.dev machines after a long resume stay slow on syncs, or only for a while: not determined (D5).
- Whether observed inputs record `.git` reads: not determined.

## Sources

- boat.dev docs, fetched 2026-11-12: https://docs.boat.dev/llms.txt, /api/v1.md, /ssh-access.md, /snapshots/whats-saved.md, /faq.md, /api/reference/sandboxes/create-sandbox.md, /api/reference/agent/configure-sandbox-ssh-key.md, /api/reference/sandboxes/get-sandbox-usage.md, /api/reference/sandboxes/resume-sandbox.md.
- boat.dev API answers (`GET /limits`, `GET /sandboxes/{id}`, `/usage`), 2026-11-12.
- Squeal source at `472a13730`: `src/core/runner-host/remote/{settings,environment,lane,tree}.ts`, `src/core/keys/{environment,pnpm-install}.ts`, `src/cli/daemon.ts`.
- Probes and raw numbers: `probes/boat-trial/` (`README.md` lists each file).
