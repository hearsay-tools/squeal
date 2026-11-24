# 026 Tiered local checks and remote execution: end-to-end proof and dogfooding lessons

Row 026-16, 2026-11-24. Inputs: `spec.md` (D1 to D12, Testing), `status.md`, `tasks/wave-5.md`, `reviews/0.1.620-r2.md`. The automated suite ran against this worktree's `src` (base `639a20bcc`, after 0.1.620). The live proof ran the committed `plugins/claude-code/dist/cli/squeal.mjs` of 0.1.620. The live script, its temporary SSH key, its fixture and its state lived under `/tmp` and were deleted; this file quotes sanitized output only.

## Verdict

Both tracks work end to end. Track 1 keeps Vitest closed on edits under a tiered policy, runs a narrow pre-PR set from a base ref, and gates honestly. Track 2 runs every lane and runner on a remote machine with remote planning and 0 local runner hosts, through the `command` provider, a local Agent37 and the live Agent37 EU `vm`. The live run created, bootstrapped, slept, woke and deleted one instance in 45 s of wall time for $0.000523, and left 0 instances and 0 SSH keys.

Three defects remain, none in the happy path (D1 to D3 below). The coordinator scheduled follow-up row 026-20 for them on 2026-11-24. D1 is the one that breaks vision principle 2: a refused remote under `whenLost: "not-run"` reads as a completed, empty checkpoint in plain `squeal status`.

## What shipped

| Release | Wave | Rows | Design |
| --- | --- | --- | --- |
| 0.1.616 | 1 (+1.5 repairs) | 026-05, 026-06, 026-07, 026-08, 026-10 | D1 moment-aware runner keying; D3 single-process oxlint; D4 `squeal run <group> --base <ref>`; D5 `squeal code --base` 0-groups headline, stored failures, `--narrow`; D6, D7.1, D7.2, D12 provider seam, `ssh` and `command` providers, `remote-machines.json`, `squeal remote list\|sleep\|prune` |
| 0.1.617 | 2 (+2.5) | 026-09, 026-11, 026-17, 026-18 | D2 short-lived daemon (capped idle bound, no-daemon staleness notice); D8.1, D8.2 all lanes and runners; mixed-runner restart and lock-race repairs |
| 0.1.619 | 3 (+3.5) | 026-12, 026-15 | D8.3, D8.4 remote planning and `hasGitRepository`; D7.3 `agent37` provider, `squeal remote-tunnel agent37` |
| 0.1.620 | 4 (+4.5) | 026-13, 026-14 | D9 remote coverage records; D11 connect-time disk check; D10 `environmentMode: "remote-key"` |
| (Wave 5) | 5 | 026-19, 026-16 | 026-19: exact admitted result key for coverage above 256 files; 026-16: this proof |

## Automated end-to-end suite

Two test files, both on real processes: a daemon and CLI from the Claude Code plugin's `dist/` built from `src` into the test cache (`test/e2e/spec-026-build.ts`, the same bundles, runtimes and grammar as `pnpm run build`, never into `plugins/*/dist`). No case reads the real `HOME`, the real `~/.ssh`, or the network.

