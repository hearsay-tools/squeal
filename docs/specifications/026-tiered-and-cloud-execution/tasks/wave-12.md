# Spec 026, Wave 12: remote transport resilience, `#278` outage diagnostics, `#283` fast refinement, and bounded remote shutdown

Base: `dada250fc` (`origin/main`, after `0.1.636` release).
Authorized by the human on 2026-11-26 ("Go", following root-cause verification of `hearsay-tools/squeal#283`, `hearsay-tools/squeal#278`, and 424 daemon logs on `0.1.636`).

Version claim: `0.1.637` (agreed with peers `2a44891e` and `0fb097d5`).

---

## Row 026-30: isolate SSH ControlMaster from orphan reaper, log Agent37 tunnel close reasons, bound remote shutdown, and add transient reconnect + recovery hook

**Goal:** Eliminate the three empirically proven remote-transport failure modes observed across `0.1.636` daemon logs:
1. `EscapedChildren.afterRun` killing Squeal's own reparented `ssh` `ControlMaster` / `squeal remote-tunnel` (`ProxyCommand`) because `spawnSsh` inherits the daemon's process group (`pgrp === daemon.pid`).
2. Silent Agent37 WebSocket / TCP tunnel drops (~61 min resets exiting with code `0` and no stderr diagnostic) and instant 30 s `down` backoff on a single transient channel drop under `whenLost: "not-run"`.
3. Multi-hour daemon shutdown hangs (`daemon stopped: no session registered for 3 s` stuck 48 min to 2 h until remote SSH dies `code 255`) caused by `remoteAdmission` polling forever without an exit abort, `gitLease()` held across admission polling, and `refreshGit` running after `beginExit()`.

**Owned files:**
- `src/core/runner-host/remote/ssh.ts`
- `src/core/runner-host/remote/providers/agent37/tunnel.ts`
- `src/core/runner-host/remote/machine-share.ts`
- `src/core/runner-host/remote/admission.ts`
- `src/core/runner-host/remote/lane.ts`
- `src/core/runner-host/remote/daemon-lane.ts`
- `test/runner-host/remote/ssh-multiplex.test.ts` (and/or new `test/runner-host/remote/ssh-detached.test.ts`)
- `test/runner-host/remote/providers/agent37-attached.test.ts` (and/or new `test/runner-host/remote/providers/agent37-tunnel-close.test.ts`)
- `test/runner-host/remote/machine-share.test.ts`
- `test/runner-host/remote/admission.test.ts`
- `test/runner-host/remote/lane-admission.test.ts`
- `test/runner-host/remote/lane.test.ts`
- `test/runner-host/remote/daemon-lane.test.ts`
- `test/runner-host/remote/daemon-lane-exit.test.ts`

