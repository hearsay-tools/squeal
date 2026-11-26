# Spec 026, Wave 12.5: repair blockers B1–B4 from `reviews/0.1.637.md`

Base: `6d54791c2` (`cand/0.1.637` + `reviews/0.1.637.md` FAIL on `b1839e7e80d086b91c43123c97110499a5b8a608`).
Nonblocking note N1 resolved by contract: `MachineShare.refreshGit` intentionally keeps its local read-only `m.syncGit(null, signal)` check after `beginExit()` so an already-running tier retains an accurate `gitCurrent()` view, while refusing any remote SSH write (`writeGit`).

---

## Repair R1 (B1): normalize remote channel-loss reports in `lane.ts` so automatic recovery and `#278` match real proxy drops

**Owned files:**
- `src/core/runner-host/remote/lane.ts`
- `test/runner-host/remote/lane-reconnect.test.ts`
- `test/runner-host/remote/lane-admission.test.ts` (only if an existing expectation changes)

Do not edit `package.json`, `docs/board.md`, `src/core/scheduler/**`, `src/cli/**`, or plugin bundles.

**Requirements (from `reviews/0.1.637.md` B1):**
1. In `src/core/runner-host/remote/lane.ts` `cutShort(host, reply, testFiles)`:
   - When `runnerHostGone(host.adapter)` and `options.whenLost === "not-run"`:
     - Extract the original cause: `const cause = reply.failure ?? "the host ended"`.
     - Call `down(cause, false, host)`.
     - Always normalize the returned failure string via `lostReport(testFiles, cause)` so it carries the remote target, original cause, `whenLost "not-run"`, and recovery (so `isRemoteOutageReason(report.failure)` is `true` and `#278` `reasonOutage(report.failure)` parses it!).
     - Preserve `end: "timed-out"` (and `durationMs`) when `reply.end === "timed-out"` so paused-container timeout tests (`test/e2e/remote-lane.test.ts:242`) still observe `end: "timed-out"` with `completedFiles: []`, `results: []`, and the normalized remote-outage `failure` string.
     - For `reply.end === "crashed"` or `reply.end === "completed"` (channel drop), return `lostReport(testFiles, cause)` (`end: "crashed"`).
   - Under `options.whenLost === "local"`, preserve existing local-fallback and cancelled-run semantics (do not break `test/e2e/remote-lane.test.ts` or `test/runner-host/remote/lane*.test.ts`).
   - Do NOT broaden `isRemoteOutageReason` to match arbitrary local runner crashes — keep normalization strictly at the remote lane boundary where `runnerHostGone(host.adapter)` proves a remote channel loss.
2. Add tests in `test/runner-host/remote/lane-reconnect.test.ts`:
   - Real proxy-channel drop on both initial run and reconnect-once retry (`kill()` inside `remoteRun` under `whenLost: "not-run"`): assert `lost.end === "crashed"`, `lost.failure` contains the remote name, the original proxy exit cause (`exited`), and `whenLost "not-run"`, AND `isRemoteOutageReason(lost.failure ?? "") === true`.
   - End-to-end lane-to-scheduler recovery test (combining real `withRemoteLane`, `isRemoteOutageReason`, and `requeueUnknown` or a real scheduler harness): drop both initial and retried channels so the file becomes `unknown`, reconnect later so `onRecovered` fires -> `requeueUnknown(isRemoteOutageReason)`, and prove the same-key file runs and becomes current `PASS`.
3. Verify with `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:private`, and `pnpm exec vitest run test/runner-host/remote/lane-reconnect.test.ts test/runner-host/remote/lane-admission.test.ts test/runner-host/remote/lane.test.ts test/runner-host/remote/daemon-lane.test.ts test/runner-host/remote/daemon-lane-exit.test.ts`. Commit cleanly.

---

## Repair R2 (B2): track uncapped per-file `unknownReason` on `FileState` so `Scheduler.requeueUnknown` heals past 256 files

