# 001-386: repair of review 001-384 (0.1.179's pool and user config)

Worker notes, 2026-10-15. First round on `reviews/wave-13bo.md`; spec 001 D11 Capacity, 004 D2 as amended 2026-10-14. 004-60 has its own notes (`docs/specifications/004-slow-suites/tasks/004-60/notes.md`) and its own commit.

## B1: a lease keeps its tier's demand apart from its grant

- **Cause.** `startTier` calls `lease.shrinkTo(files.length)` on every backlog tier. `shrinkTo` re-published the mark with `want = grant`. So a waiter running a 200-file tier on its free worker advertised `want 1`. At the next boundary its share and its waiter reserve were computed from 1.
- **Fix** (`src/core/capacity/pool.ts`). Each `Lease` has a `want`: the files its tier asked for, then the files that start (`shrinkTo`). The mark publishes `want` = the sum over held leases of `max(want, grant)`, plus the new tier's request. `grant` stays what is held. `entitled` and the project check still subtract what is held, not what is wanted.
- **Regressions** (`test/capacity/pool.test.ts`). Every tier now goes through `acquire` + `shrinkTo` (`tier()`), as the scheduler starts one.
  - Probe 1 is "fair share across daemons", now with `b`'s mark checked at `{ want: 200, grant: 1 }`. The grants are 8, 1, 4, 4.
  - Probe 2 is "the longest waiter is served first", both ways round: the younger waiter gets 1 and the older 3.
  - New: "a lane's release leaves the other lane's demand in the mark". Two lanes want 3 and 50; the mark reads `{53, 8}`, then `{50, 5}` after lane one goes, and a newcomer gets 3.
  - Against the old `pool.ts`, four tests fail: probe 1 (`want 1` for 200), "slots one daemon cannot use" (4 for 3), probe 2 (3 for 1) and the lane test.

## B2: a mark that cannot be written strands nothing

- **`acquire`.** If the mark write fails after permits were taken, the lease is removed, its permits close, `#since` and `#mark` are restored, and the error is rethrown. `TierCapacity.take` then returns `null`: the tier runs ungranted with the one note, as on any pool failure.
- **`shrinkTo` and `release`.** These never throw. `#republish` swallows a failed write; `#mark` is set before the write, so the 10 s refresh writes it again while a lease is held.
- **`selectTier`.** `startTier` now runs in a `try/finally` that releases the lease when no tier comes back, a throw included. Once the tier exists, `#fly`'s `finally` and `endTier` own the release, as before.
- **Regressions** (`test/capacity/pool-failure.test.ts`). The daemon's `pool.mark.<hash>.tmp` is made a directory, so the error is EISDIR, as in the review.
  - **At acquisition.** The tier gets `null` twice with one note. Another daemon then takes the only permit. Once the obstruction goes, the next tier gets 2.
  - **At shrink and release.** Neither throws, and the permit's lock file is free afterwards (`takePermit` succeeds).
  - **While another lane holds.** Lane two's failure frees the permit it took. Lane one releases normally. After recovery the daemon gets 2, and after `close` a competitor gets 2.
  - All three fail on the old pool: the leaked permit, the EISDIR thrown from `shrinkTo`, the leaked permit again.
  - The permit checks look at the lock file, not a competitor's grant: a competitor reading the daemon's last good mark takes its fair share (1), and that is not a leak.

## B3: the repository root from Git's layout

