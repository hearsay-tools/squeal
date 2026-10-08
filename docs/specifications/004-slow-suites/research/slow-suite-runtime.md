# Slow-suite runtime

Recommendation: run slow projects in a bounded background lane, preserve per-file input stability, and require isolation plus declared artifact inputs before reuse.

## Questions answered

| Question | Answer | Evidence |
| --- | --- | --- |
| 1. Resources and controls | Both suites fan out into child processes; runner concurrency reduces footprint but does not cap descendants. Linux priority, affinity and user CPU quotas work here. Matched calm-load comparisons are not determined because no quiet window was reserved on this shared host. | **verified by experiment**: resource trials and control probes below; **read in official docs**: Node 24.21.0 OS APIs, Linux tools, systemd and Apple priority manuals. |
| 2. Load guard | A raw load threshold of 4 would defer frequently on this 24-CPU host. Use load as a scheduling hint with a bounded wait, not proof that another agent is testing. | **verified by experiment**: sysstat 12.6.1, 60 observations from 2026-10-07; **inferred**: guard policy. |
| 3. Revision during a run | An unrelated revision does not invalidate a file. A changed keyed input requires discarding that file's result, even if it finished successfully. Cancellation needs descendant cleanup. | **read in source code**: Squeal 0.1.30 scheduler; **verified by experiment**: real-file interruption trials. |
| 4. Concurrent worktrees | Different repository/temp roots do not isolate fixed TCP ports. Two Cezar copies collide on `::1:4321`. Squeal's fixture-install cache intentionally shares an atomic installation, while fixture roots and daemon identities are separate. | **verified by experiment**: controlled overlap of the existing Cezar test; **read in source code**: both harnesses. |
| 5. Inheritance | A module closure alone cannot justify slow-suite inheritance. Key the actual built/installed inputs and control external state; otherwise do not inherit. Current `complete` is not a usable opt-in signal. | **verified by experiment**: unchanged worktree bytes with changed archived CLI behavior; stale copied Cezar build; **read in source code**: closure assembly and runner boundaries. |

## Findings

### 1. Cost and resource controls

**verified by experiment**, Linux 6.8.0-142-generic, Node 24.21.0, Squeal 0.1.30 at `25580c8`, Vitest 5.0.3 / tsx 4.23.15; Cezar 0.15.1 at `13351da`, tsx 4.23.0. Measurements exercise native suite commands, not the daemon's default four-file tiers. All executions used copies under one owned `/tmp` directory. Fixed temp paths were redirected there. Cezar needed a fresh scratch `npm ci` and server build: the initially copied installation/build failed 13 of 70 tests, including missing packaged files and uninlined contract imports. That trial is excluded from timing comparisons. Installed web assets were copied, not rebuilt.

| Mode | Squeal wall / CPU s / RSS MiB | Cezar wall / CPU s / RSS MiB |
| --- | --- | --- |
| Single copy | 71.4 / 84.9 / 2439 | 52.6 / 204.6 / 3116 |
| Two copies, foreground | 62.4 / 56.7 / 1311 | 59.3 / 182.5 / 2405 (69/70; port collision) |
| Two copies, nice 19 companion | 63.9 / 57.1 / 1203 | 64.0 / 205.8 / 3376 |
| One runner worker | 171.0 / 56.7 / 680 | 123.0 / 152.6 / 1100 |
| nice 19 + idle I/O | 83.7 / 65.9 / 1459 | 44.4 / 184.6 / 3181 |
| One CPU affinity | 200.6 / 59.0 / 755 | 257.2 / 185.3 / 1061 |
| Two-CPU cgroup quota | 130.0 / 53.7 / 670 | 126.0 / 142.4 / 1018 |

CPU is reaped user+system time, a lower bound when daemons detach. RSS is a sampled sum: it can miss fast children and double-count shared pages. [Probe results](probes/slow-suite-runtime/README.md) contain every isolated file's CPU/RSS/wall time and full-run file spans. Concurrent per-file CPU/RSS is **not determined** because shared/escaped children cannot be attributed. These are single observations with ambient load recorded, not controlled speedups; the first Squeal run populated its fixture cache.