**Owned files:**
- `src/core/scheduler/files.ts`
- `src/core/scheduler/ledger.ts`
- `src/core/scheduler/scheduler.ts`
- `src/core/scheduler/checkpoint-requests.ts`
- `src/core/scheduler/commit-moment.ts`
- `src/core/scheduler/failures.ts`
- `src/core/scheduler/narrow-run.ts`
- `src/core/scheduler/slow-tier.ts`
- `test/scheduler/requeue-unknown.test.ts`

Do not edit `package.json`, `docs/board.md`, `src/core/runner-host/**`, `src/cli/**`, or plugin bundles.

**Requirements (from `reviews/0.1.637.md` B2):**
1. Add `unknownReason: string | null` to `FileState` in `src/core/scheduler/files.ts` (initialized `null`), plus a small `clearUnknown(file: FileState): void` helper that sets both `file.unknownKey = null` and `file.unknownReason = null`.
2. In `src/core/scheduler/ledger.ts` `markUnknown`: set `file.unknownReason = reason` alongside `file.unknownKey = key`.
3. Replace every `file.unknownKey = null` reset across `ledger.ts`, `scheduler.ts`, `checkpoint-requests.ts`, `commit-moment.ts`, `failures.ts`, `narrow-run.ts`, and `slow-tier.ts` with `clearUnknown(file)` so `unknownReason` never outlives `unknownKey`.
4. In `src/core/scheduler/scheduler.ts` `requeueUnknown(match)`:
   - Do NOT read the 256-entry capped `readUnknownFiles(store, worktreeId)` diagnostic sample to decide eligibility.
   - Instead, iterate `ledger.files.values()` directly: a file matches when `file.key !== null && file.unknownKey === file.key && file.unknownReason !== null && file.blocked === null && file.phase === null && match(file.unknownReason)`.
   - Clear with `clearUnknown(file)`, settle/enqueue under the lock, commit, and pump outside the lock (keeping existing busy-store and closed-scheduler guards intact).
5. Add a scale regression test in `test/scheduler/requeue-unknown.test.ts`:
   - Create **260** test files (exceeding `UNKNOWN_FILES_KEPT = 256`) plus at least 2 unrelated unknown files (e.g. a timeout and a local crash).
   - Mark all 260 files unknown via a remote-outage report (`remote box unreachable; not run here (whenLost "not-run")`), and mark the 2 unrelated files unknown with non-matching reasons.
   - Call `scheduler.requeueUnknown(match)` and wait for completion: assert `requeueUnknown` returns `260`, ALL 260 remote-outage files run and become current `PASS` (0 remaining unknown), and the 2 unrelated files stay `unknown`.
6. Verify with `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:private`, and `pnpm exec vitest run test/scheduler/requeue-unknown.test.ts test/scheduler/refinement-concurrency.test.ts test/scheduler/narrow-run.test.ts test/keys/key-format.test.ts`. Commit cleanly.

---

## Repair R3 (B3 & B4): parse enriched `lostReport` and enforce strict per-file / listing causality in `#278` CLI diagnostics

**Owned files:**
- `src/cli/remote-outage-text.ts`
- `src/cli/status-wait-lines.ts`
- `src/cli/no-verdict-lines.ts`
- `src/cli/retry-unlisted.ts`
- `src/cli/proof-green.ts`
- `src/cli/proof-side.ts`
- `test/cli/remote-outage-diagnostics.test.ts`
- `test/cli/remote-outage-retry.test.ts`

Do not edit `package.json`, `docs/board.md`, `src/core/runner-host/**`, `src/core/scheduler/**`, `src/core/daemon/**`, or plugin bundles.

**Requirements (from `reviews/0.1.637.md` B3 & B4):**
1. **B3 — Accept the enriched `lostReport` format in `reasonOutage` (`src/cli/remote-outage-text.ts`):**
   - Support the exact current producer format from `lane.ts`:
     `remote <target> unreachable during the run of <N> files (<reason>); not run here (whenLost "not-run"); waits retry once <target> reconnects or run squeal retry`
     (with optional runner prefix like `vitest: `, optional trailing recovery clause, and any original cause inside parentheses including nested parens like `(the vitest runner host exited (signal SIGKILL))` — be careful with balanced/greedy matching before `); not run here` so nested parens in `(signal SIGKILL)` or `(code 255)` are NOT truncated!).
   - Retain support for all older persisted formats (`remote <target> unreachable; not run here (whenLost "not-run")`, `remote <target> refused (<reason>); not run here (whenLost "not-run")`, `remote <target> unreachable since <ISO> (<reason>); not planned here (whenLost "not-run")`, etc.).
   - Verify `sideOutageText` also parses this enriched format cleanly and appends the recovery action (without duplicating recovery if already present, or normalizing consistently).
