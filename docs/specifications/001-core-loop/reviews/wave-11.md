# Review: wave 11, 001-100 and 001-101 (task 001-103)

Reviewer task 001-103 for spec 001, 2026-10-07. Range `49b5a28..9d92249`. In scope:

- 001-100: `7238b56`, `18f504b`, `c7ca289`, `168e3f0`, `fbbcccb`.
- 001-101: `1ab1055`, `67a32fe`.
- The rebuild `9d92249` (0.1.17).

The 002 and 003 commits between them belong to the other coordinator and are out of scope. I read the range against the wave 11 briefs, D5, D9 and D10 as amended, and `lessons.md` defects 17 to 19.

The design as built:

- **Install wait.** The scheduler splits its start into `scan` (no runner) and `baseline`. When the root `package.json` declares dependencies and the root has no installed lockfile, it marks the known test files `unknown`, sets `awaiting-install.<worktree>`, and records revisions with nothing for the runner. Each batch and each `run --all` looks again. The batch that finds the install runs the baseline.
- **Recent first.** A queue entry carries a sticky `recent` flag, set by `Ledger.settle` for a file whose closure, path or direct-importer status a revision changed. Recent entries sort ahead of all others.
- **Delta reading and deny-once.** `beforeFailing` reads a pass followed by `to-unknown` as the state before a failure. The shared deny peeks `pass-to-fail` only.

## Verdict

**FAIL at `9d92249`.** Counts: 1 blocker, 3 should-fix, 5 nits.

- **Can the install wait leave a check falsely current or hide a failure?** Yes, through `run --all` (B1).
  - In a fresh worktree that waits, `squeal run --all` records a full-suite checkpoint that completes at once with zero files.
  - Every header then says "Full-suite checkpoint: completed at revision N" and drops the "not listed" sentence. `squeal run --all --wait` prints `completed` and exits 0, and `stop.requireFullSuite` is met.
  - Nothing was listed or run.
  - Otherwise the wait is honest. The registration says it is waiting, and known states become `unknown`, not `pass`.
  - The first reports after the install are baseline findings. They are delivered at the tool boundary and deny nothing.
- **Can recent-first hide a failure or leave a check falsely current?** No. It only reorders the queue. Every queued file stays `pending`, and a queued last-known failure still reads as a failure whose re-run is pending.
  - The backlog runs only in tiers that recent work does not fill. With edits that keep 4 or more recent files queued at every boundary, the backlog does not progress (N3).
  - One gap is the defect-19 symptom again: an edit made during the wait is not treated as recent once the install starts the baseline (S2).
- **Can the new delta reading or deny-once lose or mislabel a transition?** No case found.
  - Recorded transitions into `unknown` only ever come from `pass` or `fail` (`transitionKind`). Every entry into `fail` is recorded. So the walk in `passBeforeUnknown` never skips a real failure, and a `PASS -> FAIL` it reports had a pass as the last decided outcome before the failure.
  - Peek and full delivery share the one `planDelta` call with history (`delivery.ts:87`). A denial and the next tool boundary therefore read the same transition.
  - The narrowing does not hold "never while no dependencies are installed" for `npm ci` in a worktree whose daemon is running. The spec scopes that case out (S1).

## Verification

HEAD was `f83a34b`, one commit past the candidate. It changes only `docs/board.md` and `tasks/wave-11.md` (`git diff --stat 9d92249 f83a34b`). I checked out `9d92249` and ran everything there.

```
$ git rev-parse HEAD
9d92249f739321c25f95af7f8b9fd2b7b8bbaeb2
$ npm ci
added 56 packages, and audited 57 packages in 2s ... found 0 vulnerabilities (install-scripts warnings for @parcel/watcher and esbuild)
$ npm run lint
Checked 457 files in 116ms. No fixes applied.
$ npm run typecheck
tsc --noEmit   (no output, exit 0)
$ npm run build
(exit 0)
$ git status --short
(empty: committed bundles of both plugins match the build)
$ npx vitest run
 Test Files  160 passed (160)
      Tests  1339 passed | 7 skipped (1346)
   Duration  71.11s
$ npx vitest run test/e2e/policy.test.ts test/scheduler/install-wait.test.ts test/scheduler/backlog.test.ts \
    test/daemon/install-wait.test.ts test/harness/pre-tool-use.test.ts test/delivery/delivery.test.ts
 001-100: test/f123.test.ts ran at position 5 of 200, before 195 queued files
 Test Files  6 passed (6)
      Tests  78 passed (78)      (none skipped; the new e2e case ran against the committed bundle)
```