**verified by experiment**, coreutils 9.4, util-linux 2.39.3, systemd 255: `nice -n 19` produced priority 19; `ionice -c 3` reported idle; `taskset -c 0` reduced Node's available parallelism to 1; an unprivileged `systemd-run --user --scope -p CPUQuota=50%` exposed `cpu.max` = `50000 100000`. A scope can constrain descendants, including detached fixture daemons. Node reported two available CPUs under `CPUQuota=200%`, so these trials also change runner defaults that use that estimate. All valid quota runs passed. A reachable user bus is required; stripping its location from the probe environment initially prevented scope startup. Runner file concurrency alone cannot constrain a test's own CLI/build subprocesses.

**read in official docs**, Node 24.21.0 and fetched Linux/Apple manuals: niceness changes scheduling preference, not a CPU ceiling; I/O priority's benefit depends on the block scheduler; CPU affinity limits placement, not utilization of the selected CPUs; systemd quota caps aggregate CPU time. Node OS priority/load APIs and runner concurrency are the portable choices for Linux/macOS. `ionice`, Linux `taskset`, and systemd cgroups are Linux-specific. macOS execution and descendant cancellation were **not determined**, because this host is Linux. The archived Apple manual confirms priority support, not present-day suite behavior.

### 2. Guard and starvation

**verified by experiment**, sysstat 12.6.1: `/var/log/sysstat/sa07` had a complete prior-day log. The explicit window 08:00–18:00 UTC (10:00–20:00 Warsaw) contains 60 ten-minute samples. One-minute load exceeded 4 in 32/60 (53.3%), 10 in 14/60 (23.3%), and 25 in 8/60 (13.3%); median 4.70, range 0.41–73.01. These are sampled exceedances, not continuous durations above a threshold. An additional hour sample was unnecessary.

**read in official docs**, Linux `proc_loadavg(5)` and Node 24.21.0: load includes runnable tasks and disk waits, and identifies no test owner. **inferred**: use a slow-slot budget plus low priority; defer under sustained pressure with hysteresis and bounded deferral/checkpoint override. Scale thresholds to host capacity; dividing host load by one job's cgroup quota mixes scopes. Identifying arbitrary manual agent tests is **not determined**; prefer an explicit harness signal/cooperative lease and expose defer reasons.

### 3. Interruption and keys

**read in source code**, Squeal `25580c8`: 001 D5 never cancels a tier on a revision. `tiers.ts:recordTier` rejects a completed file when a closure path changed on disk or in a recorded revision during the run; it keeps stable siblings. A changed install discards the whole overlapping tier. Results are stored under the captured key and applied as current only if that key still matches. Thus a revision number alone does not mean stale, and “finish, cache under the old key, label stale” is unsafe for mutable inputs: a late read may have seen new bytes. A truly immutable input snapshot would change this conclusion; neither suite currently supplies one.

**verified by experiment**, Node 24.21.0, systemd 255: a harmless keyed-file comment changed at 3 s during the real `shipped-plugin.test.ts` and Cezar `application-update.test.ts`. Finishing then retrying took 14.35 s and 69.99 s respectively; stopping the owned scope then retrying took 10.05 s and 43.00 s. Scope stops took 0.218 s and 0.020 s; all completed/retry runs passed. These short representative-file trials measure execution cost, not a new scheduler policy. “Finish and mark stale” has the same first-run cost (6.97 s / 34.49 s), but cannot safely cache the changed-input result.

**inferred**: finish-and-revalidate is the bounded-file default; optional cancellation requires changed keyed inputs, reliable owned cleanup and protection against endless restarts. For a 180 s run edited at 30 s, finishing plus retry projects to 360 s; cancellation plus retry to 210 s plus cleanup. These are arithmetic, not observed three-minute trials. Separate execution is needed so a slow file cannot occupy the only runner slot fast tests need.

### 4. Isolation

**verified by experiment**, Cezar `13351da`: both copies ran the real test `free default port starts on the requested bind host`. Copy A was instrumented only to hold its successful listener until B finished. A passed; unchanged B failed with `Cockpit port 4321 on ::1 is already in use`. The failure arrived in 1.40 s. No pre-existing listener was stopped. This proves an isolation defect under overlap, not its natural occurrence rate.