| File | Case | Proves | Time |
| --- | --- | --- | --- |
| `spec-026-tiered.test.ts` | tiered flow | D1: 0 Vitest runner hosts at start, after a `src/` edit, a `README.md` edit, `squeal lint` and `squeal code`. D4: `run unit --base main --wait` with `runner.tierSize: 1` runs 3 of 5 files (namesakes plus one importer), says "1 other test file of group unit" was left out, and names `README.md` as selecting none. D5: `code --base main` says "0 test groups in scope; groups left out: unit (manual)" and lists the stored failures; `--narrow` takes the 3 selected files from the store, with `upper` at 100% coverage, and says what it left out | 95 s |
| | short-lived daemon | D2: an edit-free daemon with no consumer exits 0 after its capped idle bound; after an outside edit, `squeal status` leads with the no-daemon notice naming revision 0 and `src/math.ts` | 5 s |
| `spec-026-remote.test.ts` | `command` machine | D7.2, D8, D9, D12: acquire, `remote sleep`, wake on the next edit, `release daemon-exit`, `remote prune` gives `release worktree-removed`. Background baseline, edit, slow and group lanes of Vitest and node:test go there with remote planning; a 200 ms process sampler saw 0 local runner hosts; `squeal code src/strings.ts` shows "100% of its lines ran in 2 test files" from remote coverage | 10 s |
| | pytest | D8.2: a pytest file runs there. Skipped when no Python with pytest is on the machine (`SQUEAL_E2E_PYTHON` or `python3`); run here once with a temporary venv, pass | 3 s |
| | slow disk | D11: a remote Node whose 4 KiB writes take 25 ms gives "degraded disk: 26 ms/sync, limit 10 ms; runs go there anyway" under `warn`; under `refuse` the machine is refused, no file is listed or run, and no local host starts | 10 s |
| | other arch | D10: a remote Node reporting `riscv64` is refused under `match-local` ("arch riscv64 on the remote, x64 here"); under `remote-key` every file runs there "keyed to remote environment". With the remote removed, the same file at the same content runs here under another key, and both results stay in the store | 12 s |
| | mock Agent37 | D7.3: a real `ssh` goes through `squeal remote-tunnel agent37`, a `CONNECT` proxy and a TLS WebSocket to a loopback non-root `sshd`. Create (`eu`, `vm`, 4/8/10, `auto_sleep`, 600 s), `.git` from a local bundle with the remote HEAD equal to the local one, a `needsRepository` Git test run there, sleep, wake on the next edit, sleep at daemon exit, reuse by the next daemon (1 `POST /v1/instances` in all), `DELETE` on prune. Every API call carried `Bearer`, every upgrade `X-Agent37-Key` | 15 s |

Commands and results (2026-11-24, one-minute host load 17 to 21 on 24 vCPUs; times in the table are per case, rounded):

- `pnpm exec vitest run test/e2e/spec-026-tiered.test.ts`: 2 passed, 101.6 s.
- `pnpm exec vitest run test/e2e/spec-026-remote.test.ts` with `SQUEAL_E2E_PYTHON` set to a temporary venv: 5 passed, 46.5 s. Without it here, the pytest case is skipped (no system pytest).
- `pnpm exec vitest run test/version-sensitive.test.ts`: 7 passed. `test/e2e/spec-026-remote` is now in `test/version-sensitive.txt`: it runs a real node:test.

Fixture notes for whoever extends these tests:

- The scheduler fixture's `test/gen.test.ts` reads the gitignored `src/gen/client.ts`. A remote tree never gets ignored files, so the remote tests remove that test file first (see D3).
- With explicit `checks`, a node:test group takes the slow project's files too; the remote fixture keeps the default `tests` and `slow` groups and adds one `manual` group by `tests` glob.
- The fake `ssh` (`fakeSshAt`) runs commands with the test's `PATH`; the loopback `sshd` needs this Node on its login `PATH`, as a node:test project with no `node` spawns `node` from it.
- `daemonSuite`'s `tsc` build has no code grammar; `squeal code --base` needs the plugin `dist/` build.

## Live Agent37 EU `vm` proof

One throwaway Node script, outside the repository, deleted after the run. It used the committed 0.1.620 `plugins/claude-code/dist/cli/squeal.mjs` as daemon, CLI and SSH `ProxyCommand`. It made a fresh Ed25519 key in a temporary directory and registered it with `POST /v1/ssh-keys`. `remote.json` named `provider: "agent37"`, `region: "eu"`, `type: "vm"`, `sshKeyPath`, `autoSleepMinutes: 5`, `lanes: "all"`, `runners: "all"`, `whenLost: "not-run"`. `AGENT37_API_KEY` was unset; the host's `HTTPS_PROXY` (agent-vault) added the API and tunnel credentials on the wire. No proxy value, token, header or key was printed: every printed line went through a redaction filter. `NODE_DEBUG` was never set. The fixture was 2 Vitest 5.0.3 files with a `package-lock.json`, one of them a `needsRepository` test that runs `git rev-parse HEAD`.

