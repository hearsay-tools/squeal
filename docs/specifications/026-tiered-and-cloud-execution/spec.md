# Tiered local checks and remote execution providers

Stage: approved (the human, 2026-11-24: "Approve and build", D2 "2 min default", build order "Track 1 + Track 2 scaffold"; D5 default scope pending the human's answer). Written 2026-11-24 from `research/tiered-pre-pr.md` (026-01), `research/boat-sandboxes.md` (026-02), `research/daemonless-hooks.md` (026-03) and `research/agent37-sandboxes.md` (026-04), after the human asked to spec both Track 1 (local slim/tiered checks) and Track 2 (provider-agnostic remote execution targeting Agent37 EU `vm`, with a clean seam for future providers and custom LAN wake/start logic).

## Problem

Large repositories (Squeal, cezar) with 10+ concurrent worktrees hit two connected cost limits:

1. **Local cost stays high even when heavy tests leave `edit`.** Today's `checks` key already lets a project put complexity and oxlint at `edit` and test groups at `manual` or `stop`, but seven daemon paths still start and reopen the Vitest keying host (0.5 to 1.1 GB RSS per worktree) at start and on every edit, including `README.md` edits (`tiered-pre-pr.md` Q1). Without a runner host, an idle daemon still holds 274 to 343 MB RSS per worktree plus 138 MB per clone and 2.2% of one core (`daemonless-hooks.md` Q3), and Squeal's oxlint provider spawns three processes per pass (500 ms p50 vs 70 to 80 ms for one raw oxlint process; `daemonless-hooks.md` Q2). On the pre-PR side, a closure-complete run re-keys 38 to 90% of Squeal and 74% of cezar even with CI imports, saving zero CPU vs live daemons; only a narrow pre-PR run (0.05 to 1.3% of the suite) is cheap, and no command selects it from a base ref (`tiered-pre-pr.md` Q2, Q3). Meanwhile `squeal code --base` skips `manual` groups by default and hides broken tests behind `incomplete` (`tiered-pre-pr.md` Q3).
2. **Remote execution in Spec 021 Part 3 cannot take over a worktree's test load.** Today's remote lane sends only Vitest `background` tiers to one static, always-on SSH host, keeps planning (`affected`, `closure`, `environment`, `testFiles`) on a local Vitest host (0.3 to 2.4 GB RSS), strips coverage, refuses cross-platform remotes (blocking macOS laptops from Linux VMs and Linux CI exports), and has no lifecycle seam for provisioning, starting, waking, sleeping or deleting machines (`boat-sandboxes.md` Q1, Q7; `agent37-sandboxes.md` Q1, Q5).

The two tracks are non-exclusive: Track 1 makes local daemons cheap and pre-PR runs narrow; Track 2 offloads all test execution and planning to per-worktree remote machines (cloud VMs or LAN hosts) behind one provider seam while keeping hooks, the shared SQLite store (Decision 0002), and cheap local checks local.

## Goals

### Track 1: tiered local checks

1. When a runner has no test group at `edit` or `pause`, its runner host does not start on daemon start, edits, touches, observed updates, CI imports or idle re-walks; it starts only on an explicit test request and closes again when idle (D1).
2. A daemon for a repository with no test group at `edit` or `pause` can exit cleanly between edit bursts (`daemon.unusedExitMinutes`) for 0 idle RAM, after fixing why `unusedExitMinutes` failed to fire in the probe, and no-daemon reads report honestly when working-tree files changed since the last pass (D2).
3. Squeal's oxlint provider runs one process on the common edit path instead of three, cutting pass time from ~500 ms to ~80 to 120 ms (D3).
4. `squeal run <group> --base <ref> [--wait]` runs only the narrow set of tests (or linted files) selected by changes since the merge base, reuses current/imported results, and states honestly what remains for full-group or CI runs (D4).
5. `squeal code --base` does not hide broken tests in `manual` groups behind `incomplete` under a tiered policy, and supports `--narrow` for fast local pre-PR checks (D5).

### Track 2: provider-agnostic remote execution and Agent37

6. One typed `RemoteMachineProvider` seam separates machine provisioning, startup, wake, sleep, teardown and SSH transport from the runner-host protocol and lane. Adding a new cloud or LAN provider requires implementing one provider module with zero changes to core sync, proof, scheduling or lanes (D6).
7. Three built-in providers ship against that seam: existing static `ssh` (backward compatible), `command` (user-defined scripts/commands for LAN Wake-on-LAN, local VMs, or bespoke provisioning without building extra cloud providers now), and `agent37` targeting EU `vm` (4 vCPU / 8 GB) with proxy-aware WebSocket SSH tunneling and sleep/wake lifecycle (D7).
8. Hybrid 2A execution sends all configured test tiers (`edit`, `background`, `slow`, `group`), all runners (`vitest`, `node-test`, `pytest`) and runner planning (`affected`, `closure`, `testFiles`, `environment`) to the remote machine, so zero local runner hosts start while the remote is active (D8).
9. Coverage maps payloads to relative `CoverageRecord`s on the remote runner host and streams compact records back to the local `code.sqlite` store (D9).
10. Cross-platform remote execution (for example, macOS laptop to Linux VM) works opt-in via a remote environment key space in the local store, matching Linux CI exports without polluting local native keys (D10).
11. Connect-time disk flush probing catches degraded-disk machines (such as boat.dev's 9700X class) before storing false timeout failures (D11), and CLI commands inspect, sleep and prune tracked machines (D12).

## Non-goals

- Running complexity or lint inline inside `PostToolBatch` hooks (`daemonless-hooks.md` Q2, Q5: 250 to 900 ms p50, over the 200 ms warn limit; cold typed ESLint 6.8 to 7.3 s, over the 2 s timeout).
- Running the full daemon inside a cloud sandbox (2B) as Squeal's architecture (`boat-sandboxes.md` Q1: loses Decision 0002 cross-worktree store reuse and still requires a local process for <80 ms hooks).
- Mutagen or `boat push` for file sync (`boat-sandboxes.md` Q5; 021 `remote-execution.md` Q3, Q6: Mutagen leaks `.env`, returns 0 on stale/missing files, 10 s Linux polling, SSPL; `boat push` is non-incremental at 13 s for 1 file).
- Narrowing test closures or changing `KEY_FORMAT_VERSION` for type-only imports (closed in 022-11, 022 phase 2 and 015-15).
- Agent37 US `default` (gVisor) as a default or recommended type (`agent37-sandboxes.md` Q4: 3 to 4x slower, 5 false timing failures in 50 files, US-only).
- Building native drivers for other cloud vendors (boat.dev, GCE, Fly, Modal) in this spec. The `RemoteMachineProvider` seam (D6) and `command` provider (D7.2) let them plug in later.
- Google Colab (ToS and ephemeral sessions).

## Design

### Part 1: Track 1 (tiered local checks)

#### D1. Moment-aware runner keying

Policy stays on `checks` (019 D1); no new top-level mode key is added.

1. **Active-on-edit predicate.** A runner (`vitest`, `node-test`, `pytest`) is *eager* for a worktree when at least one resolved test group belonging to that runner has moment `edit` or `pause`. Otherwise (all its groups are `manual`, `stop`, or `commit`) that runner is *deferred*.
2. **Deferred paths.** While a runner is deferred, the daemon does not start or reopen that runner's host on any of the seven background paths identified in `tiered-pre-pr.md` Q1:
   - daemon start baseline (`bootstrap.ts`: `readEnvironments`, `listTestFilesOf`, missing closures);
   - content revisions (`refinement.ts`: `fetchRunnerPart` calls to `invalidate`, `environment`, `affected`, `closure`);
   - touched files (`queueTouched`);
   - observed-path updates (`queueObserved`);
   - CI imports naming files (`imports-waiting.ts`: store imports still apply by committed blob without waking a runner host);
   - idle per-version import re-walk (`import-rewalk.ts`).
3. **Stored-graph re-keying.** While a runner is deferred, content revisions still update the revision ledger, complexity counts, lint passes, and static re-keying from stored closures and stored import edges (021-30) without opening a runner host. Tests whose closure is unknown stay `unknown` (not current), never `pass`.
4. **On-demand wake.** A deferred runner starts its host lazily on the first explicit request that requires it: `squeal run <group>`, `squeal run --all`, `squeal run --slow`, Stop's required-group request (019 D4), a `commit` group trigger on `HEAD` move (019 D5), or a named `status --wait <path>` that needs runner resolution. When it opens, it catches up any pending invalidations since daemon start (or does a fresh baseline listing).
5. **Idle close.** Once explicit work finishes, `runner.hostIdleMinutes` (021 D20) closes the runner host again and returns its memory (0.5 to 1.1 GB on Squeal/cezar).

#### D2. Short-lived daemon for edit-free test policies

From `daemonless-hooks.md` Q5, built on today's daemon lifecycle (`src/core/daemon/lifecycle.ts`) rather than a second helper process:

1. **Fix `daemon.unusedExitMinutes`.** First diagnose and fix why a `norunner` daemon with `daemon.unusedExitMinutes: 0.5` and one registered consumer stayed alive for 20 minutes in `probes/daemonless-hooks/restart.sh`. Add a real-process test proving that a daemon with an idle registered consumer exits within `unusedExitMinutes`, calls `markRest`, and restarts silently on the next hook.
2. **Short default for edit-free policies.** When a repository's resolved `checks` have no test group at `edit` or `pause` and `daemon.unusedExitMinutes` is not explicitly set in `squeal.config.json` or user config, default `daemon.unusedExitMinutes` to `2` minutes (instead of `30`). An explicit `daemon.unusedExitMinutes` in project or user config always wins (so users who want a warm ESLint worker or continuous watcher can set `30` or higher).
3. **Zero idle memory between bursts.** Between edit bursts, the worktree holds 0 MB daemon RAM and 0% idle CPU. The next hook restarts the daemon (~200 ms to first `status --wait`, ~1.0 to 1.2 s start-scan CPU; `daemonless-hooks.md` Q5) and delivers updated complexity and lint results on the next hook boundary.
4. **Honest no-daemon staleness (vision principle 2).** When `squeal status`, `squeal code`, or `squeal lint` answers with no daemon running, check cheaply whether `HEAD` moved or tracked/untracked files modified since the last recorded revision (for example `git status --porcelain=v2` or `HEAD` + mtime comparison). When edits occurred while no daemon ran, print a one-line notice naming the last recorded revision and that results may predate working-tree edits until the next hook or `squeal start` runs.
5. **Proof check.** The row's verification compares burst-restart CPU against the slim daemon's 2.2% idle core over repeated edit bursts (as `restart.sh` intended) and records the numbers in the row's notes.

#### D3. Single-process oxlint pass

`daemonless-hooks.md` Q2 measured Squeal's oxlint provider at 500 to 510 ms p50 (three spawns: `--print-config` 250 ms, `--debug files` 80 to 90 ms, lint 90 to 100 ms) vs 70 to 80 ms for one raw `oxlint --format json --threads 1` process.

1. **Blob-keyed config cache.** Cache the resolved `--print-config` output keyed by `(oxlint_version, config_closure_blob_hashes)` in `lint.sqlite` (and in-process memory). On a cache hit, including across short-lived daemon restarts (D2), skip spawning `oxlint --print-config` (saves ~250 ms).
2. **Conditional `--debug files`.** Run `oxlint --format json` directly on the target paths without a prior `--debug files` spawn. Only when oxlint's output accounts for fewer files than requested (indicating ignore rules or unsupported extensions) run `--debug files` to classify ignored paths accurately (saves ~80 to 90 ms on the common edit path).
3. **Correctness invariant.** Lint keys, ignore classification, and transition semantics (spec 017) do not change; any config blob change invalidates the cached `--print-config` entry immediately.

#### D4. Narrow pre-PR run from a base ref

Extends 019 D6's `squeal run <group> <path>...` with `--base <ref>`:

1. **Command.** `squeal run <group> --base <ref> [--wait [ms]] [--json]`. Passing both `--base <ref>` and positional `<path>...` is a usage error (exit 2). An unknown `<ref>` or invalid merge base is a usage error (exit 2) naming the git error.
2. **Changed paths.** Collects paths changed between `git merge-base <ref> HEAD` and the current working tree (committed branch diff plus staged, unstaged, and non-ignored untracked files, matching 020 D2).
3. **Selection.**
   - For a **test group**: passes the changed paths into 019 D6's narrow selection rule (changed test files in the group, namesakes of changed sources, or direct importers plus up to `runner.tierSize` shortest other direct importers). Files already current at their keys (including from CI imports) do not rerun; their results count.
   - For a **lint group**: runs the group's linters on the changed paths that match the group's rules.
4. **Honest reporting (vision principle 2).** The command's text and `--json` output report:
   - the merge base SHA and count of changed paths;
   - the selected narrow files and their verdicts (passed, failed, not-finished, from store/CI vs run);
   - the count of other files in `<group>` reached by closure that this narrow run left out, explicitly stating they were not run here and wait for `squeal run <group>` or CI;
   - changed paths that selected no test file in `<group>`.
   A narrow run never marks the whole group current and never says "all tests passed".
5. **Skill and status.** `squeal checks` and the squeal skill name `squeal run <group> --base <ref> --wait` as the pre-PR command when a repository has `manual` test groups.

#### D5. `squeal code --base` under tiered policies

Fixes the gap from `tiered-pre-pr.md` Q3 where a repository with all test groups at `manual` gets `incomplete` on broken tests:

1. **Headline honesty for left-out groups and stored failures.** When `squeal code --base` leaves out a `manual` test group (020 D14.1):
   - If zero test groups are in scope (every test group is `manual` and neither `gate.groups` nor `--group` included one), say so on the headline verdict line (`Code gate: incomplete (0 test groups in scope; manual groups left out: <names>; add --group <name>, use --narrow, or set gate.groups)`).
   - If the local store already holds a current `fail` at the head key for a left-out loading test file, surface that stored failure in the report (`failedTests` / headline warning) instead of hiding it solely behind `incomplete (left-out)`.
2. **`--narrow` selection flag.** Add `squeal code --base <ref> --narrow` (combinable with `--group <name>`): selects only D4's narrow test set instead of the full closure (cutting local pre-PR runs from 38 to 90% of the suite to ~0.05 to 1.3%). Functions whose full loader set includes non-selected tests keep accurate `loaders.leftOut` / `incomplete` semantics so a narrow gate never claims full-closure coverage (vision principle 2).
3. **Default scope decision (open question 1).** Draft keeps 020 D14.1's default (leave `manual` groups out unless `gate.groups` or `--group` names them) so `squeal code --base` never accidentally triggers a 10 to 15 minute full-closure run locally, while making the gap unmistakable and adding `--narrow`.

---

### Part 2: Track 2 (provider-agnostic remote execution and Agent37)

#### D6. The `RemoteMachineProvider` seam

All remote test execution (runner-host stdio protocol, tree delta sync, blob proof, environment comparison, remote planning, remote coverage mapping, admission, `whenLost` fallback, status notes) talks **only** to the machine seam below and never branches on a vendor name.

1. **Extended `SshTarget` (`src/core/runner-host/remote/ssh.ts`).**
   ```ts
   export interface SshTarget {
     readonly destination: string;
     /** Extra ssh flags placed before `destination` (e.g. ProxyCommand, IdentityFile, port, known_hosts). */
     readonly args?: readonly string[];
     readonly ssh?: string;
     readonly env?: NodeJS.ProcessEnv;
   }
   ```
   `sshArgs()` always prepends `["-T", "-o", "BatchMode=yes"]`, then `target.args ?? []`, then `destination` and `command`. Existing callers passing only `{ destination }` behave identically.
2. **Core provider contract (`src/core/runner-host/remote/provider.ts`).**
   ```ts
   export interface MachineCapabilities {
     /** True when the remote tree holds `.git` (lets D19 `needsRepository` tests run remotely). */
     readonly hasGitRepository: boolean;
     /** True when closing idle SSH connections lets the provider stop compute billing or sleep the host. */
     readonly sleepOnIdle: boolean;
     /** True when the host key may rotate across relocations/restarts (provider supplies its own SSH args). */
     readonly ephemeralHostKey: boolean;
   }

   export interface MachineRequest {
     readonly repositoryKey: string;
     readonly worktreeId: WorktreeId;
     readonly worktreeRoot: AbsolutePath;
     readonly commonDir: AbsolutePath;
     readonly remoteUrls: readonly string[];
     /** Local Node version string (e.g. `v26.13.0`), used by providers that provision Node. */
     readonly nodeVersion: string;
     readonly log: (line: string) => void;
   }

   export type ReleaseReason = "idle" | "daemon-exit" | "worktree-removed";

   export interface RemoteMachine {
     /** Stable display id for status and logs, e.g. `build-box`, `agent37:eu:vm:c0myhlo00m`, `cmd:lan-1`. */
     readonly id: string;
     readonly provider: string;
     readonly ssh: SshTarget;
     readonly places: RemotePlaces;
     readonly capabilities: MachineCapabilities;
     /** Ensures the machine is awake and SSH-reachable before opening a runner-host channel. */
     wake(signal?: AbortSignal): Promise<void>;
     /** Notifies the provider after the daemon closes idle SSH channels so compute may sleep. */
     sleep(): Promise<void>;
     /** Lifecycle release: `idle` sleeps, `daemon-exit` sleeps/detaches, `worktree-removed` destroys. */
     release(reason: ReleaseReason): Promise<void>;
   }

   export interface RemoteMachineProvider {
     readonly kind: string;
     /** Validates provider-specific config under 001 D11 loader rules; returns problem text or `null`. */
     validate(config: Record<string, unknown>): string | null;
     /** Acquires or reuses a machine for one worktree and brings it to an SSH-ready state. */
     acquire(request: MachineRequest, config: Record<string, unknown>): Promise<RemoteMachine>;
   }
   ```
3. **Provider registry (`src/core/runner-host/remote/providers/index.ts`).** Maps `provider` kind strings (`"ssh"`, `"command"`, `"agent37"`) to `RemoteMachineProvider` instances. Adding any future provider (boat.dev, GCE, Fly, LAN daemon, etc.) adds one folder under `src/core/runner-host/remote/providers/<kind>/` and one registry line; zero changes to `lane.ts`, `connect.ts`, `tree*.ts`, or the scheduler.
4. **User configuration (`~/.config/squeal/remote.json`).** Backward compatible with 021 D9:
   - An existing entry `{ "target": "build-box" }` (no `provider` key) resolves to `provider: "ssh"`, `lanes: ["background"]`, `runners: ["vitest"]`, `planning: "local"`, `coverage: "off"`, `environmentMode: "match-local"`.
   - New optional keys on a repository entry:
     - `provider`: `"ssh"` (default) | `"command"` | `"agent37"`.
     - `providerConfig`: provider-specific object (for `"ssh"`, `target` may stay top-level as today).
     - `runners`: `"all"` | array of `"vitest" | "node-test" | "pytest"` (keeps singular `runner` as alias).
     - `lanes`: `"all"` | array of `"background" | "edit" | "slow" | "group"`.
     - `planning`: `"local" | "remote"` (defaults to `"remote"` when `lanes` is `"all"` or includes `"edit"`, else `"local"`).
     - `coverage`: `"off" | "remote"` (defaults to `"remote"` when `lanes` is `"all"` or includes `"edit"`, else `"off"`).
     - `environmentMode`: `"match-local" | "remote-key"` (default `"match-local"`).
     - `idleSleepMinutes`: number >= 0 (default `10` when `capabilities.sleepOnIdle` is true, `0` otherwise).
     - `diskCheck`: `{ enabled?: boolean; maxWriteMs?: number; onSlowDisk?: "warn" | "refuse" }` (default `{ enabled: true, maxWriteMs: 10, onSlowDisk: "warn" }`).
   - Repository opt-out (`squeal.config.json` `remote.allowed: false`) continues to forbid all providers.

#### D7. Built-in providers: `ssh`, `command`, and `agent37`

##### D7.1 `ssh` provider (static always-on host)

Wraps today's `target` string with `capabilities: { hasGitRepository: false, sleepOnIdle: false, ephemeralHostKey: false }` and no-op `wake`, `sleep`, and `release`. Preserves 100% of Spec 021 Part 3 behavior.

##### D7.2 `command` provider (custom provisioning, startup and wake seam for LAN and bespoke setups)

Lets users plug in any LAN machine (Wake-on-LAN, local Proxmox/Docker/KVM VM, Tailscale box, SSH jump host) or external CLI (including custom boat.dev scripts) without waiting for a built-in provider.

1. **Config (`providerConfig`).** Every hook is an argument list (`string[]`), never a shell string (matching 020 D15):
   - `acquire: string[]` (required): provisions or selects the machine and prints one JSON line to stdout:
     ```json
     {
       "v": 1,
       "id": "lan-ryzen",
       "destination": "dev@192.168.1.50",
       "sshArgs": ["-p", "2222"],
       "node": "node",
       "cache": ".squeal-remote",
       "hasGitRepository": false,
       "sleepOnIdle": true,
       "ephemeralHostKey": false,
       "state": { "mac": "aa:bb:cc:dd:ee:ff" }
     }
     ```
   - `wake?: string[]`: called before reconnecting after idle sleep (for example sending a Wake-on-LAN packet and waiting for TCP port 22).
   - `sleep?: string[]`: called after Squeal closes idle SSH connections.
   - `release?: string[]`: called on daemon exit or worktree removal.
   - `timeoutMs?: number`: per-hook deadline (default `120000` for `acquire`/`wake`, `30000` for `sleep`/`release`).
2. **Environment passed to hooks.** `SQUEAL_WORKTREE_ID`, `SQUEAL_WORKTREE_ROOT`, `SQUEAL_REPO_KEY`, `SQUEAL_NODE_VERSION`, and (for `wake`/`sleep`/`release`) `SQUEAL_MACHINE_ID`, `SQUEAL_RELEASE_REASON`, and `SQUEAL_MACHINE_STATE` (JSON string of `state`). Non-zero exit or invalid JSON fails `acquire`/`wake` with stderr context (triggering `whenLost` fallback).
3. **Security boundary.** `command` configuration lives only in user-owned `~/.config/squeal/remote.json`, never in repository files; `squeal.config.json` `remote.allowed: false` still blocks it.

##### D7.3 `agent37` provider (EU `vm` default)

Built from the measurements in `agent37-sandboxes.md` (0.61 s 1-file / 1.50 s 10-file edit-to-verdict, 0.22 to 0.87 ms `dsync`, 0.68 to 1.65 s memory-preserving wake, `$0` compute while sleeping, `$0.09/GB-month` disk while kept):

1. **Config (`providerConfig`).**
   - `region`: `"eu"` (default) | `"us"` | `"ap-south"`.
   - `type`: `"vm"` (default) | `"performance"` | `"default"`. Validation rejects `region: "eu"` with `type: "default"` (`400 invalid_request` on Agent37) and logs a warning if `type: "default"` (gVisor) is explicitly configured in `us`.
   - `vcpu`: default `4`; `memoryGb`: default `8`; `diskGb`: default `10`.
   - `autoSleepMinutes`: default `10` (passed to Agent37 `auto_sleep`).
   - `apiKeyEnv`: default `"AGENT37_API_KEY"` (name of env var holding the key; Squeal never stores the key in `remote.json`, logs, or command-line arguments).
   - `sshKeyPath`: path to the private SSH key registered in the Agent37 workspace (defaults to standard user SSH agent/keys).
   - `bootstrap`: `"git-bundle"` (default) | `"tree-sync"`.
   - `apiBaseUrl`: default `"https://api.agent37.com"` (overridable for testing against local mocks).
   - Proxy support: all API calls and the WebSocket tunnel honor `HTTPS_PROXY` / `NO_PROXY`.
2. **Built-in proxy-aware tunnel (`squeal remote-tunnel agent37 <instance-id>`).**
   - Vendor `agent37 tunnel` ignores `HTTPS_PROXY` (`agent37-sandboxes.md` Q3). Squeal ships a ~90-line dependency-free WebSocket tunnel subcommand (proven in `probes/agent37-sandboxes/tunnel.mjs`: HTTP `CONNECT` when `HTTPS_PROXY` is set, TLS, WebSocket upgrade to `<instance-id>-22022.agent37.app` with `X-Agent37-Key` read from `apiKeyEnv`, binary frame bridge to stdio).
   - `RemoteMachine.ssh.args` sets `-o ProxyCommand=<squeal> remote-tunnel agent37 <id>` plus `-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null` (Agent37 regenerates host keys on host relocation; transport authentication is carried by TLS + `X-Agent37-Key` + SSH key). No `agent37` CLI installation is required.
3. **Provisioning and local git-bundle bootstrap (`acquire`).**
   - Tracks `(provider, worktreeId) -> { instanceId, region, type, createdAt, lastUsedAt, worktreeRoot }` in `$XDG_STATE_HOME/squeal/remote-machines.json` (fallback `~/.local/state/squeal/remote-machines.json`).
   - Reuses an existing instance for `worktreeId` if `GET /v1/instances/<id>` reports it exists (waking if `sleeping`).
   - Otherwise calls `POST /v1/instances` (1.2 s), installs matching Node if absent (~2 s), and when `bootstrap: "git-bundle"` creates a local `git bundle` of `HEAD` + tags, streams it over SSH, clones it into the remote tree directory, and runs lockfile install (~31 s total on EU `vm`, faster than Agent37's 55 s `POST /fork` and requiring **zero** git credentials on the cloud VM). Sets `capabilities.hasGitRepository = true`.
4. **Sleep and wake lifecycle (compute billing control).**
   - Agent37 charges compute (`$0.0301/h` for 4/8 `vm`) only while awake; sleeping instances cost `$0` compute and do not count against the awake-memory quota (`agent37-sandboxes.md` Q5). Disk costs `$0.09/GB-month` (`$0.90/month` for 10 GB) until deleted.
   - Because SSH keepalives prevent auto-sleep (`agent37-sandboxes.md` Q1), the remote lane never sends SSH keepalives past `idleSleepMinutes`. After `idleSleepMinutes` with no active run or edit, the lane closes its SSH channels and calls `machine.sleep()`, which sends `POST /v1/instances/<id>/sleep` (4.5 to 6.4 s) so compute billing stops immediately.
   - On the next edit or explicit request, `machine.wake()` opens SSH (or calls `exec`/wake) to restore the memory checkpoint (~0.7 to 1.7 s) and reconnects the runner-host channel. If Agent37 rebuilt the instance instead of restoring memory, the lane detects the closed/missing host, re-runs `startRemoteHost`, syncs the delta, and continues transparently.
   - On `release("worktree-removed")`: calls `DELETE /v1/instances/<id>` and removes the state entry so disk billing stops too. On `release("daemon-exit")`: calls `sleep()` and keeps the sleeping instance for fast wake on the next session.

#### D8. Hybrid 2A: all tiers, all runners, and remote planning

Extends `src/core/runner-host/remote/{lane,daemon-lane,connect,settings}.ts` (solving `boat-sandboxes.md` Q7 items 1, 2, 3):

1. **All configured lanes.** `goesRemote()` checks the configured `lanes` set (`background`, `edit`, `slow`, `group`, or `all`) instead of hardcoding `background`-only. Slow and explicit group lanes open their own remote runner-host process on the same `RemoteMachine` (reusing one SSH ControlMaster per machine while awake, closed on idle sleep so auto-sleep works).
2. **All runners.** `withDaemonRemoteLane` wraps every runner listed in `runners` (`vitest`, `node-test`, `pytest`, or `all`). Runner-host start options translate local `tempDir` and `cacheDir` paths to remote-owned directories under `<remote tree>/tmp` and `<remote cache>`.
3. **Remote planning (`planning: "remote"`).**
   - `testFiles()`, `environment()`, `affected()`, `closure()`, and `enumerate()` route to the remote runner host while the machine is ready.
   - On connect, the remote host warms its first `affected` (6 to 8 s on EU `vm`) before reporting ready.
   - **Result:** zero local Vitest, node:test, or pytest runner hosts start while the remote is active. The local daemon stays at ~274 to 343 MB RSS (or exits between bursts under D2).
   - When the remote is `down` (unreachable or refused): `whenLost: "local"` lazily starts the local runner host as fallback; `whenLost: "not-run"` leaves test files `unknown` without starting a local runner host.
4. **Repository-reading tests (021 D19).** When `machine.capabilities.hasGitRepository` is `true`, `remote.needsRepository` files run on the remote machine instead of forcing a local runner host (verified 27/27 pass in `boat-sandboxes.md` Q2 and `agent37-sandboxes.md` Q1). D19's guard still catches any unexpected "not a git repository" error and reruns locally without storing a false failure.

#### D9. Remote coverage mapping

Closes `boat-sandboxes.md` Q7 item 4 and Spec 021 D12's deferred coverage row:

1. **Map on the host.** When `coverage: "remote"` and the repository policy has `coverage.enabled: true`, `remoteHostOver` stops stripping `coverage` from `adapterOptions` and `policy()`. Instead, the remote `runner-host` process maps each completed test file's raw V8 coverage payload into Squeal's compact `CoverageRecord` (remapping remote absolute paths under `<tree>/root` to repository-relative paths, ~25 KiB per file vs 1.0 to 1.5 MB raw V8 payloads) and returns the records on the `run` reply.
2. **Local storage.** The local daemon validates the run's blob proof (021 D11.1) and stores the returned `CoverageRecord`s in `code.sqlite` through the normal store-process relay, feeding CRAP and `squeal code --base` identically to local runs.
3. **Opt-out.** Setting `coverage: "off"` in `remote.json` preserves Spec 021 D12's behavior (coverage stripped, environment comparison ignores `coverage`).

#### D10. Cross-platform remote environment key space

Closes `boat-sandboxes.md` Q7 item 5 and `tiered-pre-pr.md` Q3's macOS gap:

1. **Default (`environmentMode: "match-local"`).** Preserves 021 D11.2 unchanged: `compareEnvironment` against the local descriptor must return `equal`. Best when local and remote share `(platform, arch)` (Linux host to Linux VM).
2. **Opt-in (`environmentMode: "remote-key"`).** For cross-platform setups (macOS laptop to Linux VM):
   - Environment validation verifies that the remote's resolved config files match local blobs and that the remote's `node` major/minor/patch matches any pinned version policy, without rejecting `darwin != linux` or `arm64 != x64`.
   - The daemon keys test results and coverage records under the **remote machine's own environment descriptor** (for example `linux/x64/Node v26.13.0`), using the store's existing `(test_file, key)` schema where `key` embeds `environment_hash`.
   - Local native results (darwin) and remote results (linux) coexist in the same store under distinct keys and never masquerade as each other (vision principle 2).
   - Because Linux CI exports (`refs/squeal/<sha>`, spec 018) share the `linux/x64` environment descriptor, a macOS developer using a Linux remote lane with `remote-key` automatically reuses Linux CI exports.
3. **Visibility.** `squeal status` explicitly names the remote execution environment whenever `remote-key` is active (for example `remote agent37:eu:vm (linux/x64, Node v26.13.0); results keyed to remote environment`).

#### D11. Connect-time disk health check

Prevents the slow-disk lottery observed in `boat-sandboxes.md` Q3 (where 3 of 4 boat.dev starts hit 17 to 123 ms 4 KiB `dsync` writes and stored false timeouts):

1. **Probe.** Once per machine incarnation at connect (after Node check, before accepting runs), run 20 writes of 4 KiB with `fsync`/`dsync` inside the remote cache directory (~10 ms total on healthy disks; ~0.4 to 2.5 s on degraded disks).
2. **Threshold and action.** If median per-write sync exceeds `diskCheck.maxWriteMs` (default `10` ms):
   - Record the measurement in daemon log and `squeal status` (`degraded disk: 34 ms/sync, limit 10 ms`).
   - `onSlowDisk: "warn"` (default for `ssh`/`command`): warn in status and continue.
   - `onSlowDisk: "refuse"` (default for managed cloud providers, or user-chosen): refuse the machine (firing `whenLost` fallback, or letting a managed provider retry once on a fresh instance before falling back).

#### D12. CLI and observability

1. **`squeal status`:** names provider kind, machine id, state (`awake`, `sleeping`, `connecting`, `degraded-disk`, `refused`, `unreachable`), active runners and lanes, planning mode (`remote`/`local`), environment mode (`match-local`/`remote-key`), and last proof time.
2. **`squeal ps`:** lists remote runner hosts under their daemon with provider, machine id, and state (`awake`/`sleeping`).
3. **`squeal remote list`:** prints tracked machines from `$XDG_STATE_HOME/squeal/remote-machines.json` (machine id, provider, worktree path, whether worktree still exists on disk, last-used time, status). Supports `--json`.
4. **`squeal remote sleep [<worktree>]`:** closes idle remote SSH channels and asks the provider to sleep the machine immediately.
5. **`squeal remote prune [--dry-run]`:** calls `release("worktree-removed")` for every tracked machine whose worktree path no longer exists on disk, stopping disk charges for orphaned cloud VMs.
6. **`squeal remote-tunnel agent37 <instance-id>`:** internal proxy-aware WebSocket tunnel invoked by SSH `ProxyCommand` (reads API key from env, never from CLI args).

## Slices

Each row ships and works alone. Track 1 and Track 2 are independent and can run sequentially or in parallel.

| Row | Track / Wave | Design | Scope |
|---|---|---|---|
| 026-05 | Track 1 / Wave 1 | D1 | Moment-aware runner keying (defer all 7 keying paths when no test group is at `edit`/`pause`; lazy open on explicit request) |
| 026-06 | Track 1 / Wave 1 | D3 | Single-process oxlint pass (blob-keyed `--print-config` cache in `lint.sqlite`, conditional `--debug files`) |
| 026-07 | Track 1 / Wave 1 | D4 | Narrow pre-PR command `squeal run <group> --base <ref> [--wait] [--json]` (tests + lint, honest omission wording, skill/checks update) |
| 026-08 | Track 1 / Wave 1 | D5 | `squeal code --base` under tiered policies (headline honesty for 0 in-scope groups + stored failures in left-out groups + `--narrow`) |
| 026-09 | Track 1 / Wave 2 | D2 | Fix `daemon.unusedExitMinutes` not firing, 2-min default for edit-free policies, no-daemon staleness notice, burst-restart CPU proof |
| 026-10 | Track 2 / Wave 3 | D6, D7.1, D7.2, D12 | Wave 0 scaffold for Track 2: `RemoteMachineProvider` seam, extended `SshTarget`, provider registry, `remote.json` schema, `ssh` + `command` providers, `remote-machines.json`, `squeal remote list\|sleep\|prune` |
| 026-11 | Track 2 / Wave 4 | D8 (lanes & runners) | All lanes (`edit`, `slow`, `group`, `background`) and all runners (`vitest`, `node-test`, `pytest`) over `RemoteMachine` |
| 026-12 | Track 2 / Wave 4 | D8 (remote planning & git) | Remote `affected`/`closure`/`testFiles`/`environment` (0 local runner hosts while remote ready), `hasGitRepository` integration with D19 |
| 026-13 | Track 2 / Wave 5 | D9, D11 | Remote coverage payload-to-`CoverageRecord` mapping on runner host + connect-time `dsync` health check |
| 026-14 | Track 2 / Wave 5 | D10 | Cross-platform `environmentMode: "remote-key"` (distinct environment key space in local store + Linux CI import reuse) |
| 026-15 | Track 2 / Wave 6 | D7.3, D12 | `agent37` provider (EU `vm` default, local git-bundle bootstrap over SSH, `squeal remote-tunnel agent37`, idle SSH close + sleep/wake, delete on worktree removal) |
| 026-16 | Both / Wave 7 | Proof | End-to-end suite (local `sshd` + `command` provider + mock Agent37 API + opt-in live Agent37 EU `vm` dogfooding) and `lessons.md` |

Wave 1 rows (`026-05` to `026-08`) touch disjoint areas (scheduler keying, oxlint provider, CLI run command, code gate) and can run in parallel. Wave 3 (`026-10`) establishes the reviewed `RemoteMachineProvider` interface before Waves 4 to 6 build on it (`docs/process.md` step 4).

## Testing

- **Track 1:**
  - D1: fixture daemon with Vitest at `manual` and oxlint at `edit`; assert 0 `runner-host` processes after start, after editing `src/` and `README.md`, after CI import, and after idle ticks; assert `runner-host` opens on `squeal run unit --wait` and closes after `runner.hostIdleMinutes`.
  - D2: real-process test reproducing `restart.sh` with `unusedExitMinutes` set short and an idle registered consumer; assert clean `idle` exit, silent restart on next hook, and honest staleness warning from `squeal status` after an external edit while down.
  - D3: spy/instrument oxlint spawn counts across repeated edits with unchanged vs changed `.oxlintrc.json` and ignored vs included files; assert 1 spawn on common edit, 2 only on config change or ignored file.
  - D4: git fixture with branch commits + uncommitted edits; assert `squeal run unit --base main --wait` selects only changed tests/namesakes, reuses current results, names omitted closure files, and rejects `--base` combined with positional paths.
  - D5: fixture with all test groups at `manual` and a broken test; assert `squeal code --base` surfaces the 0-groups headline and stored failure, and `--narrow --group unit` runs only the narrow set while keeping `loaders.leftOut` honest.
- **Track 2:**
  - D6/D7.1/D7.2: unit and integration tests for provider registry, backward-compatible `remote.json`, `command` provider (`acquire`/`wake`/`sleep`/`release` with fake scripts and failure/timeout handling), and `squeal remote list|sleep|prune`.
  - D8/D9/D10/D11: local `sshd` (or loopback mock channel) end-to-end tests covering all 3 runners (`vitest`, `node-test`, `pytest`), `edit`/`slow`/`group`/`background` tiers, remote planning with 0 local runner hosts spawned, remote `CoverageRecord` round-trip into `code.sqlite`, `remote-key` cross-platform environment isolation + CI import match, and slow-disk `dsync` warning/refusal.
  - D7.3: mock HTTP + WebSocket server testing Agent37 create, reuse, proxy `CONNECT` tunnel, idle SSH close + `POST /sleep`, memory-restore wake, rebuild recovery, and `DELETE` on `worktree-removed`; plus one bounded live EU `vm` dogfooding proof in `026-16`.
- **Hygiene:** no test reads real `HOME`, real `~/.ssh`, or live cloud credentials; `pnpm run check:private` passes on every wave.

## Open questions for the human (spec review)

1. **D5 (`squeal code --base` when every test group is `manual`):** Open (human asked how before/today works vs the options; `026-08` held until decided).
2. ~~**D2 (short-lived daemon default)**~~ Decided 2026-11-24, the human: `2 min default` when no test group is at `edit` or `pause` (overridable in config).
3. ~~**D10 (`remote-key` on macOS)**~~ Accepted 2026-11-24, the human (opt-in `environmentMode: "remote-key"`).
4. ~~**Build order**~~ Decided 2026-11-24, the human: Track 1 Wave 1 and Track 2 Wave 3 scaffold (`026-10`) in parallel.

## References

- Research: `research/tiered-pre-pr.md` (026-01), `research/boat-sandboxes.md` (026-02), `research/daemonless-hooks.md` (026-03), `research/agent37-sandboxes.md` (026-04), and probes under `research/probes/`.
- Specs: 015 (complexity/CRAP), 017 (oxlint provider), 018 (CI exports & environment descriptor), 019 (`checks` moments, narrow `run <group> <path>`), 020 (`squeal code --base`, D14 scope, D15 argument-list commands), 021 (runner host protocol, Part 3 SSH remote lane, D19 `needsRepository`, D20 `runner.hostIdleMinutes`).
- Decisions: `docs/decisions/0002-content-keyed-shared-store.md`.
- Vision: principles 1 (silence stays readable), 2 (results tied to code state, say what is unknown), 3 (non-blocking feedback), 8 (explicit boundaries and policy for remote/external work).