**read in source code**, Cezar `serve-port.test.ts:178` assumes the fixed IPv6 default port; `task-cli.test.ts:21` separately checks then releases a discovery port before the CLI binds it, leaving a check-then-bind race. **verified by experiment**, the unmodified concurrent full-suite pair reproduced it: copy A failed before discovery because copy B owned `127.0.0.1:4322`; A passed 69/70 and B 70/70. Thus the paired A cost includes an early-exiting test. Most other fixtures bind port 0 and use `mkdtemp` plus per-fixture `CEZ_HOME`. Squeal's `test/e2e/install.ts` uses a version/Node/platform cache and unique install directories with rename-winner publication; its fixtures use unique repository/socket directories and kill daemons belonging to their plugin copy. Daemon scratch keys include repository identity and worktree path. The shared cache race was **not observed to corrupt an install** in these runs.

**inferred**: require per-run filesystem/state roots, ephemeral or explicitly serialized fixed ports, immutable/atomic shared caches and cleanup of owned descendants. `TMPDIR` alone cannot contain hardcoded `/tmp` paths; the containment edits used here demonstrate why. A worktree lock does not reserve TCP ports across other worktrees or repositories.

### 5. Inheritance

**verified by experiment**, Git plus Node 24.21.0: a minimal copy of the suite's `git archive HEAD` pattern executed `v1` before committing and `v2` afterward, with the exact same worktree file SHA-256. The commit changed what the suite read without changing the candidate file-content key. The failed copied Cezar build independently showed that source identity does not establish packaged-artifact identity.

**read in source code**, Squeal `25580c8`: 003 D3/D5 exclude arbitrary filesystem reads and spawned-child imports from the module graph; these need declared `inputs`. `assembleClosure` currently returns `complete: false` for every closure, so “inherit only when complete” presently means inherit nothing. In particular, adding `src/**` does not key an ignored `dist/**` binary, an archived commit, an installed plugin outside the worktree, or live network state.

**inferred**: default slow-project inheritance off until a project contract covers actual artifact/fixture bytes, environment/tool versions and external state. Hermetic suites with equivalent stable inputs may inherit passes and failures. Read tracked worktree plugins instead of `HEAD`, or key the archived tree. Materialize external binaries into keyed snapshots; use hermetic services or disable reuse for live network assertions. Disabling cross-worktree inheritance alone cannot fix missing inputs within one worktree.

## Recommendation and open questions

Use one cooperative slow slot per host/user budget, a separate background execution process, bounded runner concurrency and low CPU priority; offer Linux cgroups as an optional stronger limit. Recheck pressure between files with bounded deferral. Keep per-file stability/discard and install-overlap rules. Require resource isolation and declared artifact inputs before enabling reuse. This favors trustworthy state over an optimistic pass from a cheaper incomplete key.

Calm-load repeated trials, useful default concurrency/quota thresholds, identifying manual validation, exact process-tree resource totals, collision frequency beyond this one unmodified pair and macOS lifecycle behavior remain unmeasured. The raw history supports a guard, not a universal threshold. A spec must decide the cooperative budget's scope, maximum defer time and opt-in input contract.

## Sources

- Local specs: [001 D5/D11](../../001-core-loop/spec.md), [002 D3](../../002-codex-adapter/spec.md), [003 D1/D5](../../003-node-test-runner/spec.md); versions above.
- Squeal source: `src/core/scheduler/{scheduler,tiers,stability}.ts`, `src/core/keys/closure.ts`, `src/core/daemon/{paths,scratch}.ts`, `test/e2e/{harness,install,plugins}.ts` at `25580c8`.
- Cezar source: `packages/cezar/test/e2e/{serve-port,task-cli,package-cli,inline-contract}.test.ts` and `scripts/test-git-env.mjs` at `13351da` (read from `/home/agent/projects/cezar`, executed only from copies).
- [Node 24.21.0 OS API](https://nodejs.org/download/release/v24.21.0/docs/api/os.html); [nice](https://man7.org/linux/man-pages/man1/nice.1.html), [ionice](https://man7.org/linux/man-pages/man1/ionice.1.html), [taskset](https://man7.org/linux/man-pages/man1/taskset.1.html), [loadavg](https://man7.org/linux/man-pages/man5/proc_loadavg.5.html); [systemd resource control](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html); [archived Apple priority manual](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/getpriority.2.html). Fetched 2026-10-08; excerpts preserved under probes. Linux web manuals are current snapshots, not necessarily the installed tool version.
- [Probe instructions and preserved evidence](probes/slow-suite-runtime/README.md).
