# Spec 026 Wave 9 briefs (approved bugfix rows 026-23 and 026-24)

Approved by the human on 2026-11-25 after live Agent37 usage hit two remote-lane defects:
1. Concurrent `node:test` backlog slots clobbering each other's single-slot remote admission grant, causing `LATE_RUNS` to kill a healthy remote host, misreport sibling runs as `"run completed"`, and fail runs during reconnect under `whenLost: "not-run"`.
2. Remote blob proof rejecting whole 100–200-file Vitest tiers twice when one file's closure or observed inputs touched a local git-ignored build artifact that `treePathsFor()` never syncs (issue `#280`).

Rows `026-23` and `026-24` both touch `src/core/runner-host/remote/lane.ts`, so `026-23` runs first (Wave 9a) and `026-24` starts from `026-23`'s integrated commit (Wave 9b).

---

## Row 026-23: Concurrent remote admission grants, safe host-loss handling, and reconnect wait under `whenLost: "not-run"`

- **Role:** Use `/worker`.
- **Spec:** `docs/specifications/021-remote-store-and-execution/spec.md` (D11, D13, D18), `docs/specifications/026-tiered-and-cloud-execution/spec.md` (D8, D12)
- **Shape:** slice
- **Starting seam:** `src/core/runner-host/remote/admission.ts` (`AdmitAsk`, `HostAdmission`, `createHostAdmission`, `remoteAdmission`, `admitRun`), then `src/core/runner-host/remote/tree-wire.ts`, `src/core/runner-host/host.ts`, and `src/core/runner-host/remote/lane.ts`.
- **File ownership:**
  - `src/core/runner-host/remote/admission.ts`
  - `src/core/runner-host/remote/tree-wire.ts`
  - `src/core/runner-host/host.ts`
  - `src/core/runner-host/remote/lane.ts` (admission, host-loss, and `ready`/`reach` connect-wait paths only; do not rewrite the proof loop)
  - `test/runner-host/remote/admission.test.ts`
  - `test/runner-host/remote/admission-expiry.test.ts`
  - `test/runner-host/remote/lane-admission.test.ts`
  - `test/runner-host/remote/lane.test.ts`
  - **Do NOT edit:** `docs/board.md`, `status.md`, `package.json`, `plugins/*/dist/*`, `src/core/scheduler/*`, `src/core/runner-host/remote/tree.ts`, `src/core/runner-host/remote/connect.ts`.

### Requirements