| Step | Measured |
| --- | --- |
| `POST /v1/instances` (EU `vm`, 4 vCPU / 8 GB / 10 GB) | instance created 1.26 s after daemon start |
| Running, Node check, `git bundle` of HEAD sent and `.git` filled | 6.96 s after start (Node v26.13.0 there; the log does not say whether it was installed) |
| Squeal 0.1.620 copied | 8.56 s |
| Connect-time disk check | 0.46 ms/sync (limit 10 ms); 1.17 ms/sync after wake |
| Tree: 7 files sent | 9.23 s |
| `npm ci` on the instance | 10.01 s |
| Connected, environment equal, remote planning | 10.39 s |
| Daemon serving | 10.82 s |
| `run --all --wait`: both files, the Git one included, pass | 12.14 s after start (1.31 s for the run) |
| `squeal code src/math.ts` | `add` "100% of its lines ran in 1 test file" (remote coverage in the local `code.sqlite`) |
| Edit-to-verdict, awake (`status --wait <path>` CLI wall time) | 1.47 s and 1.49 s |
| `squeal remote sleep` | 3.54 s; `GET` then said `sleeping` |
| Edit-to-verdict after sleep (wake, reconnect, 1 file sent, run) | 6.48 s; `GET` then said `running` |
| Local runner hosts, sampled every 500 ms | 0 at every sample |
| Daemon `SIGTERM` | exited in 9.26 s; instance `sleeping` (`release("daemon-exit")`) |
| `squeal remote prune` after the worktree was moved away | "released agent37:eu:vm:rxg6a8c47n (agent37) of removed worktree"; `GET /v1/instances/<id>` 404 `not_found` |
| Cleanup in `finally` | key `DELETE` 200; `GET /v1/instances` `{"data":[]}`; `GET /v1/ssh-keys` `{"data":[]}` |
| Spend | $4.948154 before, $4.947631 after: $0.000523 for this run |

A first attempt of the script asked for a run before the daemon was serving and failed at once. Its `finally` deleted the instance it found (`jdevpipdou`) and the key; both lists were empty after it too; it cost $0.000523. Both attempts together cost $0.001046 and left nothing.

Compared with the research (`research/agent37-sandboxes.md`): its 0.61 s edit-to-verdict was measured inside one process over a kept SSH channel; the 1.47 s here is the wall time of a separate `squeal status --wait` CLI process and includes its start. Its 0.68 to 1.65 s wake restored the memory checkpoint only; the 6.48 s here also covers SSH through the tunnel, a new host start, the disk check and the tree delta. Instance creation to a serving daemon took about 11 s, not the research's 31 s. This fixture had 7 files and 1 dev dependency; the research cloned and installed Squeal itself.

## Defects and observations

