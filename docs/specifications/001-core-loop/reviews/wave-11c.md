# Review: wave 11c, 001-107 (task 001-108)

Reviewer task 001-108 for spec 001, 2026-10-07. This is a re-review bounded by `reviews/wave-11.md`. In scope:

- 001-107: `9e8423f`, `d1a2686`, `9080934`, `2ab9d82`, `cf00d9a`, `72e48b9`. The brief's `9e9219e` is the pre-rebase sha of `72e48b9`; the commit message says it was cherry-picked from it.
- The rebuild `c61a98e` (0.1.20).

The 001-105 commits between them are out of scope. They count only where they change what 001-107 does.

The repair as built:

- **`run --all` while waiting.** It records a checkpoint that is `abandoned` at once (`Checkpoints.abandon`). `readHeader` counts no checkpoint as a listing or a full suite while `awaiting-install` holds.
- **What counts as installed.** `missingInstall` decides it. `bun.lock` counts only beside `node_modules`, and `.pnp.cjs` only beside `.yarn/install-state.gz`. With no install at the root, the root counts as installed once every workspace that declares dependencies has its own install. The meta value names the missing workspaces.
- **The wait under a running daemon.** It starts on a revision that touches an installed lockfile or `package.json`, and on the check before each tier (`InstallStamps`). A tier whose install stamp moved during its run stores nothing.
- **Edits during the wait.** Paths changed during the wait reach the baseline as `changed`.
- **Starvation bound.** After 4 recent-only tiers, the next tier takes backlog first.
- **Baseline wording.** The baseline names its revision.
- **Stale flag.** The next daemon clears a killed daemon's flag. A header with no live daemon does not show the wait sentence.

## Verdict

**FAIL at `fc2bbbd`.** Counts: 2 blockers, 1 should-fix, 4 nits.

| `wave-11.md` | Now |
| --- | --- |
| B1 `run --all` while waiting | **Closed.** Scheduler test, plus a real daemon: `squeal run --all --wait` prints `abandoned` and exits 1. |
| S1 `npm ci` under a running daemon | **Closed for an install alone.** Four `npm ci` rounds overlapping forced tiers stored no failure and recorded no `PASS -> FAIL`. **Reopened by B1 and B2 below** when anything is edited during the wait. |
| S2 wait edits run first | **Closed for ordering.** In a wait that started under an open runner, the edited file runs with stale code (B2). |
| S3 bun and Yarn PnP | **Closed.** |
| N1 to N5 | **Closed.** N2 has one gap (S1 below). |

- **Can any header, status or delivery show a state that is not current?** Yes, through B2.
  - After a wait that started under a running daemon, the Vitest instance never learns what changed during the wait.
  - A test of an edited module runs against the old transform. Its pass is stored as current under the new key.
- **Does the daemon still work?** Not after an edit during such a wait (B1). It spins at 100% CPU and its heartbeat stops. The install that follows never ends the wait.

## Verification

HEAD is `fc2bbbd`, two docs commits past the rebuild. `git diff --stat c61a98e fc2bbbd` touches only `docs/`. Everything below ran at `fc2bbbd`.

```
$ git rev-parse HEAD
fc2bbbd6a146354d05773389ac33b4bbc5734a95
$ npm ci
(ok; install-scripts warnings for @parcel/watcher and esbuild)
$ npm run lint
Checked 476 files in 373ms. No fixes applied.
$ npm run typecheck
tsc --noEmit   (no output, exit 0)
$ npm run build
(exit 0)
$ git status --short
(empty: committed bundles of both plugins match the build)
$ npx vitest run
 Test Files  4 failed | 164 passed (168)
      Tests  4 failed | 1432 passed | 8 skipped (1444)
   Duration  143.70s
   (load average 25 to 38 during the run)
$ npx vitest run test/cli/codex.test.ts test/e2e/worktrees.test.ts test/harness/codex/bundles.test.ts \
    test/runners/node-test/fixtures.test.ts
 Test Files  4 passed (4)
      Tests  59 passed (59)
```

The four failures were timing and load failures:

- a 5 s timeout in `cli/codex`;
- `gen-big` at 2083 ms against a 2000 ms limit;
- an `ENOTEMPTY` temp cleanup in `codex/bundles`;
- a liveness title "a daemon is validating again" in `e2e/worktrees`.