I ran the probes in throwaway `test/scheduler/zz-r11-probe*.test.ts` files and a script at `/tmp/r11p/probe.mts`. All were deleted before commit. Results:

| Probe | Result |
| --- | --- |
| `awaitsInstall` on layouts (`/tmp/r11p`) | bun with committed `bun.lock`, no `node_modules`: `false` (S3). Root `workspaces` with only `packages/a/node_modules/.package-lock.json`: `true`, and stays so (N2). `node:test` manifest with no dependencies: `false`. `devDependencies: {}`: `false`. `peerDependencies` only: `false`. Root `.package-lock.json` or `node_modules/.pnpm/lock.yaml`: `false`. npm 6 `node_modules` without a hidden lockfile: `true`. |
| `run --all` in a fresh waiting worktree (scheduler harness, `basic` fixture with `devDependencies`) | checkpoint `{"kind":"run-all","testFiles":[],"end":"completed"}`, 0 runs. Header: `fullSuite: {atCurrentRevision: true}`, `testFilesListed: true`, `awaitingInstall: true`. Registration: `Revision 0: 0 current, 0 pending, 0 stale, 0 unknown. Full-suite checkpoint: completed at revision 0. ... No dependencies are installed in this worktree; Squeal lists and runs no tests until an install.` (B1) |
| Edit to `src/m035.ts` during the wait, then the install (40 files, tier 4) | `test/f035.test.ts` ran 36th of 40, in listing order (S2) |
| Installed lockfile deleted while the daemon runs (`npm ci`'s first step) | 3 tiers, 5 files ran, `awaitingInstall` undefined (S1) |
| A test file added during the wait, harness runner opened before the wait | never listed. A harness artifact: the real daemon creates Vitest lazily after the install and globs fresh. See inputs for 003-16. |

## Blockers

### B1. `run --all` while waiting records a completed full suite that ran nothing (proven)

`src/core/scheduler/scheduler.ts:152`, `src/core/scheduler/tiers.ts:208`, `src/core/scheduler/checkpoints.ts:52`, `src/core/state/header.ts:57`.

**What happens.**

- The comment at `scheduler.ts:150` says: "still waiting, every file is unkeyed and the checkpoint ends `abandoned`". That holds only when an earlier daemon listed files.
- In a fresh worktree, the case defect 18 is about, `ledger.files` is empty. `queueFullSuite` starts a `run-all` checkpoint over zero files, and `Checkpoints.start` completes it at once ("With no files it completes at once").
- `readHeader` then sets `testFilesListed: keys.length > 0 || last !== null` to `true`, and `fullSuite.atCurrentRevision` to `true`.

**What breaks.**

- Goal 5: status answers "whether a full-suite run exists for this revision".
- The vision: "It says 'no known failures', not 'everything passes', unless it has actually run everything."
- D5 as amended: "lists, keys and runs nothing".
- The header now says "Full-suite checkpoint: completed at revision 0" next to "Known failures: 0", and the not-listed sentence is gone.
- `squeal run --all --wait` prints `Checkpoint <id> completed` and exits 0 (`src/cli/run.ts:54-57`).
- `stop.requireFullSuite` passes (`src/harness/shared/stop.ts:102`).

**Failure scenario.** `git worktree add`, then a session starts and the daemon waits. A completion gate runs `squeal run --all --wait`, gets exit 0, and the task is declared validated with no test run.

**Fix (one worker, `src/core/scheduler/`, `src/core/state/header.ts`).**

- While the scheduler still waits after its reconciliation pass, `requestFullSuite` records the checkpoint as `abandoned`. For example, give `Checkpoints` a way to start one already failed, so a zero-file checkpoint does not complete.
- `readHeader` does not count a checkpoint as a listing while `awaiting-install` is `true`.
- Test in `test/scheduler/install-wait.test.ts`: a fresh waiting worktree, `requestFullSuite()`, then `end === "abandoned"`, `header.fullSuite.atCurrentRevision === false` and `testFilesListed === false`.
- Optionally the daemon variant in `test/daemon/install-wait.test.ts`: `squeal run --all --wait` exits 1.

## Should-fix

### S1. `npm ci` in a validated worktree pushes and denies `PASS -> FAIL` for every check (proven, scoped out by the spec)

`src/core/scheduler/scheduler.ts:120-133`, `src/harness/shared/deny.ts:14`.

**Brief vs spec.**

- The 001-101 outcome reads "never while no dependencies are installed", and its done-when "no deny while the no-dependencies state holds".
- The coordinator chose no separate guard. D9 says: "A worktree waiting for an install runs nothing, so no pass can be seen there and nothing denies".
- D5 says: "A worktree whose dependencies are removed while its daemon runs is not covered."

**The gap.**

- `npm ci` removes `node_modules` before it installs. The probe shows the daemon re-keys and runs every file once the installed lockfile is deleted, with no wait.
- In a real worktree those runs fail with "Cannot find package", per defect 18's evidence. Every passing check becomes a `PASS -> FAIL`: pushed, and denied once.
- The header beside the denial says no dependencies are installed. That is the picture defect 17 recorded, with `PASS -> FAIL` in place of first-seen.

**Why not blocking.** The spec as amended excludes the case explicitly, and the "no-dependencies state" in the done-when reads as the wait.

**Fix.** Enter the wait from `handleBatch` too: when a batch deletes the root's installed lockfile and `awaitsInstall(root)` holds.

- Mark the files `unknown` with `AWAITING_INSTALL_REASON` and set the meta key.
- Run nothing until a pass finds the lockfile again.
- The tier in flight may finish: its results are already discarded by the key move.
- Amend D5's "not covered" sentence.

### S2. An edit made during the wait is not recent when the install starts the baseline (proven)

`src/core/scheduler/install.ts:91` (`ledger.files.clear()`), `src/core/scheduler/bootstrap.ts:93` (`settle(..., NOTHING_CHANGED, ...)`).

**What happens.**

- The likely order in a fresh worktree: the agent edits, reads "no tests until an install", then installs. The post-install baseline then has no record of the agent's edits.
- Probe: `src/m035.ts` edited during the wait, then the install. `test/f035.test.ts` ran 36th of 40.
- D5 as amended: "Work an edit caused, a test file whose closure a revision changed, that a revision added or edited ... runs ahead of the baseline". The closures were unknown during the wait, so the code could not tell. The spec does not say what happens to those revisions at the install.
- When the install's lockfile differs from every validated worktree's, the agent's new test waits behind the whole suite. That is lesson 19's original 17:00-to-17:23 delay.

**Fix.**

- `#baseline` after a wait settles with `changed` = the paths of the revisions recorded since `startWaiting`. They are in `store.revisions.range`, or the scheduler can collect them in a set during the wait.
- So the files whose closure or path they touch are queued recent.
- Test: the probe above, asserting the edited module's file runs in the first tier.

### S3. A bun repository never waits: `bun.lock` is committed (proven)

`src/core/scheduler/install.ts:31`, `src/core/keys/environment.ts:104-114`.

**What happens.**

- `LOCKFILES` lists `bun.lock` and `bun.lockb` at the root, after Vitest's `getLockfileHash`. Bun has no hidden lockfile, and Bun 1.2 projects commit `bun.lock`.
- So `awaitsInstall` is `false` in every fresh bun worktree, and defect 18 reproduces there unchanged: runs against a parent's `node_modules` or none, failures pushed, everything discarded at the install. Probe `bun`: `false` with no `node_modules`.
- Not blocking: the amended D5 defines the wait by D3's installed lockfile, and this is D3's list.

**Fix.**

- In `awaitsInstall`, a `bun.lock`/`bun.lockb` match counts only when `<root>/node_modules` exists.
- Committed `.pnp.cjs` without a Yarn install state is a second case to check: `.yarn/install-state.gz`.
- Leave the environment hash alone.

## Nits

- **N1. The post-install baseline is labelled "at start".** `src/core/delivery/provenance.ts:50` and `format.ts:245` say "Squeal's run at start (baseline)". After a wait, the baseline runs at the install, possibly long after the daemon started. The revision printed is right. Wording: "Squeal's baseline run at revision N".
- **N2. Root manifest with per-package installs.** A root `package.json` that declares dependencies with installs only below the root (probe `mono`) waits for good. The header then says "No dependencies are installed in this worktree", which is false for `packages/a`. The spec chose the root (D5, and a test asserts it). "...at this worktree's root" would keep the sentence true.
- **N3. No bound on starvation.** With 4 or more recent files queued at every tier boundary, for example repeated edits to a module many tests import, the backlog does not run. Within the recent group, a never-run file the agent wrote sorts after every recent direct or transitive file (D5's classes), so repeated barrel edits can starve it too. States stay `pending`, so nothing is falsely current. A bound, such as one backlog file per tier after N recent-only tiers, is a policy question for the coordinator. Record it in D5 if accepted as is.
- **N4. D9's PreToolUse paragraph was split mid-sentence** (`spec.md:140`). "... nothing denies (`lessons.md`, defect 17), phrased as facts plus one sentence stating that the edit was not applied" now attaches "phrased as facts" to the wrong clause. Move the inserted sentences after "can be re-issued."
- **N5. A daemon killed while waiting leaves `awaiting-install` `true`.** `close()` clears it; a SIGKILL does not. Until the next daemon starts, the header says it waits for an install even after one. The liveness sentence already says no daemon runs, so this is minor. Clearing the key in the next daemon's `scan`, before `awaitsInstall`, would make it exact.

## What fits (do not re-check)

**Install wait.**

- No runner call of any kind while waiting: `environment`, `testFiles`, `closure`, `invalidate`, `affected` (scheduler test), and no Vitest import (daemon test, `daemon.ts:285`).
- Revisions during the wait are committed with `refined` = their number, so no header shows a runner part pending.
- One note, not repeated across restarts.
- The meta key is the single source, read by `readHeader`. The header sentence replaces D6's install sentences.
- An idle pass every 30 s (`reconcileIntervalMs`, `change-feed.ts:207`) emits an empty `interval` batch, so the wait ends without an edit. `reconcileBatch` looks for the lockfile on non-`watch` batches.
- The `node:test` case: a manifest with no dependencies, empty fields, a missing manifest or broken JSON validates as before.
- The wait-ending batch calls `#pump` after the baseline: the `return` exits only the lock callback.

**Recent first.**

- `recent` is sticky through `add`. A discard after an edit keeps it, because `settle` re-queued the file recent before `discard` runs.
- Environment inputs are in no closure, so an install or config edit does not mark files recent.
- Measured: 5th of 200, before 195.

**Delta reading.**

- Told and untold crash cases, registration before or after the pass, inherited passes before or after registration, fail-crash-fail (first-seen, no deny), `fail-changed` after the crash: all covered by `test/harness/pre-tool-use.test.ts` and `test/delivery/delivery.test.ts`.
- Unrecorded steps between a `pass -> unknown` and an `unknown -> fail` can only be `unknown`, `pass` or `skip`, never `fail`, so the label is right.

**Codex.**

- `src/harness/codex/handlers.ts:51` calls the shared `denyOnRegression` for `apply_patch`.
- Both `pre-tool-use.mjs` bundles carry `DENIED_KINDS` with `pass-to-fail` only. No bundle still peeks `first-seen-fail`.
- The two policy references are identical.
- The Codex deny tests produce a pass first, so they exercise `pass-to-fail`.

**Build.** It reproduces byte for byte. Version 0.1.17 in `package.json` and both plugin manifests.

## Inputs for the next wave

**Fix wave 11.5: one worker, `src/core/scheduler/` and `src/core/state/header.ts`.**

- B1 first, then S2 (both in the wait path).
- S1 needs the coordinator's call on the D5 "not covered" sentence before a worker takes it. It touches the same `handleBatch` branch, so give it to the same worker if accepted.
- S3 is a few lines in `install.ts` with a probe-style unit test. Same worker.
- The test budget stays as in 001-100: the scheduler harness, tier size 4. The B1 test needs no runner.

**003-16 (adapter assembly), still planned.**

- While waiting, `runner.invalidate` is never called for the revisions recorded. An adapter created before the wait would miss files added during it, as the harness shows.
- The Vitest runner is safe only because the daemon creates it after the install.
- A `node:test` adapter must either start after the install the same way (`daemon.ts:285` gates only `vitestRunner.open()`) or re-list and rebuild its graph on its first call after a wait.
- `awaitsInstall` is root-only and runner-agnostic, so a `node:test` project in a root that declares dependencies waits with the Vitest suite. D5 says so.

**Still open.**

- No Codex test asserts that a first-seen failure does not deny. The shared module is covered through the Claude Code tests only. One case in `test/harness/codex/turns.test.ts` would pin it.
- Defect 20 (two full suites per fresh worktree) waits on the human's decision on `research/per-package-keys.md`.