1. **Per-grant token in `HostAdmission` (`admission.ts`, `tree-wire.ts`, `host.ts`, `lane.ts`):**
   - Add optional `readonly token?: string` to `AdmitAsk` and optional `readonly admitToken?: string` to `RemoteRunOptions`.
   - Change `HostAdmission.claim(token?: string)` to accept an optional `token`.
   - In `createHostAdmission()`, replace the single `let held` slot with a `Map<string | symbol, HeldEntry>` keyed by `token ?? DEFAULT_KEY` (a private `Symbol`).
     - When `admit({ want, least, token })` is called with `token !== undefined`, drop ONLY `held.get(token)` (never other concurrent grants). When `want < 1`, return `{ grant: 0 }` after dropping only that token (or all held grants when `want < 1 && token === undefined`, keeping legacy `admit({ want: 0, least: 0 })` behavior).
     - Each held entry has its own `holdMs` timeout that releases and deletes ONLY its own entry.
     - `claim(token)` with `token !== undefined` claims and deletes strictly `held.get(token)` (returns `null` if absent; never steals another slot's grant). `claim()` with `token === undefined` claims `DEFAULT_KEY` first, or falls back to the oldest entry in `held` for legacy tests.
     - `close()` releases and clears every held entry, then closes the pool.
   - In `remoteAdmission()`, when `cancel` aborts after a grant arrives, pass `ask.token` in the release call (`admit({ want: 0, least: 0, ...(ask.token === undefined ? {} : { token: ask.token }) })`) so cancelling one slot never drops a sibling's grant.
   - In `admitRun()` / `lane.ts:admittedRun()`, generate a unique token per attempt (e.g. `${run.runId}:${late}` or monotonic counter + `run.runId`), pass it in `ask.token`, and send `admitToken: token` on `host.adapter.run(...)`.
   - In `host.ts:run()`, call `admission.claim(wire.admitToken)`.

2. **Safe host-loss handling and honest lost reports (`lane.ts`):**
   - Track which `RemoteHost` transitioned the lane to `"down"` (or has already been closed) so concurrent sibling runs unwinding on the same dead host do NOT increment `failures` multiple times, do NOT overwrite the root `why` reason with `"the host ended"`, and do NOT tear down a newer healthy host if `host !== state.host`.
   - In `lane.ts:remoteRun()`, when `runnerHostGone(host.adapter)` is true after `admittedRun()` returns:
     - Pass `host` to `down(reply.failure ?? "the host ended", false, host)`.
     - Preserve `stripped(reply)` only when `reply.end !== "completed"` and `reply.failure != null` (e.g., `HostLost` timed-out/crashed reports). Otherwise (such as a `node:test` run aborted by host close returning `end: "completed", completedFiles: [], failure: null`), return `{ lost: lostReport(testFiles) }` so checks never report `PASS -> UNKNOWN` with reason `"run completed"`.

3. **Wait for in-flight connect/wake under `whenLost: "not-run"` (`lane.ts`):**
   - In `remoteTier()`, pass `wait = options.awaitConnect === true || options.whenLost === "not-run"` and `cancel = cancelOf(run)` to `ready()` / `reach()`.
   - When `state.kind === "connecting"` and `wait` is true, wait for `connecting` raced against `cancel`. If `cancel` aborts while still connecting, return `{ cancelled: notStarted() }` instead of falling through to `instead()` (`unreachable`).
   - Preserve immediate `instead()` (`unreachable; not run here`) when `state.kind === "down"` and `now() < state.retryAt` (backoff active), and preserve `whenLost: "local"` running locally without waiting for a connect unless `awaitConnect` is set.

### Done when

- Unit tests prove:
  1. Four concurrent `lane.run()` calls on one `RemoteHost` with staggered async delays between `admit` and `run` all complete remotely without any `{ unadmitted: true }` or host close.
  2. Cancelling one slot during admission releases only its own permit and leaves concurrent slots' permits intact.
  3. Multiple concurrent runs unwinding on one lost host increment `failures` once (single backoff step) and preserve the original loss reason.
  4. A run aborted mid-flight by host death whose raw reply has `end: "completed", completedFiles: [], failure: null` returns `end: "crashed"` with an unreachable failure message (never `end: "completed"`).
  5. Under `whenLost: "not-run"`, a run arriving while reconnecting or waking waits for the connect and runs remotely when it succeeds, returns `notStarted()` on cancel during connect, and still returns `unreachable; not run here` while in backoff.
- `pnpm run lint`, `pnpm run typecheck`, and affected tests (`squeal status --wait 60000 <changed-paths>` or targeted `vitest run`) pass.
- Stopping condition: commit clean changes on your branch without running `pnpm run build` and without touching `docs/board.md`.

---

## Row 026-24 (from `gh-280`, `#280`): Per-file remote proof isolation and unsyncable git-ignored input handling

- **Role:** Use `/worker`.
- **Spec:** `docs/specifications/021-remote-store-and-execution/spec.md` (D10, D11, D13, D17), `docs/specifications/026-tiered-and-cloud-execution/spec.md` (D8, D12), `docs/specifications/026-tiered-and-cloud-execution/research/issue-280.md`
- **Shape:** slice
- **Starting seam:** Create pure proof-partitioning helper `src/core/runner-host/remote/lane-proof.ts` and wire it into `src/core/runner-host/remote/lane.ts`.
- **File ownership:**
  - `src/core/runner-host/remote/lane-proof.ts` (new, under 300 lines)
  - `src/core/runner-host/remote/lane.ts`
  - `test/runner-host/remote/lane-proof.test.ts` (new)
  - `test/runner-host/remote/lane.test.ts`
  - **Do NOT edit:** `docs/board.md`, `status.md`, `package.json`, `plugins/*/dist/*`, `src/core/runner-host/remote/tree.ts`, `src/core/runner-host/remote/admission.ts`, `src/core/runner-host/host.ts`.

### Requirements

1. **Preserve strict soundness and policy boundaries (021 D10/D11/D13, `#280`):**
   - Never drop any differing input (ignored or not) from proof to admit a result.
   - Never copy git-ignored files to the remote tree (preserve `treePaths` / `treePathsFor` boundary).
   - Honor explicit `whenLost: "not-run"` (never silently run refused files locally when `whenLost === "not-run"`).

2. **Structured per-file inputs (`lane.ts` + `lane-proof.ts`):**
   - Have `runInputs()` retain:
     - `configs`: shared environment/config files (`planner.environment()`), which apply to every file in the tier;
     - `byFile`: `Map<string, ReadonlySet<string>>` keyed by `testFileId(file)` holding each test file's closure paths;
     - `all`: deduplicated list of all input paths.
   - Partition differing paths `differ` against `treePathsFor(root, differ)` and local blobs (`localBlobs`):
     - A path `p` in `differ` is **unsyncable (git-ignored local file)** when `localBlobs[p] !== null && !inTree.has(p)`.
     - Any other differing path (in `inTree`, or deleted locally with `localBlobs[p] === null`) is **syncable**.
   - Partition `remaining` test files using `configs`, `byFile`, and post-run `reply.observed` (per `testFileId(file)`):
     - A path `p` in `differ` taints ALL files in `remaining` if `configs.has(p)` OR if `p` is not attributable to any file's closure or observed set (fail closed).
     - Otherwise, `p` taints ONLY the files whose closure or `reply.observed` contains `p`.
     - Every other file in `remaining` is **proven** (its entire `configs ∪ closure(f) ∪ observed(f)` matched before and after the run).

3. **Zero wasted retries and per-file isolation in `remoteRun()` / `remoteTier()`:**
   - **Pre-run refusal (`reply.refused !== undefined`):**
     - Partition `remaining` into `unsyncableFiles` (tainted by unsyncable paths) and `otherFiles`.
     - Record `unsyncableFiles` as refused with their unsyncable paths (never re-run them remotely).
     - Evict `differ` from `blobCache`, queue only `syncable` paths for resend, and continue with `otherFiles` (if non-empty, up to 1 retry for syncable diffs; if only unsyncable paths caused the pre-run refusal, run `otherFiles` once cleanly without counting that as a wasted retry on `otherFiles`).
   - **Post-run proof mismatch (`reply.refused === undefined`, `differ.length > 0`):**
     - Immediately keep all `provenFiles` from `reply` (strip unproved files via `withoutFiles(reply, unproved)` and coverage via `recordsWithout(reply.coverage, unproved)`), tagging core under `remote-key` and calling `proven()` when at least one file was proven.
     - Never re-run `provenFiles` and never re-run `unsyncableFiles`.
     - Only retry `retryFiles` (files tainted solely by `syncable` paths), after evicting `differ` from `blobCache` and queuing `syncable`, at most once.
   - **Actionable refusal wording and partial-tier assembly:**
     - When refusal is caused by unsyncable git-ignored paths, format the reason as `git-ignored input ${shown} exists locally and is not synced to remote` (up to 5 paths, matching existing truncation). When caused by syncable paths staying different after retry, keep exact wording `its tree stayed different at ${shown}`.
     - Under `whenLost: "local"`, run ONLY the refused files locally (`runHere(refusedFiles, run, "here")`) and merge with the proven remote report (also running the D19.2 `needsRepository` guard on the proven remote report as before).
     - Under `whenLost: "not-run"`:
       - If NO files were proven, return `{ refused: reason }` (preserving exact `instead()` output: `remote <target> refused (<reason>); not run here (whenLost "not-run")`).
       - If SOME files were proven and SOME were refused, keep the proven files' results and coverage, increment `notRun += refusedFiles.length`, log the refusal clearly, and return the proven report with `failure: \`remote ${target} refused (${reason}); not run here (whenLost "not-run")\`` (and `end: "completed"` so `recordTier` stores the proven files and marks only the refused uncompleted files `unknown` with that exact failure reason). Respect `startupFailure` via `deferredTo` if present.

### Done when

- Unit tests prove:
  1. Multi-file tier where 1 file observes a local git-ignored file (e.g. `dist/index.html`) and 2 sibling files do not: remote runs **once** (no wasted 2nd run), the 2 clean siblings keep their remote results and remote coverage, and under `whenLost: "not-run"` only the 1 offending file is uncompleted with failure naming `git-ignored input dist/index.html exists locally and is not synced to remote` (and under `whenLost: "local"` only that 1 file runs locally and merges cleanly).
  2. Multi-file tier where 1 file has a local git-ignored file in its static/known closure (pre-run `reply.refused`): the 1 offending file is isolated without retrying it, and the clean siblings run remotely and pass.
  3. Unattributable or config-file mismatch fails closed (taints the whole tier; never admits an unproved file).
  4. Syncable (tracked/unignored) tree diff still retries once after re-sending and preserves `its tree stayed different at <path>` if it still differs on attempt 2.
  5. Deleted local tracked file (`localBlob === null`, remote stale) is still treated as syncable (retried and removed on remote).
- `pnpm run lint`, `pnpm run typecheck`, and affected tests pass.
- Stopping condition: commit clean changes on your branch without running `pnpm run build` and without touching `docs/board.md`.