All four pass in isolation, so they are unverified and not findings. Version 0.1.20 is in `package.json`, `plugins/claude-code/package.json` and both plugin manifests.

Probes were throwaway `zz-r11c-probe-*.test.ts` files in `test/scheduler/` and `test/daemon/`, plus `/tmp/r11c/ws.mts`. All were deleted before commit.

| Probe | Result |
| --- | --- |
| wave-11 B1, real daemon, fresh worktree under `/tmp` | `run --all --wait`: `0 test files`, `abandoned`, exit 1. Status: "Full-suite checkpoint: none completed at any revision". |
| `npm ci --offline` ×4 under a real daemon, forced `run --all` in flight. The fixture is inside the repository, so tests resolve Vitest from it; `dep` is a `file:` package; 8 test files import it and sleep 400 ms. | Tiers overlapped each `npm ci` (for example, run 303307 to 303929 ms against `npm ci` at 303682 ms). One round entered the wait (`awaitingInstall: true`, 25 unknown) and left it. `results` with `fail`: 0. Transitions into `fail`: none. 25 `pass -> unknown`. Checkpoints overlapped by an install ended `abandoned`; the last `run-all` ended `completed`. No `PASS -> FAIL`, so nothing to deny. The revision stayed 0 because the restored hidden lockfile hashes the same; the stamp caught the overlap. |
| As above, with one edit to `src/math.ts` during the wait (B1) | Daemon at 99.9% CPU. Heartbeat frozen: `heartbeatAt` unchanged over 100 s. `npm ci` finished, and the wait had not ended 90 s later. Header: `awaitingInstall: true`, `pending: 2`. SIGTERM did not stop it within the 10 s hook. The control without the edit ended the wait in seconds, with the heartbeat moving and 3.5% CPU. |
| Scheduler harness: wait, edit `src/math.ts` to `a - b`, restore the install, one batch with the edit and the lockfile (B2) | `test/math.test.ts > adds` reports **pass**, stored current: header 11 current, 0 unknown. `runner.invalidate` calls: `[]`. Control, the same edit with no wait: `fail`. |
| Starvation bound: 12 files importing `src/shared.ts`, 24 backlog files, forced `run --all`, one edit per tier for 40 tiers | Every second-group tier came after 4 recent-only tiers (`- - - - T` throughout, from `RunQueue.tierSelected`), and all 24 backlog files ran. Some fifth tiers took discard re-queues, which D5 puts in the second group. |
| `missingInstall` on layouts | `bun.lock` only: waits. `bun.lock` with an empty `node_modules`: installed (N3). pnpm with `pnpm-lock.yaml` only: waits; with `node_modules/.pnpm/lock.yaml`: installed. Yarn zero-install (`.pnp.cjs` and `.yarn/cache`, no install state): waits (N2). Root installed, workspace not: installed. Root's own `devDependencies` not installed, every declaring workspace installed: installed (N4). |
| Workspaces, partial installs | Two installed workspaces, then `packages/a/node_modules` removed. `missingInstall` returns `{"workspaces":["packages/a"]}`, but `InstallStamps.check()` returns `null` (S1). |
| SIGKILL during the wait, real daemon | The flag stays `true`. Status right after still reads "Daemon: running, last heartbeat 3 s ago": the heartbeat is not yet stale. Install while down, then a new daemon: meta `false`, baseline done, 9 current, `awaitingInstall` absent. |

## Blockers

### B1. An edit during a wait under a running daemon wedges it (proven)

`src/core/scheduler/scheduler.ts:262`, `:296`, `:302`; `src/core/scheduler/install.ts:121-130`, `:159`.

**What happens.**

1. The wait starts under a running daemon (`#wait`). `startWaiting` clears the queue and `ledger.files`, then re-adds the listed files. The worktree's key index (`context.keys.index`) still holds every closure.
2. An edit during the wait goes through `reconcileWaiting`, then `reconcileBatch`, `rekeyContent` and `Ledger.settle`. `keys.index.key(ref)` returns a key that has no result, so `settle` enqueues the file.
3. `handleBatch` calls `#pump`. The loop breaks at `:262` (`this.#awaitingInstall`). Its `finally` at `:296` re-arms `#pump`, because `#hasWork()` sees the queue.
4. This repeats forever. Timers starve: no heartbeat, and no 30 s reconciliation pass, so the install never ends the wait.
5. The header meanwhile counts the queued files `pending` while saying nothing runs until an install.