2. **B4 — Enforce strict per-file and listing causality (`src/cli/remote-outage-text.ts`, `src/cli/status-wait-lines.ts`, `src/cli/no-verdict-lines.ts`, `src/cli/proof-green.ts`):**
   - Never treat an unrelated remote lane note/summary as the blocker for selected files merely because selected files are non-current!
   - Specifically in `outageOf` / `waitOutage`:
     - **Case 1 (direct selected-file evidence):** One or more selected files have an `unknown` reason matching `reasonOutage(reason)` (or `listingFailure` matches `reasonOutage`). Then use that direct outage, optionally enriching its timestamp/state from a matching remote note for the **same** remote target (never from a different target or a note that says `running here`).
     - **Case 2 (listing blocked by remote planning):** `testFilesListed === false` (or `unlisted` / `retry` when the worktree has not listed its test files yet) AND the recorded remote summary/notes show a remote with `planning remote` + active `unreachable`/`refused` under `whenLost "not-run"` (and no healthy summary overriding it). Then the remote planning outage directly explains why the worktree could not list test files.
     - **Case 3 (unrelated local failure beside an active remote note on another runner):** e.g., `summary` shows `node-test` unreachable on `box` and `notes` has `remote-lane:node-test`, while the selected file's `unknown` reason is `"timed out after 60 s"` (or `"runner crashed"`), and `testFilesListed === true`. `outageOf` / `waitOutage` MUST return `null`! Do NOT blame `box` for a local Vitest timeout!
     - **Case 4 (per-file handling in `proof-green.ts`):** Evaluate remote outage per file rather than computing one shared outage for the whole batch! A file with a remote-outage `notDetermined.detail` or blocked because the commit daemon listed nothing (`keyed.length === 0`) due to a remote planning outage gets the remote outage text + recovery; a sibling file with an unrelated local/missing reason keeps its exact original detail untouched!
3. **Tests (`test/cli/remote-outage-diagnostics.test.ts` & `test/cli/remote-outage-retry.test.ts`):**
   - Exact enriched `lostReport` string with nested parens (`remote box unreachable during the run of 1 files (the vitest runner host exited (signal SIGKILL)); not run here (whenLost "not-run"); waits retry once box reconnects or run squeal retry`) as the **SOLE** evidence (no summary, no notes): assert `reasonOutage`, `namedText`, `timeoutText`, and `sideOutageText` all extract `box`, the full inner cause `the vitest runner host exited (signal SIGKILL)`, `whenLost "not-run"`, and supported recovery.
   - Mixed-runner negative test (exact probe from `reviews/0.1.637.md` B4): `node-test` remote outage note + summary alongside a selected file with `reasons: ["timed out after 60 s"]` and `testFilesListed: true` -> `outageOf` returns `null`, `namedText` and `timeoutText` produce byte-identical local wording with zero mention of the remote!
   - Mixed-proof batch test in `proof-green.ts`: one file with remote outage detail and one file with unrelated local/missing detail -> only the remote-outage file gets the remote outage diagnostic and recovery; the unrelated file keeps its exact detail; neither becomes `pass`/`proven`.
4. Verify with `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:private`, and `pnpm exec vitest run test/cli/remote-outage-diagnostics.test.ts test/cli/remote-outage-retry.test.ts test/cli/retry-unlisted.test.ts test/cli/status-wait-reasons.test.ts test/cli/status-wait-listing.test.ts test/cli/status-wait-synced-lapse.test.ts test/cli/status-wait-deadline.test.ts test/cli/proof-report.test.ts test/cli/proof-green-daemon.test.ts`. Commit cleanly.
