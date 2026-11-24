# Spec 026 Wave 2 briefs (Track 1 Wave 2 + Wave 1.5 review follow-ups + Track 2 Wave 4 part 1)

Spec: `docs/specifications/026-tiered-and-cloud-execution/spec.md` (stage: `approved`).
Prior reviews: `reviews/0.1.616.md` (FAIL, repaired) and `reviews/0.1.616-r2.md` (PASS on `9fd593539`, landed as `0.1.616` at `7a2506046`).

All four rows below have strictly disjoint file ownership and run in parallel.
Workers: follow `/worker` skill, read `AGENTS.md`, `docs/vision.md`, `docs/styleguide.md`, and `spec.md`. Test first. Do NOT run `pnpm run build`, do NOT bump versions, do NOT edit `docs/board.md`, and do NOT run a local full suite. Use Squeal (`squeal status --wait 60000 <changed-paths>`) and targeted `pnpm exec vitest run <test-files>` plus `pnpm run lint` and `pnpm run typecheck`.

---

## Row 026-09: Short-lived daemon (`unusedExitMinutes` fix + 2-min default + no-daemon staleness)

- **Design:** Spec 026 D2 (`spec.md` lines 67-76), informed by `research/daemonless-hooks.md` Q5 item 3.
- **Model:** `claude` / `opus` / `high`.
- **File ownership:**
  - `src/core/daemon/lifecycle.ts`
  - `src/core/daemon/policy.ts`
  - `src/core/types/policy.ts`
  - `src/core/ps/` (flags/model/work displaying effective `unusedExitMinutes`)
  - `src/cli/status/` (and `src/cli/code/`, `src/cli/lint/` for no-daemon staleness notice)
  - New/updated tests under `test/daemon/`, `test/ps/`, `test/cli/` (outside `test/daemon/deferred-keying.test.ts` and `test/runner-host/remote/`).
  - Do NOT edit `src/core/daemon/daemon.ts` without messaging the coordinator first (`026-11` edits lines 895-977 and 1242-1250 of `daemon.ts`). Do NOT touch `composite-gate.ts`, `bootstrap.ts`, or `runner-host/remote/`.
- **Requirements:**
  1. **Diagnose and fix `unusedExitMinutes` not firing:** In `research/daemonless-hooks.md` (`research/probes/daemonless-hooks/restart.sh`), a daemon with `daemon.unusedExitMinutes: 0.5`, one registered consumer, and no edits stayed alive for 20 minutes without stopping. Reproduce that scenario first in a real-process test, identify the root cause, and fix it cleanly.
  2. **2-minute default for edit-free policies (human decision, 2026-11-24):** When `squeal.config.json` does NOT explicitly configure `daemon.unusedExitMinutes`, resolve the effective default to **`2` minutes** when no test group runs at `edit` or `pause` (reuse or align with `allTestsDeferred(policy)` in `src/core/scheduler/deferred-keying.ts`), and **`30` minutes** otherwise. An explicit `daemon.unusedExitMinutes` in `squeal.config.json` always wins. Ensure policy reload and `squeal ps` see the same effective value.
  3. **No-daemon staleness notice:** When no daemon is running for the worktree, `squeal status`, `squeal code`, and `squeal lint` still answer immediately from the stores without starting a daemon, AND when tracked/working-tree files changed since the last recorded pass/revision (or the daemon exited on rest/idle with unseen changes on disk), print an explicit, concise staleness notice naming that no daemon is running and results reflect the last recorded revision/pass (not the newer edits on disk).
  4. **Silent restart + burst-restart CPU evidence:** Prove in tests that an idle daemon with a registered consumer exits cleanly (`idle` + `markRest`), the next hook starts it silently without error, and report a brief burst-restart CPU vs idle-core comparison in your final summary.
- **Done when:**
  - Root cause of `unusedExitMinutes: 0.5` non-exit is documented in commit/final summary and fixed.
  - Real-process tests prove idle exit under short `unusedExitMinutes` with an active registered consumer, 2-min default for edit-free policies vs 30-min default otherwise vs explicit override, silent restart on next hook, and honest staleness notice from `squeal status`, `squeal code`, and `squeal lint` after an external edit while the daemon is down.
  - `pnpm run lint`, `pnpm run typecheck`, and targeted tests pass.

---

## Row 026-17: Preserve deferred runner stored files across mixed-runner restart (review `0.1.616-r2.md` N1)