**What breaks.**

- D5 as amended: "Every reconciliation pass looks for the installed lockfile again ... the pass that finds it runs the baseline".
- D10: the heartbeat. Hooks see the daemon down, and a respawn loses the lock to the wedged process.
- The wave-11 S1 outcome. The real-daemon probe and its control are in the table above. In the scheduler harness the Vitest worker spun at 96% CPU for 15 minutes and ignored its parent's exit.

**Failure scenario.** A validated worktree. The agent runs `npm ci` in the background, or a parallel session runs it, and keeps editing. Squeal stops validating that worktree until someone kills the daemon.

**Fix (one worker, `src/core/scheduler/`).**

- While waiting, queue nothing. For example, `reconcileWaiting` settles with `queueMisses: false`, or `startWaiting` drops the keys `settle` reads.
- `#hasWork()` returns `false` while `#awaitingInstall`, so the pump can never re-arm into a wait.
- Test in `test/scheduler/reinstall.test.ts`:
  - start the wait with the lockfile batch;
  - `h.batch("src/math.ts")` after an edit;
  - assert that `h.scheduler.idle()` resolves and the header shows `pending: 0` with `awaitingInstall: true`;
  - restore the install with an `interval` batch, and assert the wait ends.

### B2. After a wait that started under a running daemon, the runner never learns what changed: a stale pass is stored as current (proven)

`src/core/scheduler/scheduler.ts:142`, `:149-156`, `:165`; `src/core/scheduler/runner-work.ts:70`; `src/core/scheduler/install.ts:159`.

**What happens.**

- The batch that starts the wait returns before `queueRefine`. `dropRefinements` drops runner parts already queued, and with them their `invalidate` calls.
- `reconcileWaiting` never queues a runner part.
- `#baseline` passes `#waitChanges` to the ledger for ordering only.
- So no path changed during the wait, or just before it, reaches `runner.invalidate`. The installed lockfile's removal and return never reach it either. Before 001-107, those went through `invalidate` and recreated the instance (D5: "The instance is also recreated when an installed lockfile (D3) appears, changes or disappears").
- The Vitest instance keeps its transformed modules: `watch: false`, and only `invalidateFile` drops them.

**Probe.**

1. Validated scheduler harness with the real Vitest adapter.
2. `node_modules` removed and the lockfile batched, so the daemon waits.
3. `src/math.ts` becomes `a - b`.
4. The install is restored, and one batch with the edit and the lockfile ends the wait.
5. The baseline re-runs `test/math.test.ts`: `adds` is **pass**, stored current, with `invalidate` never called. The same edit without a wait gives `fail`.

**What breaks.**

- The vision: "An old result never gets to pose as the current truth."
- D5: a key stands for the contents its result ran against.
- When `npm ci` changes versions, D5's recreate after an install no longer happens either. The old config plugins and inlined dependencies stay in use.

**Reachable without B1.**

- An edit that a tier still in flight had not refined when the install went: `dropRefinements` drops it.
- An edit that arrives in the same batch as the returning lockfile.
- Once B1 is fixed by not queueing, every edit during the wait.

**Fix (same worker).**

- When a wait that started under an open runner ends, call `runner.invalidate` before the baseline. Pass every path recorded during the wait and every path of the dropped runner parts (have `dropRefinements` hand them to `#waitChanges`), plus the installed lockfile path, so the adapter recreates the instance.
- Recreating the instance always at the end of such a wait is the simpler equivalent.
- Test: the probe above, asserting `fail`, and asserting that `invalidate` received `src/math.ts` or the instance was recreated.

## Should-fix

### S1. A reinstall inside a workspace is not seen (proven for the check; the `PASS -> FAIL` that follows is plausible)

`src/core/scheduler/install-stamp.ts:39`, `:47-52`.

**What happens.**

- 001-107 now validates a root with no install of its own whose workspaces each have one (wave-11 N2).
- The stamp covers only the root: its `node_modules` names, `package.json`, and the root's lockfile, which is `null` here. So `check()` returns the cached `missing: null` after `packages/a/node_modules` is removed, while `missingInstall` names `packages/a`.
- `handleBatch`'s `touchesInstall` matches `packages/a/node_modules/.package-lock.json`, but `check()` answers from the cache.
- `installMoved` compares the same root stamp.
- So `npm ci` inside a workspace runs that workspace's files without their packages. In a real install, that stores the failures and pushes them as `PASS -> FAIL` (wave 11 S1), which deny.