Do not edit `package.json`, `docs/board.md`, `src/core/daemon/daemon.ts`, `src/core/scheduler/**`, `src/cli/**`, or plugin bundles (`pnpm run build` is the coordinator's step).

**Requirements:**
1. **`src/core/runner-host/remote/ssh.ts`:**
   - In `spawnSsh`: pass `detached: process.platform !== "win32"` to `spawn(...)` so `ssh`, its backgrounded `ControlMaster`, and its `ProxyCommand` (`squeal remote-tunnel`) run in their own process group (`pgrp !== daemon.pid`), never matched by `EscapedChildren`'s `entry.pgrp === this.#self` orphan sweep. Do not call `child.unref()`.
   - In `closeMaster`: also pass `detached: process.platform !== "win32"` to `spawn(...)`.
   - In `sshRun`: on deadline timeout or `signal` abort, terminate cleanly (on POSIX when `child.pid` is present, kill the child; keep existing `child.kill("SIGKILL")` behavior safe without killing an unrelated shared `ControlMaster` owned by an earlier `ssh` — `child.kill("SIGKILL")` already kills `child`, and if `child` spawned its own non-multiplexed command or failed before multiplexing, `process.kill(-child.pid, "SIGKILL")` only affects `child`'s own process group, NOT an earlier master's process group! Verify with tests that `sshRun` timeout/abort kills the hung ssh without rejecting or leaking a timer).
   - Add a unit test verifying that a child spawned by `spawnSsh` runs in its own process group (`pgrp !== process.pid` on Linux/POSIX) and that a reparented descendant of `spawnSsh` is NOT matched by `EscapedChildren` (use real `spawnSsh` with a short node script or verify `ps -o pgid=` / `/proc/<pid>/stat`!).
2. **`src/core/runner-host/remote/providers/agent37/tunnel.ts`:**
   - When `open === true` and `frame.opcode === OPCODE.close` arrives while `!closing` (server-initiated WebSocket close): parse the optional RFC 6455 2-byte big-endian close status code (`payload.length >= 2 ? payload.readUInt16BE(0) : null`) and optional UTF-8 close reason (strip control characters / newlines, trim, clamp to 120 chars; never log headers or keys). Call `finish(0, detail)` where `detail` is e.g. `server closed WebSocket (code ${code}: ${reason})` or `server closed WebSocket (code ${code})` or `server closed WebSocket (no status code)`. When `closing === true` (client initiated close because SSH stdin ended), keep `why = undefined` so clean closes stay silent.
   - When `open === true` and TCP `to.on("close")` fires while `!closing` (unexpected TCP drop without a close frame): call `finish(0, "connection closed by peer")` so stderr records why the tunnel ended. When `closing === true`, keep `why = undefined`.
   - Preserve all existing upgrade/error/stdin-end behaviors and exit codes (`0` after open, `TUNNEL_FAILED` before open).
3. **`src/core/runner-host/remote/machine-share.ts`:**
   - Expose `readonly exitSignal: AbortSignal` on `MachineShare` (backed by `exiting.signal`, which `beginExit()` aborts).
   - In `beginExit()`: abort `exiting`, wake any `quiet` waiters waiting in `leaseFree()`, and prevent new `refreshGit` / `writeGit` work from starting once `exiting.signal.aborted` is true (return immediately without invoking `m.syncGit`). Keep Review 0.1.617 B1 / 0.1.623 B1 guarantees intact: `release()` still waits for work already in flight on an acquired machine before closing master and calling `m.release(...)`, while an in-flight `acquire` aborts immediately.
4. **`src/core/runner-host/remote/admission.ts`:**
   - Add optional `readonly exit?: AbortSignal | undefined` to `AdmissionWait` and `admitRun` options (combined with `cancelOf(run)`).
   - When `exit` aborts while `remoteAdmission` is waiting for remote permits (including before the first `admit` call, between polls, or after a grant arrives while aborting), return any newly granted token (best-effort `.catch(() => {})` so a dead host does not hang exit) and return `null` immediately. This ensures a tier that has not started running on the remote yet never hangs daemon shutdown (`sessions-gone` / `stop`).
5. **`src/core/runner-host/remote/lane.ts` and `src/core/runner-host/remote/daemon-lane.ts`:**
   - Add optional `readonly exitSignal?: AbortSignal` and `readonly onRecovered?: () => void` to `RemoteLaneOptions` (and `readonly onRecovered?: () => void` to `DaemonRemoteOptions`, wired through `createDaemonRemote` -> `laneOver` -> `withRemoteLane` alongside `exitSignal: share.exitSignal`).
   - **Scope `gitLease` properly:** Acquire `gitLease()` inside `admittedRun` AFTER `admitRun` returns a positive grant (right before `blobsHere` + `host.adapter.run(...)`, released in `finally`), NOT around `admitRun` polling. Pass `exit: options.exitSignal` into `admitRun`.
   - **Transient channel-drop reconnect-once under `whenLost: "not-run"`:** When `remoteTier` encounters a channel loss (`"lost" in report`) under `options.whenLost === "not-run"`, AND the failure was NOT a timeout (`report.lost.end !== "timed-out"`), AND the run was NOT cancelled (`run.signal?.aborted !== true && run.stop?.aborted !== true`), AND the lane is NOT ending (`!ending()` and `options.exitSignal?.aborted !== true`):
     - Log `remote ${target}: connection dropped (${why}); reconnecting once before giving up`,
     - Reset the immediate retry gate (`connect()` once without waiting for the 30 s backoff, cancelling if `cancelOf(run)` or `options.exitSignal` aborts),
     - If the fresh host reaches `ready` within that single connect attempt, retry `remoteRun(freshHost, testFiles, run)` ONCE!
     - If the fresh connect fails or the retry also loses the host, fall through cleanly to `lostTier` (do NOT loop a second time; preserve backoff for subsequent tiers!).
     - Under `whenLost: "local"`, keep the existing immediate local fallback (do NOT delay `whenLost: "local"` with a reconnect retry; existing `test/e2e/remote-lane.test.ts` requires killed-host local fallback to run at once!).
     - On a timeout (`end === "timed-out"`, such as a paused container in `test/e2e/remote-lane.test.ts`), do NOT retry; fall straight through to `lostTier`.
   - **Richer `lostReport` (`#278` consistency):**
     - Pass `reason` to `lostReport(testFiles, reason)`.
     - Under `whenLost: "not-run"`, format `failure` as:
       `remote ${target} unreachable during the run of ${testFiles.length} files (${reason}); not run here (whenLost "not-run"); waits retry once ${target} reconnects or run squeal retry`
     - Under `whenLost: "local"`, keep `remote ${target} unreachable during the run of ${testFiles.length} files` (or with `(${reason})` if compatible — check existing tests in `test/runner-host/remote/` and update `lane-admission.test.ts` line 404 to assert the enriched `not-run` message!).
   - **Recovery callback (`onRecovered`):**
     - Track `hadOutage = false` (set `true` whenever `down(...)` runs after `tried` with `notRun > 0` or during any non-refused loss / refusal that left files not-run, or whenever `notRun > 0` or `down(...)` fires after a connected/attempted run).
     - When `compareFirst` transitions `connecting -> ready` and `hadOutage` is `true`, reset `hadOutage = false` and invoke `options.onRecovered?.()`! (Do not fire on the initial cold connect when no outage occurred.)
6. **Constraints & verification:**
   - Never use `/home/` paths in code or tests (`pnpm run check:private`).
   - Do not change `KEY_FORMAT_VERSION`, key formats, or SQLite schema.
   - Run `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:private`, and `pnpm exec vitest run test/runner-host/remote/ssh-multiplex.test.ts test/runner-host/remote/machine-share.test.ts test/runner-host/remote/admission.test.ts test/runner-host/remote/admission-expiry.test.ts test/runner-host/remote/lane.test.ts test/runner-host/remote/lane-admission.test.ts test/runner-host/remote/lane-close.test.ts test/runner-host/remote/daemon-lane.test.ts test/runner-host/remote/daemon-lane-exit.test.ts test/runner-host/remote/daemon-lane-shutdown.test.ts test/runner-host/remote/providers/agent37-attached.test.ts` plus any new tests you add (and check `squeal status --wait 60000` on your changed paths). Commit cleanly when done.

---

## Row 026-31 (from `gh-278`, `#278`): surface recorded remote outages and recovery across named waits, `retry`, and `proof`

**Goal:** Close `hearsay-tools/squeal#278` (per `docs/specifications/026-tiered-and-cloud-execution/research/issue-278.md` and board row `gh-278`): when a remote outage or refusal blocks selected files under `whenLost: "not-run"`, make named status waits (`squeal status --wait <ms> <paths>`), `squeal retry <paths>`, and `squeal proof` consistently name the remote, the recorded outage reason and timestamp (when recorded), the effective `whenLost "not-run"` policy, and a supported recovery — without weakening `unknown` / `not-comparable` safety or altering configured `whenLost` fallback policy.

**Owned files:**
- `src/cli/remote-outage-text.ts` (new shared helper)
- `src/cli/status-wait-lines.ts`
- `src/cli/no-verdict-lines.ts`
- `src/cli/retry-unlisted.ts`
- `src/cli/proof-green.ts`
- `src/cli/proof-side.ts`
- `test/cli/remote-outage-diagnostics.test.ts` (new comprehensive test suite)
- Updates only if strictly required to existing tests directly testing these CLI wording lines (`test/cli/retry-unlisted.test.ts`, `test/cli/status-wait-*.test.ts`, `test/cli/proof-*.test.ts` — keep existing non-remote wording byte-identical!).

Do not edit `package.json`, `docs/board.md`, `src/core/runner-host/**`, `src/core/scheduler/**`, `src/core/daemon/**`, `src/cli/group-pending.ts`, or plugin bundles.

**Requirements:**
1. **Shared helper `src/cli/remote-outage-text.ts`:**
   - Read recorded remote outage evidence from either:
     - a `StatusSnapshot` (`remoteSummary`, `notes` with topic `remote-lane` / `remote-lane:*`, and `unknownFiles` matching selected paths), or
     - a `Store` + `worktreeId` (`readRemoteSummary(store, worktreeId)`, `readDaemonNotes(store, worktreeId)` filtered to remote topics `remote-lane` / `remote-lane:*`, and `readUnknownFiles(store, worktreeId)`).
   - Detect when a recorded remote outage/refusal is active or explains selected files' `unknown` / unlisted state:
     - Extract remote label/target, state (`unreachable` or `refused`), recorded reason (e.g. `the host ended`, `degraded disk...`, `missing pnpm`), recorded timestamp (`since <ISO>` when present in the note), whether `whenLost "not-run"` applies (from the note/reason text `not run` / `whenLost "not-run"` or `not planned here (whenLost "not-run")`), and supported recovery (`check squeal status and retry once the remote reconnects with squeal retry <paths>` or `squeal status --wait 60000 <paths>` — always using the caller's `command` name!).
   - Never fabricate a remote outage when none is recorded; when no remote outage exists in the snapshot/store, return `null` so all local/non-remote outputs stay 100% byte-identical!
2. **`src/cli/status-wait-lines.ts`:**
   - In `namedText` (when `options.full !== true`): if any selected file is `unknown`, blocked, or missing/unlisted AND a recorded remote outage applies (from `wait.result.remoteSummary`, remote notes, or selected `unknownFiles` reasons), include a concise `Remote: <summary or outage line>` line right below `Revision:` (matching plain `squeal status`!) so the agent immediately sees the remote state, outage reason, `whenLost "not-run"` policy, and recovery without needing `--full`!
   - When all selected files are clean (`pass`/`fail` with no remote outage affecting them), do NOT alter `namedText` output.
3. **`src/cli/no-verdict-lines.ts`:**
   - In `timeoutText`:
     - When `reason === "lapsed"`: if a recorded remote outage is present on `wait.result`, append that recorded remote outage context (remote, reason, `whenLost "not-run"`, recovery) beside the lapsed-heartbeat clause instead of hiding the remote outage behind heartbeat silence alone!
     - When `reason === "unlisted"` or default no-verdict: if selected files are `unknown` or unlisted because of a recorded remote outage (e.g. `testFilesListed === false` with remote planning refused/unreachable, or selected files have remote-outage unknown reasons), name the remote, recorded reason/time, `whenLost "not-run"`, and supported recovery (`wait again once <remote> reconnects` / `squeal retry`) instead of generic unlisted/no-result text.
4. **`src/cli/retry-unlisted.ts`:**
   - In `notKeyed`: before returning `"Not listed yet: ..."` or `"Not retried: ... is not a test file Squeal has keyed"`, check whether a recorded remote outage on `(store, worktreeId)` explains why the worktree has not listed/keyed the file (e.g. `header.testFilesListed !== true` or `header.runnerPartPending === true` or `keys.length === 0` while the latest remote lane note / summary reports `unreachable` or `refused` under `whenLost "not-run"`).
   - When so, return an actionable diagnostic naming the remote, recorded outage reason and timestamp (if recorded), `whenLost "not-run"`, and supported recovery (`check squeal status; once the remote is ready, run squeal status --wait 60000 <path>` or `squeal retry <path>`). Preserve existing behavior when no remote outage is recorded!
5. **`src/cli/proof-green.ts` and `src/cli/proof-side.ts`:**
   - When a file in `proof-green.ts` or `proof-side.ts` would be marked `unknown("no runner lists it at ...")` or `unknown("not run (not needed)")` (or when `file.at.notDetermined.detail` comes from a remote outage), check whether a recorded remote outage on the store/daemon explains why the side could not list or run it (preserving `unknown` / `not comparable` verdict — NEVER claiming `pass` or `proven`!).
   - Surface the remote name, recorded outage reason/time, `whenLost "not-run"`, and recovery in the side's unknown detail so `squeal proof` names the actual remote outage instead of `"no runner lists it at <sha>"`.
6. **Tests (`test/cli/remote-outage-diagnostics.test.ts`):**
   - Cover all four command surfaces (`namedText` / named wait with `unknown` files and with lapsed heartbeat + remote outage, `no-verdict-lines` `timeoutText` for unlisted + lapsed + remote outage, `retry-unlisted` `notKeyed` before and after discovery under `whenLost: "not-run"` and `whenLost: "local"`, and `proof-green` / `proof-side` unknown detail when remote outage blocks listing/running).
   - Cover both `unreachable` (e.g. `the host ended`, missing remote package manager) and `refused` (e.g. degraded disk) remotes, and verify non-remote cases stay byte-identical and unrun tests are NEVER reported as passing.
7. **Constraints & verification:**
   - Never use `/home/` paths in code or tests (`pnpm run check:private`).
   - Do not change `KEY_FORMAT_VERSION`, key formats, or SQLite schema.
   - Run `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:private`, and `pnpm exec vitest run test/cli/remote-outage-diagnostics.test.ts test/cli/retry-unlisted.test.ts test/cli/status-wait-reasons.test.ts test/cli/status-wait-listing.test.ts test/cli/status-wait-synced-lapse.test.ts test/cli/status-wait-deadline.test.ts test/cli/proof-report.test.ts test/cli/proof-green-daemon.test.ts` (and check `squeal status --wait 60000` on your changed paths). Commit cleanly when done.

---

## Row 026-32 (from `gh-283`, `#283`): pipeline refinement closures 16x faster, expose exact refinement phase/progress, and add `Scheduler.requeueUnknown`

**Goal:** Eliminate the 5-minute lockfile/recreate stall behind `hearsay-tools/squeal#283` (caused by ~2,000 sequential `runner.closure(ref)` RPCs over SSH in `fetchRunnerPart`), stop reporting every refinement stage as `"lists revision N"`, and add `Scheduler.requeueUnknown` so the daemon can automatically re-queue remote-outage `unknown` files once the remote reconnects.

**Owned files:**
- `src/core/scheduler/refinement.ts`
- `src/core/scheduler/runner-work.ts`
- `src/core/scheduler/scheduler.ts`
- `src/core/types/scheduler.ts`
- `src/core/types/daemon.ts`
- `src/core/daemon/run-group.ts`
- `src/cli/group-pending.ts`
- `test/scheduler/refinement-concurrency.test.ts` (new)
- `test/scheduler/requeue-unknown.test.ts` (new)
- `test/cli/group-pending.test.ts` (update/extend for refinement phase + progress wording)

Do not edit `package.json`, `docs/board.md`, `src/core/runner-host/**`, `src/core/daemon/daemon.ts`, `src/cli/{status-wait-lines,no-verdict-lines,retry-unlisted,proof-green,proof-side}.ts`, or plugin bundles.

**Requirements:**
1. **Pipelined concurrent `closure(ref)` resolution (`src/core/scheduler/refinement.ts` & `src/core/scheduler/runner-work.ts`):**
   - In `fetchRunnerPart` (`refinement.ts`): replace the sequential `for (const ref of reresolve.values()) { await runner.closure(ref); }` loop with a bounded-concurrency worker pool (`CLOSURE_CONCURRENCY = 16`, exported for tests).
   - Preserve **exact deterministic ordering** of `closures` (matching the input order of `reresolve.values()`, skipping failed/`null` calls) and **exact error/bound semantics**:
     - Each item still runs through `tryRunner(context, \`closure of ${ref.path}\`, () => bound.call(() => runner.closure(ref)), (reason) => failed(failures, ref.project, reason))`.
     - If `bound` abandons (check via a `bound.abandoned` or tracking whether an abandon occurred), stop launching further closures cleanly while recording failure for remaining refs via `bound.call` or preserving existing failure semantics (verify existing `runner-part-bound` tests!).
   - In `RunnerWork.#rewalk` (`runner-work.ts`): also resolve `refs` with bounded concurrency (`CLOSURE_CONCURRENCY = 16`, preserving `if (this.host.closed()) return` and deterministic order).
2. **Exact refinement phase & progress tracking (`refinement.ts`, `runner-work.ts`, `scheduler.ts`, `types/scheduler.ts`, `types/daemon.ts`, `run-group.ts`, `group-pending.ts`):**
   - Define a clean lightweight type `RefinementStage`:
     `"invalidating" | "environment" | "listing" | "affected" | "closures" | "edit-cut"`
     and `RefinementProgress`:
     ```ts
     export interface RefinementProgress {
       readonly revision: RevisionNumber;
       readonly stage: RefinementStage;
       readonly done?: number;
       readonly total?: number;
     }
     ```
   - Pass an optional `onProgress?: (stage: RefinementStage, done?: number, total?: number) => void` callback into `fetchRunnerPart`:
     - Call `onProgress("invalidating")` before `runner.invalidate(...)`
     - Call `onProgress("environment")` before `runner.environment()`
     - Call `onProgress("listing")` before `listTestFilesOf(...)`
     - Call `onProgress("affected")` before `askAffected(...)`
     - Call `onProgress("closures", 0, refs.length)` before resolving closures, and `onProgress("closures", completed, refs.length)` as each closure settles
     - Call `onProgress("edit-cut")` before `fetchEditCut(...)`
   - Track the current `RefinementProgress | null` on `RunnerWork` (cleared in `finally` of `#refine`).
   - On `Scheduler` (`src/core/types/scheduler.ts` & `src/core/scheduler/scheduler.ts`):
     - Keep `listing?(): RevisionNumber | null` intact for backward compatibility!
     - Add `refinementProgress?(): RefinementProgress | null` returning the active `RunnerWork` progress (with `revision: this.#ledger?.revision.number ?? progress.revision`).
   - In `src/core/types/daemon.ts` and `src/core/daemon/run-group.ts`:
     - Extend the `listing` variant of `GroupHolder` and `HeldBy` with optional fields (100% backward-compatible with older daemons and existing JSON consumers):
       `{ readonly kind: "listing"; readonly revision: number; readonly stage?: RefinementStage; readonly done?: number; readonly total?: number }`
     - In `watchHolder` (`run-group.ts`): read `scheduler.refinementProgress?.()` when `lock === null`, populating `stage`, `done`, `total` on the `listing` holder when present (falling back to `scheduler.listing?.()` if absent).
   - In `src/cli/group-pending.ts`:
     - Update `heldText` for `case "listing"`:
       - When `holder.stage` is absent or `"listing"`: keep exact existing wording `it waits while Squeal lists revision ${holder.revision}` (so existing tests that pass `{ kind: "listing", revision: 7 }` stay 100% green!).
       - When `holder.stage === "invalidating"`: `it waits while Squeal updates the runner for revision ${holder.revision} (invalidate / install)`
       - When `holder.stage === "environment"`: `it waits while Squeal reads the runner environment for revision ${holder.revision}`
       - When `holder.stage === "affected"`: `it waits while Squeal computes affected test files for revision ${holder.revision}`
       - When `holder.stage === "closures"`:
         - If `holder.total !== undefined && holder.total > 0`: `it waits while Squeal resolves test closures for revision ${holder.revision} (${holder.done ?? 0}/${holder.total} test files)`
         - Else: `it waits while Squeal resolves test closures for revision ${holder.revision}`
       - When `holder.stage === "edit-cut"`: `it waits while Squeal classifies affected test files for revision ${holder.revision}`
3. **Add `Scheduler.requeueUnknown` (`src/core/types/scheduler.ts` & `src/core/scheduler/scheduler.ts`):**
   - Add optional method `requeueUnknown?(match: (reason: string) => boolean): Promise<number>` to `Scheduler` and implement it on `TierScheduler`:
     - If `this.#closed || this.#context === null || this.#ledger === null`, return `0`.
     - Acquire `this.#lock.run(..., "re-queueing recovered unknown test files")`:
       - Read `readUnknownFiles(context.store, context.worktreeId)` to find each `file` in `ledger.files.values()` where `file.unknownKey !== null && file.unknownKey === file.key && file.blocked === null && file.phase === null` AND the stored `UnknownFileRecord` for `file.id` has `entry.key === file.key && match(entry.reason)`.
       - For each matching file: clear `file.unknownKey = null`, settle/enqueue it (`ledger.settle(refs, NOTHING_CHANGED)`), commit the ledger (`ledger.commit()`), and return the count of re-queued files.
     - Outside the lock, if `count > 0`, call `this.#pump()`.
     - Never clear `unknownKey` or re-queue files whose unknown reason does NOT match `match` (e.g. test timeout, crash, unstable inputs), or files that are `blocked` or already queued/running!
4. **Tests:**
   - `test/scheduler/refinement-concurrency.test.ts`:
     - Verify `fetchRunnerPart` runs up to `CLOSURE_CONCURRENCY` (16) `runner.closure(ref)` calls concurrently (proving 32 closures complete in ~2 waves instead of 32 sequential waits!), preserves deterministic closure ordering, handles partial failures cleanly, and reports all refinement stages + closure `done`/`total` progress.
   - `test/scheduler/requeue-unknown.test.ts`:
     - Verify `scheduler.requeueUnknown(match)` clears `unknownKey` and re-queues only matching `unknown` files, leaves non-matching `unknown` files (e.g. timeouts) untouched, triggers the pump so recovered files run and flip back to `PASS`, and returns `0` cleanly when closed or no files match.
   - `test/cli/group-pending.test.ts`:
     - Verify backward-compatible `{ kind: "listing", revision: 18 }` wording and each new `stage` (`invalidating`, `environment`, `affected`, `closures` with `done`/`total`, `edit-cut`).
5. **Constraints & verification:**
   - Never use `/home/` paths in code or tests (`pnpm run check:private`).
   - Do not change `KEY_FORMAT_VERSION`, key formats, or SQLite schema.
   - Run `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:private`, and `pnpm exec vitest run test/scheduler/refinement-concurrency.test.ts test/scheduler/requeue-unknown.test.ts test/cli/group-pending.test.ts test/cli/group-pending-release.test.ts test/scheduler/narrow-run.test.ts test/scheduler/runner-part-bound.test.ts test/keys/key-format.test.ts` (and check `squeal status --wait 60000` on your changed paths). Commit cleanly when done.