- **Design:** Spec 026 D1.3 + `reviews/0.1.616-r2.md` should-fix note N1.
- **Model:** `claude` / `opus` / `high`.
- **File ownership:**
  - `src/core/daemon/composite-gate.ts`
  - `src/core/daemon/composite-runner.ts` (only if needed to surface deferred-runner identity)
  - `src/core/scheduler/runner-gate.ts`
  - `src/core/scheduler/bootstrap.ts`
  - `src/core/scheduler/revision.ts`
  - `src/core/scheduler/omitted-test-files.ts`
  - `test/scheduler/deferred-keying.test.ts`, `test/scheduler/deferred-keying-mixed.test.ts`, `test/daemon/deferred-keying.test.ts`
  - Do NOT edit `daemon.ts`, `lifecycle.ts`, or `runner-host/remote/`.
- **Requirements:**
  1. Read `docs/specifications/026-tiered-and-cloud-execution/reviews/0.1.616-r2.md` lines 99-118 and 189-220 carefully.
  2. When a daemon restarts in a mixed-runner worktree (e.g., manual Vitest beside eager `node:test`), `CompositeGate` has an empty in-memory cache for the shut Vitest member and returns `[]` from `testFiles()`. Today `bootstrap.ts:163` treats that as a complete listing and retires Vitest's stored `test_file_keys` and `known_states` (including stored failures!) as deleted.
  3. Carry the set of deferred/unlisted runners explicitly from `CompositeGate` / `RunnerGate` into `bootstrap.ts` (and structural relisting in `revision.ts`) so baseline and structural relisting NEVER retire stored files belonging to a deferred runner whose listing has not been fetched yet.
  4. Preserve each deferred runner's stored `test_file_keys`, stored closures, and `known_states` (including failures) across restart with zero deferred host calls while eager neighbors run normally. Where the deferred runner's environment has not been verified since restart, keep the file row and prior failure evidence visible honestly (do not claim a stale result is current, and do not silently drop it as deleted).
  5. When an explicit request (`squeal run <group>`, named wait, etc.) later opens the deferred runner, catch up normally: read its environment and listing, re-key, and retire any files that are genuinely deleted on disk.
- **Done when:**
  - New regression test reproduces the exact N1 restart probe (real store, manual Vitest with a stored failure + eager `node:test`, close and recreate scheduler/gate on the same worktree with no source change): asserts 0 Vitest host calls on restart, asserts Vitest's `test_file_keys` row and prior failure remain visible, then asserts an explicit request opens Vitest and catches up normally (and genuinely deleted Vitest files retire once listed).
  - Existing deferred-keying and composite-runner tests stay green; `pnpm run lint` and `pnpm run typecheck` pass.

---

## Row 026-18: Eliminate fresh empty-lock startup race in `machines-store.ts` (review `0.1.616-r2.md` S1)

- **Design:** Spec 026 D7.3/D12 + `reviews/0.1.616-r2.md` should-fix note S1.
- **Model:** `claude` / `opus` / `medium`.
- **File ownership:**
  - `src/core/runner-host/remote/machines-store.ts`
  - `test/runner-host/remote/machines-lock.test.ts`
  - Do NOT edit any other file in `src/core/runner-host/remote/`.