**Fix.**

- When the root has no install, add each declaring workspace's lockfile stat and `node_modules` names to the stamp.
- Or let `handleBatch` call `missingInstall` directly, uncached, when a revision touches any installed lockfile.
- Test: the workspace layout of `install-wait.test.ts` N2, then `rm -rf packages/a/node_modules`. Expect `check().missing` to be `{ workspaces: ["packages/a"] }`.

## Nits

- **N1. Orphaned docblock.** `queueFullSuite`'s docblock now sits above `abandonFullSuite`'s (`src/core/scheduler/tiers.ts:217-229`). Move `abandonFullSuite` and its comment above the D5 quote.
- **N2. Yarn zero-install waits for good (plausible).** `.pnp.cjs` and `.yarn/cache` are committed, and `.yarn/install-state.gz` is never committed. So a zero-install worktree waits until someone runs an install it does not need, and the header says "No dependencies are installed". Whether Squeal's daemon can load Vitest under PnP at all is untested. Record the case in D5 or leave it.
- **N3. bun with an emptied `node_modules`.** `bun.lock` plus an empty `node_modules` directory counts as installed (`isDirectory`), for example after `rm -rf node_modules/*` or an interrupted `bun install`. The stamp's `-` entry, which ignores dot entries, already treats empty as missing. `installedIn` could use the same test.
- **N4. The root's own dependencies.** When every declaring workspace has an install and the root has none, the root's own `devDependencies` (often `vitest`) are not installed and nothing waits. D5 chose this explicitly. No header says it.

## What fits (do not re-check)

**Wave-11 B1.**

- `abandonFullSuite` runs under the lock in both branches of `requestFullSuite`.
- The header's `atCurrentRevision` and `testFilesListed` ignore checkpoints while the wait holds.
- The CLI prints `abandoned` and exits 1.

**Wave-11 S1, the install alone.**

- The stamp's dot-entry rule holds against `.vite`.
- A restored identical install is caught by inode and mtime. 001-105's hash of the restored lockfile does not move.
- `installMoved` re-queues keep `forced`.
- `#requeue` and `recordTier` skip files a wait replaced (`ledger.files.get(id) !== file`).
- `startWaiting` abandons the open checkpoint.

**Wave-11 S2.** The baseline after a wait in a fresh worktree queues the edited module's test file in the first tier (`install-wait.test.ts`). The runner opens only after the install there, so B2 does not apply.

**Wave-11 S3.** Proven on bun, Yarn PnP and pnpm layouts. `yarn.lock`, `pnpm-lock.yaml` and `package-lock.json` were never on D3's list.

**N1 to N5.**

- N1: the wording is in the delivery bundles of both plugins, and nothing in `src` or `dist` still says "at start (baseline)".
- N2: the missing workspaces show as `a, b, c and N more`.
- N3: the bound holds by D5's groups.
- N4: D9's paragraph reads correctly.
- N5: tested both in the scheduler and on a real daemon after SIGKILL.

**Build.** It reproduces byte for byte.

## Inputs for the next wave

**One worker, `src/core/scheduler/` (`scheduler.ts`, `install.ts`, `runner-work.ts`, `install-stamp.ts`).**

- B1 first. B2's test needs two batches during the wait, which only work once the pump cannot spin.
- Then B2: invalidate or recreate at the end of a wait under an open runner.
- Then S1, in the same files.
- Test budget: the scheduler harness in `test/scheduler/reinstall.test.ts`, tier size 2, each new case under 5 s. No daemon test is needed. A daemon case for B1 would take about 30 s; add one only if the coordinator wants the heartbeat asserted.
- `#waitChanges` must also collect the paths of the runner parts `dropRefinements` discards. Otherwise B2 stays open for an edit made just before the install went.

**Still open from wave 11.**

- No Codex test asserts that a first-seen failure does not deny.
- `runner.invalidate` during a wait matters to 003-16 as well. A `node:test` adapter created before a wait would miss its revisions, the same way B2 shows for Vitest.