| Id | What | Repro | Where |
| --- | --- | --- | --- |
| D1 | With `planning: "remote"` and `whenLost: "not-run"`, a remote refused at connect (slow disk under `refuse`, or another arch under `match-local`) leaves plain `squeal status` saying "Known failures: 0; the daemon listed no test files" and "Full-suite checkpoint: completed at revision 0". No line names the remote as refused; only `status --full` notes do ("remote command refused: degraded disk: 26 ms/sync, limit 10 ms; 0 files not run", "runner testFiles failed: ... not planned here"). Breaks vision principle 2 and D12.1 | `spec-026-remote.test.ts`, slow-disk and other-arch cases | notes from `src/core/runner-host/remote/lane-planning.ts:77`; status rendering |
| D2 | Plain `squeal status` has no remote line (provider, machine id, state, lanes, planning, environment mode), which D12.1 asks for; it is only in notes. `squeal ps` shows a remote host as `remote <target> (ssh)`, without provider, machine id or awake/sleeping (D12.2) | any remote case, `squeal status`, `squeal ps` | `src/core/ps/render.ts:204` |
| D3 | The lane's not-run answer always says "remote <x> unreachable; not run here", also when the remote was reachable and refused a run because the tree stayed different. A group batch with one file that reads a gitignored file was refused whole, and its 3 batch-mates showed "unreachable" | scheduler fixture with `test/gen.test.ts` kept, `run <group>` over a `command` lane under `not-run` | `src/core/runner-host/remote/lane.ts:553` |
| O1 | A `SIGTERM` 0.4 s after daemon start, during `acquire`, did not stop the create call: "Agent37 instance jdevpipdou created" came 0.8 s after "daemon stopped". The script deleted it; whether the daemon would have tracked or released it was not observed. Worth a test in 026-20 | first live attempt | `src/core/runner-host/remote/providers/agent37/index.ts` `acquire` |
| O2 | Under `onSlowDisk: "refuse"` the `command` provider also got "acquiring a fresh machine instead". D11.2 names the one retry for managed providers only. Harmless for a `command` script that returns the same machine; costs one extra `acquire` call | slow-disk case, `refuse` | lane's disk verdict |

## Spec risks and open questions, closed

| Risk or question | Closed by |
| --- | --- |
| Four open questions of `spec.md` | All decided by the human on 2026-11-24 (D5 Option A, D2 2 min default, D10 opt-in, build order) |
| Seven daemon paths reopen the Vitest host on every edit (`tiered-pre-pr.md` Q1) | Tiered E2E: 0 runner hosts across start, source and `README.md` edits and reads |
| `unusedExitMinutes` did not fire in `restart.sh` | Short-lived E2E: exit 0 after the capped bound, and the honest notice after an outside edit |
| Pre-PR runs re-key 38 to 90% of the suite | Narrow `--base` run selected 3 of 5 files and named the rest; `--narrow` gate read 3 from the store |
| `squeal code --base` hides broken manual tests behind `incomplete` | Headline names 0 groups in scope and lists the stored failures |
| Planning keeps a 0.3 to 2.4 GB local Vitest host | 0 local runner hosts in every remote case and live |
| Coverage stripped on remote runs | Remote `CoverageRecord`s read back by `squeal code`, in E2E and live |
| Slow-disk lottery (boat.dev 9700X, 34 to 123 ms) | D11 warn and refuse in E2E; live EU `vm` 0.46 and 1.17 ms/sync |
| Vendor tunnel ignores `HTTPS_PROXY` | Live: the API and the tunnel went through the host's proxy with no key in the environment |
| SSH keepalives keep Agent37 awake | Live: `remote sleep` gave `sleeping`; the next edit woke it |
| Disk billing of orphaned instances | Live: `remote prune` deleted the instance of a removed worktree |
| `needsRepository` tests need a remote `.git` | E2E and live: a `git rev-parse HEAD` test ran remotely after the bundle bootstrap |
| Cross-platform keys pollute local ones | E2E: remote and local results of one file under two keys, both kept |

## Not verified

- A macOS laptop host against a Linux remote. `remote-key` was proven with a synthetic arch on Linux only.
- Linux CI export reuse under `remote-key` end to end. It is covered at integration level (`test/runner-host/remote/daemon-remote-key.test.ts`, `test/keys/validity/cases/assemble/remote-key.ts`), not with a real `squeal ci record|export|publish` and import.
- pytest and node:test on a live Agent37 instance (both ran remotely in E2E only), and a Node install on an instance whose image lacks the local version.
- The idle path that closes SSH and sleeps after `idleSleepMinutes` by itself (live used `squeal remote sleep`), and Agent37 rebuilding an instance instead of restoring memory.
- `us` and `ap-south` regions, `performance` type, and the `tree-sync` bootstrap.
- A large repository on a remote: the live fixture had 7 files.

## Next

- Row 026-20 (scheduled by the coordinator): D1 to D3, and a test for O1.
- Spec 026 can move to `shipped` once 026-19 and 026-20 land.