- **Requirements:**
  1. Read `docs/specifications/026-tiered-and-cloud-execution/reviews/0.1.616-r2.md` lines 119-128 and 158-188 carefully.
  2. Eliminate the initialization window where `openSync(lock, "wx")` leaves a 0-byte lock file that a contender treats as dead (`alive(NaN) === false`) and unlinks immediately, letting both writers enter and lose a record.
  3. Publish lock ownership atomically so the lock path never appears empty (for example: write owner text to a unique temp file in the same directory, atomically claim the lock via `linkSync(temp, lock)`, unlink the temp file; and if a filesystem ever lacks hard links or an empty lock file is ever observed, never treat a fresh uninitialized lock younger than a safe grace window as stale, and guard stale takeover so a replacement owner's lock is never unlinked). Keep acquisition covering the entire read-modify-write through final rename.
  4. Add a deterministic two-process test in `test/runner-host/remote/machines-lock.test.ts` reproducing the exact S1 pause schedule (writer A pauses between lock creation/publication and body; writer B contends) and asserting both records (`["a", "b"]`) survive, while keeping the existing concurrent-write and abandoned-lock tests passing.
- **Done when:**
  - Deterministic S1 two-process race test + existing concurrent and abandoned-lock tests pass.
  - `pnpm run lint` and `pnpm run typecheck` pass.

---

## Row 026-11: Hybrid 2A: all lanes and all runners over `RemoteMachine` (Track 2 Wave 4 part 1)

- **Design:** Spec 026 D8 items 1 & 2 (`spec.md` lines 249-254) and D7.3 item 4 idle sleep (`idleSleepMinutesOf` in `settings.ts`).
- **Model:** `claude` / `opus` / `high`.
- **File ownership:**
  - `src/core/runner-host/remote/lane.ts`
  - `src/core/runner-host/remote/daemon-lane.ts`
  - `src/core/runner-host/remote/connect.ts`
  - `src/core/runner-host/remote/ssh.ts`
  - `src/core/runner-host/remote/tree-host.ts`
  - `src/core/runner-host/remote/lane-compare.ts`
  - `src/core/daemon/daemon.ts` (ONLY runner/remote-lane wiring around lines 895-977 and `requestRemoteSleep` around lines 1242-1250; do NOT touch lifecycle/timers)
  - `src/core/daemon/node-test-runners.ts`
  - `src/core/daemon/pytest-runners.ts`
  - `src/core/daemon/slow-instance.ts` (only if needed for lane routing)
  - Tests under `test/runner-host/remote/` (NOT `machines-lock.test.ts`!) and `test/daemon/` (NOT `deferred-keying.test.ts`!).
  - Do NOT edit `machines-store.ts` (`026-18` owns it), `composite-gate.ts` (`026-17` owns it), or `lifecycle.ts` (`026-09` owns it).
- **Requirements:**
  1. **All configured lanes (`lanes: ["background", "edit", "slow", "group"]` or `"all"`):**
     - Generalize `goesRemote(options, configuredLanes)` so each tier in `RemoteLane.lanes` routes to the remote (`background`, `edit`, `slow` via `isSlowLane`, `group` via `isGroupLane`). Preserve the exact 021 default when `lanes` is `["background"]` (background-only). Document how `beside` (`isBesideLane`) behaves (routes with `"edit"` when `"edit"` is remote, otherwise local).
     - When `slow` or `group` runs go remote, run them through remote runner-host channels on the same `RemoteMachine` (reusing one SSH ControlMaster socket per awake machine when supported so multiple lanes/runners share one SSH connection without extra handshakes, and closing the ControlMaster on idle sleep / daemon exit so Agent37/command auto-sleep works!). Keep `ssh.ts` safe when a test uses a fake `ssh` binary or loopback `HostChannel`.
  2. **All runners (`runners: ["vitest", "node-test", "pytest"]` or `"all"`):**
     - Share ONE `RemoteMachine` (acquired once, woken once, released once on daemon exit) across all configured remote runners (`vitest`, `node-test`, `pytest`) of a worktree.
     - Wrap Vitest, `node-test` projects, and `pytest` projects in remote lanes whenever their runner name is in `lane.runners` (and `remote.allowed` is true and `launch` is provided).
     - Translate local absolute `tempDir` and `cacheDir` inside `HostAdapterOptions.process` (`node-test` and `pytest`) on the remote host (`tree-host.ts` / `connect.ts`) to remote-owned directories under `<remote tree>/tmp` and `<remote tree>/cache`, so local host paths never leak into remote processes.
     - Ensure `compareRemote` works cleanly for `vitest`, `node-test`, and `pytest` environments (matching each runner's environment descriptor and config files).
     - Update `requestRemoteSleep` (`squeal remote sleep`) so it coordinates across ALL wrapped remote runners on the shared machine: refuses if ANY runner/lane has an active remote run or connect; otherwise closes ALL remote channels (and the ControlMaster) first, then calls `machine.sleep()` once and updates `remote-machines.json` once.
  3. **Automatic idle sleep (`idleSleepMinutesOf`):**
     - When `idleSleepMinutesOf(lane, machine.capabilities.sleepOnIdle) > 0` and no remote run/connect/invalidation activity happens across any lane on the machine for that duration, close idle remote channels + ControlMaster and call `machine.sleep()` (and record `"sleeping"` in `remote-machines.json`), waking automatically on the next remote run. Never send SSH keepalives past `idleSleepMinutes`.
  4. **Scope boundary (leave for `026-12` and `026-13`):**
     - Keep `planning` local for now (`affected`, `closure`, `testFiles`, `environment` still delegate to `local`; `026-12` builds remote planning and `hasGitRepository` D19 bypass next).
     - Keep `coverage` stripped on remote for now (`026-13` adds remote `CoverageRecord` mapping).
     - Preserve 100% backward compatibility for `{ "target": "build-box" }` (`provider: "ssh"`, `runners: ["vitest"]`, `lanes: ["background"]`).
- **Done when:**
  - Tests prove: (a) `edit`, `slow`, `group`, and `background` lanes route remotely according to `lanes` config while keeping `{ target }` default background-only; (b) `vitest`, `node-test`, and `pytest` runners share one `RemoteMachine` and run remotely with remote-translated `tempDir`/`cacheDir`; (c) multi-runner `sleepRemote()` closes all channels before `machine.sleep()` and refuses when any runner is busy; (d) automatic `idleSleepMinutes` closes channels and sleeps an idle sleepable machine, then wakes on next run.
  - Existing `test/runner-host/remote/*.test.ts` (including `lane`, `lane-sleep`, `daemon-lane`, `daemon-lane-sleep`, `lane-repair`) stay green; `pnpm run lint` and `pnpm run typecheck` pass.