- **Cause.** `repositoryRootOf(commonDir)` returned `dirname` only when the common dir's basename was `.git`.
- **Fix.** `repositoryRootOf(root, commonDir)` (`src/core/daemon/user-config.ts`) resolves the root in this order:
  - **The daemon's own root,** when its git dir is the common dir. That covers an ordinary main worktree, a `--separate-git-dir` repository and a submodule's checkout.
  - **For a linked worktree,** the first of the common dir's `core.worktree` (a submodule's) and its parent whose git dir is the common dir.
  - **Otherwise the common dir.** Git records no main worktree for a bare repository, or for a linked worktree of a `--separate-git-dir` repository. There, `git worktree list` itself names the metadata directory as the main worktree (probed with git's user and system config disabled).
- **`daemon.ts`** computes the root once (`#repositoryRoot`) and uses it for the `capacity.projects` lookup and the pool mark's `project.id`.
- **Regressions:**
  - `test/daemon/repository-root.test.ts` uses real repositories: a `--separate-git-dir` one (its root, and the entry for that root caps it), its linked worktree (the metadata dir), a submodule from its checkout and from a linked worktree of it, and a bare-backed worktree. The ordinary main and linked worktrees stay in `user-config.test.ts`.
  - `test/integration/capacity-project.test.ts`, the daemon wiring. A real daemon runs from the sources on a `--separate-git-dir` repository, with `hostSlots 8` and `projects[root].slots 2`. Four node:test files hold until released. The pool mark reads `{ want: 4, grant: 2, project: { id: root, slots: 2 } }`. With the old basename rule it reads `grant: 4` and no project (red, then green).
- **Limit.** A linked worktree of a `--separate-git-dir` repository is named by its metadata directory, and its main worktree by its root. The two daemons cap apart unless the user also lists the metadata directory. Git holds no back-pointer from the metadata to the main worktree, so nothing more is possible without a record of our own. Proposed D11 parenthesis: "(the main worktree's root, which every linked worktree shares; for a bare repository, and for a linked worktree of a `--separate-git-dir` repository, whose main worktree Git does not record, the Git directory)".

## N1

The comments on `capacityReader` and `Daemon.#capacity` now say what runs: the reader re-reads at each call, the daemon calls it at start and sizes the pool from that reading, and an edit applies to daemons started afterwards (D11 as amended). The 001-377 notes still describe re-reading at each tier boundary, which is no longer true; this note supersedes them.

## S1: slow tiers take their workers from the pool (the human's ruling)

`SlowTier.#select` (`src/core/scheduler/slow-tier.ts`) takes a lease after picking and before `startTier`'s claims, as `selectTier` does:

- **Want.** `files × slow.maxWorkers`. The tier keeps `max(1, floor(grant / slow.maxWorkers))` files. The lease is wrapped by `perFileLease` (`src/core/scheduler/capacity.ts`), so `startTier`'s `shrinkTo(files)` keeps `files × slow.maxWorkers`.
- **No grant** (`WAIT_FOR_CAPACITY`: another lane of this daemon has the free worker and no permit is free). Without a `run --slow` request the tier does not start: the slot is returned, the activity says `waiting for slot`, and the other tier's end or the recheck pumps again. With a request open it runs at once without a grant, as an edit's tier does. This is the decision the ruling left open. "Runs at once" (004-59, 004-60) would otherwise wait up to one backlog tier (300 s) for its own daemon's baseline.
- **Pool failure** (`null`). The tier runs ungranted with the one note.
- **Unchanged.** The slow lane keeps its own `slow.lock` / `slow.<i>.lock` permits (`slow.maxParallel`), in `slowSlotDir()` of `process.env` or `SlowTierOptions.slotDir`. The pool stays in the daemon's `slowSlotDir(env)`. A nested test daemon with a temporary `XDG_RUNTIME_DIR` therefore keeps both apart from the user's (004-16).
- **`RunOptions.workers`** on a slow tier is its whole grant, at most `files × slow.maxWorkers`. **For 001-378**: the slow Vitest instance's width per file is `slow.maxWorkers`, and the grant only bounds the files. An adapter that sizes a slow run from `workers` must divide by the file count.
- **Regressions** (`test/scheduler/slow-pool.test.ts`):
  - On a free host every slow run carries `workers = 2 × files`.
  - While another daemon holds the whole pool, the three slow files run one per tier on the free worker, `workers` 1. Without the pool the idle tier would take all three at once.
  - Both fail with the slow lease removed (`workers` undefined, widths `[1, 2]`).
  - The request path, ungranted, is in `slow-backlog.test.ts` (004-60).
- **Proposed D11 wording** for the Capacity bullet: "Backlog and checkpoint tiers of every lane, the slow lane's included (`slow.maxWorkers` per slow file, and as many slow files as the grant holds), take permits from one per-user pool …; an open `squeal run --slow` request that finds no permit runs without one, as an edit's tier does (task 001-386)."

## node-test-packages: the failure explained

- **Symptom.** `test/integration/node-test-packages.test.ts` failed main CI on Node 22 at e28f60f9. All three REACHING files appeared once in the runs after the bump: no re-run row at all.
- **The failure predates the pool.** It was seen in 005's 0.1.159 gate (005-46, filed as 001-363, still planned) and in the 0.1.178 candidate's loaded gate, and 0.1.178 has no pool (it arrived in 8a1e8344, 0.1.179).
- **Cause: the test's settle condition.** A 001-171 re-run is queued (`queueReruns`, priority `NOTHING_CHANGED`) after the fail tier's record. Its file's checks are then `current` FAIL. Status counts come from known states (`src/core/status/snapshot.ts`, `breakdown`), so between the fail's record and the re-run's `startTier` status shows 0 pending, every check current and failures present. That is exactly what `settle` accepts, and the test then read `runs()` before the re-run's row existed.
- **Measured here** (load 60 to 70, 5 runs with timings written to a file):
  - The re-run's row starts 21 to 62 ms after the fail run's end.
  - In one run the settle accepted 3 ms before the re-run's row existed, in another 5 ms after.
  - At the test's 150 ms poll that is a sizable hit rate on a loaded host. CI passes mostly on timing.
- **The pool's share.** It widens the window but did not create it. The re-run tier is a backlog tier, so its boundary does a release (mark cleared) and an acquire (private-dir check, marks read, permit locks opened, mark written). A tier's acquire, shrink and release took a median 12.7 ms (p95 27 to 30 ms, max 48 ms) on this host at hostSlots 3 and 23. That makes the failure more likely from 0.1.179 on. On a 4-vCPU runner (hostSlots 3) a single lane never waits on the pool, so there is no `WAIT_FOR_CAPACITY` delay in this test.
- **Fix: the test, not the product.** The bump's settle now also requires the re-runs' rows: at least `2 × REACHING` files in the runs since the bump, every one ended. The exact-equality assertion then reads the same rows. It passed 5 of 5 under load 71 (`npx vitest run test/integration/node-test-packages.test.ts`, each run separate).
- **Not changed, for the coordinator.** While a re-run is queued, status and the full-suite checkpoint show the file's FAIL as current and nothing pending. That is D6's "reported at once", but a `run --all --wait` verdict can name a FAIL that the queued re-run turns to `FAIL -> PASS` a moment later. Making a queued re-run visible as pending would change status's counting (D7). It is a product decision and was left alone. 001-363 can close on this explanation, or take that question.

## Type changes (all additive or internal)

- `repositoryRootOf(commonDir)` became `repositoryRootOf(root, commonDir)`. It is exported, with no other caller than the daemon and tests.
- New `perFileLease(lease, perFile): PoolLease` in `src/core/scheduler/capacity.ts`.
- `SlowTier.#select` may return `WAIT_FOR_CAPACITY` (private).
- `Lease.want` is private to the pool. `PoolLease` itself is unchanged; its doc comment now says shrink and release never throw.

## For integration

- Bundles: `plugins/claude-code/dist` and the Codex, Pi and OpenCode bundles drift from the source (their four tests fail), as the brief expects.
- Key format: `test/keys/key-format.test.ts` asks for a re-pin of format 10's guarded-sources hash, because `src/core/daemon/*` and `src/core/scheduler/*` changed. That is three tests. No key's meaning changed.
- Squeal flagged `test/daemon/vacant-wait.test.ts` "a vacant waiter reads again and exits as a loser" as flaky (PASS → FAIL → PASS → FAIL at the same inputs) while the host load was 60 to 70. Its daemon start goes through `repositoryRootOf`, which now reads a `.git` entry and possibly the common dir's `config`, a few synchronous file reads. See the final message for its isolated runs.
