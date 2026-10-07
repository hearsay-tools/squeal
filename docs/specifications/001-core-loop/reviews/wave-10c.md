# Review: wave 10, 001-94 re-review and 001-90 first review (task 001-95)

Reviewer task 001-95 for spec 001, 2026-10-07. Two sections.

1. **001-94**, range `b787492..192c187`: the attribution repairs (`894bc12` to `48c33e6`) and the dist rebuild `192c187` (0.1.12). I read them against `reviews/wave-10b.md` B1, B2, S1 and S2, the 001-94 brief, and D6 as amended. This is the second and last round on the 001-91 slice, so its blocker goes to the human.
2. **001-90**, `squeal remove`, first review. The brief names `38f85eb` and `109cb33`. Those are the worker's commits and are not on `main`. They landed as cherry-picks `a71005d` and `5cf4f2f` with byte-identical patches (`diff` of `git show` output is empty), and no later commit touches `src/cli/remove.ts`, `src/cli/main.ts` or `test/cli/remove.test.ts`. I reviewed the landed commits.

## Verdict

**FAIL at `192c187`.** Counts: 1 blocker, 3 should-fix, 7 nits.

- **001-94: B1, S1 and S2 are closed. B2 is closed on the path `wave-10b.md` named, and open on a second path.**
  - **The new blocker (B1).** A consumer that stays registered while its daemon goes away (reboot, crash, `squeal stop`) keeps its registration revision. The new daemon's `start` revision then counts as the agent's changes. This is the defect B2 described, reached through a daemon restart instead of a spawn at SessionStart. It contradicts D6's new sentence that the `start` revision "is never the agent's".
  - **Spawned sessions on real repositories get no attribution (S1).** I measured two real repositories. The bootstrap marker lands 1.4 s (squeal) and 8.5 to 10.8 s (cezar) after spawn. So every session that spawned its daemon got no registration revision: 0 of 19 runs. The marker is written after the Vitest listing, closure resolution and the watcher start, but B2 needs only the `start` revision. That revision lands 377 to 539 ms after spawn.
  - **Latency.** The B2 wait raises SessionStart's spawn path from 131 to 184 ms (0.1.11) to 809 to 889 ms on both real repositories, because the wait always runs out. On the 5-file fixture it is 382 to 488 ms. Without a spawn, SessionStart is 71 ms p95 at load 0.41, unchanged.
- **001-90: no blocker.**
  - **What holds.** It stops every recorded daemon and deletes nothing while a lock is held. A worktree whose root is gone is handled. Concurrent store writers neither crash it nor bring the store back. Nothing outside `<common-dir>/squeal/` and this repository's temp keys was deleted in any probe.
  - **`EACCES` mid-removal (S2).** If any temp directory cannot be removed (a read-only subdirectory a test left, or one inside another user's `/tmp/squeal-<uid>`), the command throws after the store is already gone. It prints nothing and exits 1, and the commands reference says exit 1 means nothing was deleted.
  - **`--config` in a linked worktree (S3).** It deletes only that worktree's committed copy. It does not say that the main checkout's config remains and will start Squeal again.

## Verification

HEAD is `ecb1acf`, one commit past the 001-94 candidate. That commit changes only `docs/board.md` and `tasks/wave-10.md`, so the code is the candidate's. I ran everything at `ecb1acf`.

```
$ git rev-parse HEAD
ecb1acfabc58319a7c9f806a2794634e366f2682
$ git diff --stat 192c187 HEAD -- . ':!docs'
(empty)
$ npm ci
added 50 packages, and audited 51 packages in 1s ... found 0 vulnerabilities (exit 0; install-scripts warnings for @parcel/watcher and esbuild)
$ npm run lint
Checked 373 files in 99ms. No fixes applied.
$ npm run typecheck
tsc --noEmit   (no output, exit 0)
$ npm run build
(exit 0)
$ git status --porcelain
(empty: committed bundles match the build)
$ npx vitest run          (load average 6.4 at start, 9.7 at end, 24 cores)
 Test Files  134 passed (134)
      Tests  1023 passed | 7 skipped (1030)
   Duration  47.15s
$ npx vitest run test/harness/latency.test.ts     (load 0.41)
 session-start 64 p50 / 71 p95 / 74 max; post-tool-batch 50/65/68; pre-tool-use 45/48/50;
 pre-tool-use (Bash, silent) 40/41/42; stop 58/61/61; stop (silent) 59/73/80;
 user-prompt-submit 52/55/56; user-prompt-submit (silent) 48/53/55; session-end 40/42/42; waiter 35/37/38
```

The probes ran in these throwaway files, deleted before the commit: `test/delivery/probe95.test.ts`, `test/harness/probe95-restart.test.ts` and `test/cli/probe95-remove.test.ts`. The measurements used a script outside the repository, run against the committed bundles in `plugins/claude-code/dist` and against the 0.1.11 bundles from `git archive b787492`. The clones were deleted afterwards, and no daemon was left running.

### Measurements (001-94)

Three repositories, each a local clone with a hardlinked `node_modules`:

- **fix**: 7 tracked files, 2 test files.
- **squeal**: this repository, 695 tracked files, 156 test files.
- **cezar**: `~/projects/cezar`, 2,272 tracked files, 685 test files. It uses Squeal day to day.

Load was 0.5 to 2.6 throughout. Each run:

1. Starts with no daemon.
2. Runs the bundled `session-start.mjs` with `source: startup` and a new session id.
3. Polls the store for the `start` revision and the bootstrap marker while the hook runs.
4. Checks whether the hook recorded a registration revision.
5. Stops the daemon.

The warm rows reuse the store, as when a daemon idled out overnight. The edit rows also append a newline to `package.json` before each spawn, so the start scan has something to record.

| Repository | Bundle | Store | Runs | SessionStart ms | `start` revision ms | Marker ms | Registration recorded |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fix | 0.1.11 | warm | 5 | 131 to 170 | n/a | n/a | 5 of 5 |
| fix | 0.1.12 | warm | 10 | 405 to 425 | n/a | 406 to 425 | 10 of 10 |
| fix | 0.1.12 | edit | 4 | 382 to 488 | at or before marker | 383 to 489 | 4 of 4 |
| squeal | 0.1.11 | warm | 5 | 142 to 184 | n/a | n/a | 5 of 5 |
| squeal | 0.1.12 | warm | 9 (1 more did not spawn) | 809 to 823 | n/a | 1,526 to 1,695 | 0 of 9 |
| squeal | 0.1.12 | edit | 4 | 828 to 874 | 377 to 445 | 1,391 to 1,505 | 0 of 4 |
| cezar | 0.1.11 | warm | 5 | 151 to 178 | n/a | n/a | 5 of 5 |
| cezar | 0.1.12 | warm | 10 | 820 to 837 | n/a | 8,726 to 9,097 | 0 of 10 |
| cezar | 0.1.12 | edit | 6 (1 more did not spawn) | 836 to 889 | 515 to 539 | 8,474 to 10,784 | 0 of 6 |

- **On a store's first daemon** (no `<common-dir>/squeal/` yet), SessionStart does not register (40 to 47 ms). The first UserPromptSubmit or PostToolBatch registers instead. The marker came 454 ms (fix), 2,109 ms (squeal) and 9,263 ms (cezar) after spawn. If that first registration lands before the marker, it records no revision.
- **The answer to the brief's question.** On both real repositories, every session that spawns the daemon gets no attribution for its whole life. A registration without a revision is never filled in later: `register` writes the slot only for a consumer not already registered. This covers:
  - the first session after the daemon idled out (60 minutes with no consumer);
  - every first session in a new worktree, the normal case for a coordinator's workers;
  - every resume after an idle-out.

  Attribution appears only for sessions that start while a bootstrapped daemon already serves the worktree.

## Section 1: 001-94

### Previous findings

| `wave-10b.md` | Now | Evidence |
| --- | --- | --- |
| B1 resume overwrites the registration revision | **closed** | `delivery.ts:194` reads `consumers.get` before `register` and calls `tellRegistered` only when the consumer was not registered. `test/harness/attribution.test.ts` "an edit before SessionStart resume or compact" goes through the real handlers for both sources. |
| B2 a spawning session registers before the `start` revision | **closed for that path, open for a consumer registered across a restart** (B1 below) | `registered.ts` `bootstrapped` requires the marker to equal the live daemon's `startedAt`, and `settle` waits for it. The `registered.test.ts` B2 tests pass. The cost is S1 below. |
| S1 a deleted lockfile labelled an install | **closed** | `readLiveHeader` sets `installedLockfile` only for a newest change with `newHash`. `installSentences` returns at most one sentence. Tests in `attribution.test.ts` "a removed installed lockfile". |
| S2 repository-wide closure | **closed** | `closureFor` uses the stored closure only when this worktree wrote it, or when the writer's current key for the file equals this worktree's. `registered.test.ts` "whose closure a failure is read against (S2)" covers both worktrees. |
| N1 to N5 | closed | Grouping only when it saves lines (`collapse.ts:40`), 50 results for the load, `RevisionRepo.range`, parked registrations, and the `reports.md` sentence. Each has a test. |

### Blockers

#### B1. A consumer registered across a daemon restart counts the new daemon's `start` revision as its changes (proven)

`registered.ts` `changedAfter` counts every revision after `since`, gaps aside, including a `start` revision. B1's fix keeps `since` for as long as the consumer stays registered. When the daemon goes away without the consumer unregistering, the next daemon's start scan records what changed meanwhile, and that revision is read as the agent's. Ways the daemon goes away while the consumer stays registered:

- a reboot, or Claude Code killed (no SessionEnd);
- a daemon crash;
- `squeal stop`.

The parked path (`park` and `back`) handles a consumer that did unregister: the gap `(leftAt, revision]` covers the `start` revision. Only the still-registered path misses it.

Probe, through the real handlers (`test/harness/probe95-restart.test.ts`, deleted):

1. SessionStart `startup` with a bootstrapped daemon (`startedAt` 1).
2. A reboot: no SessionEnd.
3. SessionStart `resume`, whose `ensureDaemon` spawns daemon 99. That daemon appends a `start` revision changing `src/math.ts` (someone's `git pull`) and writes its marker.
4. The test fails at a README-only revision.
5. PostToolBatch delivers:

```
FAIL  src/math.test.ts > math > adds
      PASS -> FAIL, seen by Squeal's run at revision 3
      expected 1 to be 2
      at src/a.ts:3:5
      touches your changes: src/math.ts
```

The same happens at the delivery level without a resume: register, daemon restart with a `start` revision, then failure (`test/delivery/probe95.test.ts`, deleted). The marker does not help, since the consumer is registered and `tellRegistered` is not called.

This breaks D6 as amended: "so the scan's `start` revision, which holds what changed while no daemon ran, is never the agent's". It also breaks the 001-94 outcome: "'touches your changes' names only files the agent's own session changed, or says nothing". Concrete case, the one B1 of `wave-10b.md` was about:

1. The machine reboots mid-session.
2. The user pulls or switches branches.
3. The user runs `claude --resume`.
4. Every failure whose imports include a pulled file says the agent's changes touch it.

**Fix (one worker, `src/core/delivery/registered.ts` and `attribution.ts`):** decision (b) prefers saying nothing over saying something wrong.

- `changedAfter` returns two sets: the paths of non-`start` revisions in the range (gaps left out as now), and the paths of `start` revisions in the range.
- In `attribute`, a failure whose closure holds any `start` path gets neither line.
- Otherwise the lines are as now.

A `start` revision whose paths miss the closure still allows "none of your changes are in its imports", which is true whoever made them. Amend the D6 sentence to say so.

Tests:

- The probe above, through `sessionStart` `resume`: neither line.
- The same restart without a resume: neither line.
- A `start` revision changing only a path outside the closure: "none of your changes".

### Should-fix

#### S1. The bootstrap marker comes seconds after the `start` revision, so no spawned session on a real repository gets attribution (proven, measured)

`daemon.ts:277` writes the marker after `loop.start()`, which awaits:

- `scheduler.start()`: the `keys.bootstrap` start revision, then the Vitest `testFiles` listing, `resolveClosures` for every file without a stored closure, a second closure pass and the baseline's lookup;
- `feed.start()`: the watcher subscription and its own reconciliation.

B2 needs only the first step. The measurements above show the `start` revision at 377 to 539 ms and the marker at 1.4 to 10.8 s, so the 750 ms wait always runs out on real repositories. Each spawning session then pays the full wait, 809 to 889 ms against 131 to 184 ms in 0.1.11, and still gets no attribution for its whole life.

The harness test hides this: its fake daemon writes the `start` revision and the marker in the same tick (`test/harness/attribution.test.ts`, `spawning`). The worker's 581 to 613 ms came from a 5-file fixture, where listing and closures are nearly free.

This is the cost decision (b) accepted, so it is not a break of the spec. But the brief asked how often a real repository's first session goes without attribution, and the answer is every time. The human should know that before calling the attribution done.

**Fix (one worker, `src/core/scheduler/bootstrap.ts` or a callback in `SchedulerOptions`, plus `daemon.ts`):** write the marker right after `keys.bootstrap` has stored the `start` revision, or decided there is none, and before listing. D6's "written after `bootstrap`" becomes "written once the start scan's revision is stored".

The feed's start reconciliation then records, as an ordinary revision, what changed between the start scan and the watcher start. That is the same exposure as any edit made by someone else during a session.

Make the harness fake write the marker apart from the `start` revision, and add a daemon test that the marker precedes the listing. Expected SessionStart on spawn: about 400 to 550 ms on these repositories.

The alternative is `wave-10b.md` option (a): no wait at all, and resolve `since` lazily to the new daemon's `start` revision. The human chose (b), so (a) only comes back if (b) cannot be fixed.

### Nits

- **N1.** D6 (`spec.md:111`): "left out. a test or hook timeout adds" has a lowercase sentence start.
- **N2.** A registration made before the marker records no revision, and a registered consumer never takes one up later. That is safe, but it makes S1 cost the whole session rather than its first seconds. If S1's fix still leaves a gap on large repositories, consider letting the first delivery after the marker record `since` as the marker's revision, but only for a main agent registered at SessionStart, before any tool call.

### What fits (do not re-check)

- B1's keep-while-registered, through the handler for `resume` and `compact`.
- Parking for 12 hours with gaps, taken up by the same session and agent only. Expiry drops it (`registered.test.ts` N4 cases).
- `bootstrapped` compares the marker with the live daemon's `startedAt`, so an earlier daemon's marker does not count, and no daemon means no revision.
- The S2 key-equality rule. The S1 one-sentence header.
- `changedSince` is equivalent to the old loop: the range is `(since, revision]`, or the current revision alone when `since` is null or not older.
- `RevisionRepo.range` is one indexed query. The N3 test spies that `get` is never called.
- The registration slot stays a bare number when there are no gaps, so 0.1.10 hooks read it.
- Hook latency without a spawn is unchanged: SessionStart 71 ms p95 at load 0.41.

## Section 2: 001-90, `squeal remove`

### Probes

| Probe | Result |
| --- | --- |
| A daemon restarts between stop and delete | By code. **Before the locks are taken:** the new daemon holds its lock, `holdDaemonLocks` waits 5 s, and remove exits 1 with nothing deleted. That is safe, though the message says the daemon "did not stop" when it stopped and restarted. **While the locks are held:** the new daemon fails `acquireDaemonLock` and exits `lost-lock` before opening the store. **After `rmSync` has unlinked `locks/`:** a new daemon creates a fresh lock and store (N3). |
| A recorded worktree whose root is gone | Its temp directory is found (the key hashes the recorded root, with no `realpath`) and removed, exit 0, both temp dirs listed under "Removed". |
| A store mid-write by another process | 12 rounds. A child process loops `openStore(create: false)` and a `meta` write while remove runs. Every round: exit 0, the store directory gone afterwards, and the writer saw only `open:missing` after the delete. `create: false` in every hook and CLI reader means nothing brings the store back. |
| `--config` in a linked worktree | Deletes the linked worktree's copy only, which leaves `git status` at ` D squeal.config.json`. The main checkout's config stays. The output's "Still there" lists only the plugin (S3). |
| Another user's `/tmp/squeal-<uid>` | `process.getuid` stubbed to 4242, with `/tmp/squeal-4242/tmp/<key>/sub/f` made by root. Remove throws `EACCES` after deleting the store, with no output and nothing under "Removed" (S2). |
| A temp dir holding a read-only subdirectory (0555, one file) | Same: `EACCES` after the store is gone. The temp dir stays, and with `repository-id` deleted no later run can find it (S2). |
| Nothing outside the repository's keys | Kept: a sibling `<key>x`, another 16-hex key, a `<key>.old-link` symlink to an outside directory, and the outside directory's contents when `<key>` itself was replaced by a symlink to it. Only the link was removed. Deleted: only `<common-dir>/squeal/`, `<key>`, `<key>.old-*` real directories of this uid, and `/tmp/squeal-<uid>-<key>-*` real directories of this uid. |

### Should-fix

#### S2. A temp directory that cannot be removed aborts remove after the store is gone, with no output, and exit 1 (proven)

`remove.ts:64-66` deletes the store first, then each temp directory with `rmSync(..., { force: true })`. `force` ignores only a missing path. `EACCES` throws out of `removeCommand`, and `src/cli/index.ts` turns it into an unhandled rejection: stack trace, exit 1. The result:

- The store and `repository-id` are gone.
- "Removed:" is never printed.
- The temp directory stays, unreachable for any later run, since its key needs the deleted id.

`references/commands.md` tells the agent: "Exit 1 means a daemon did not stop and nothing was deleted". That is false here.

Two ways to get there:

- **Realistic:** a test run by the daemon that made a read-only directory in its `TMPDIR` and was stopped before its cleanup.
- **Rare:** `/tmp/squeal-<uid>` made by another user. The daemon refuses that directory (`checkPrivateDir`), so its `tmp/<key>` was never the daemon's, and remove should not touch it.

**Fix (one worker, `src/cli/remove.ts`, its test, `commands.md`):**

- Delete the temp directories before the store.
- Catch each `rmSync` and list failures under "Still there" with the path and the error code.
- Skip the exact `tempDir` unless `checkPrivateDir(userDir, uid)` passes, as `prepareScratch` does.
- Exit 0 with an honest list, or a distinct exit code, and make `commands.md` say which.

Tests: a 0555 subdirectory in the temp dir, and a `userDir` with another owner (stub `process.getuid`).

#### S3. `--config` in a linked worktree does not say that other worktrees keep the config (proven)

`remove.ts:77` deletes `<this worktree root>/squeal.config.json`. The file is committed, so the main checkout and every other worktree keep their copies, and the next session there starts Squeal again. The output says nothing about them. The brief's outcome was "a message saying what is left". The README says it ("other worktrees and clones keep their copy"), but the command, which is what an agent reads, does not.

**Fix:** under "Still there", list each recorded worktree root whose `squeal.config.json` exists, with the same "the next session there starts Squeal again" wording. When the deleted file was tracked, say that the deletion is a change to commit. Test: main plus linked, `remove --config` from the linked worktree.

### Nits

- **N3.** The daemon locks live inside the directory being deleted. Once `rmSync(storeDir)` unlinks `locks/`, holding them excludes nothing. A daemon that starts then creates a fresh lock and store: SessionStart or UserPromptSubmit in a worktree with a config, or a worktree that had no lock file. With a config this is expected, and the output says so. Without one, only a worktree with no prior lock can race in, and only within the milliseconds of the delete (plausible, not reproduced). Deleting `locks/` last narrows it. The `remove.ts` doc claim "so no daemon starts in between" holds only until the delete reaches `locks/`.
- **N4.** A store that cannot be opened gives `recordedWorktrees` an empty list. The temp directories are then neither found nor reported, and `repository-id` is deleted, so they are orphaned (plausible). Read `repository-id` and the roots from `git worktree list` as a fallback, or report that temp directories may remain.
- **N5.** A daemon whose socket file is gone cannot be stopped from the CLI. I saw this with a measurement daemon whose runtime directory my script had deleted. `remove` waits 5 s, exits 1 and suggests `squeal stop`, and `squeal stop` reports "No daemon running". A tmp cleaner can do the same to `/tmp/squeal-<uid>` sockets. This was pre-existing for `stop`, and `remove` inherits it. Naming the lock file in the message would at least say what holds it.
- **N6.** An empty `/tmp/squeal-remove-mESG0K` dated 15:07:46, before the 001-90 commit, matches `storedRepo`'s prefix. My full run left none, so it is probably from an interrupted run of the worker's (unverified).
- **N7.** The brief and the board name the worker's shas `38f85eb` and `109cb33`, not the landed `a71005d` and `5cf4f2f`. I am reporting this, not repairing the board.

### What fits (do not re-check)

- Usage error exit 2. A second run on a store-less repository says "Nothing to remove" and exits 0.
- A held lock means exit 1, naming the worktree, with nothing deleted (tested).
- Two real daemons in two worktrees are both stopped, and both temp dirs plus a fallback are deleted (tested).
- SessionStart afterwards in a worktree without a config prints nothing and ensures nothing (tested).
- `askToStop` uses the recorded socket for a gone root.
- `holdDaemonLocks` skips `waiter-*` locks and releases everything it took on a timeout.
- The temp-dir matching is exact-prefix with ownership checks for `.old-` and the fallbacks.
- D7, the README and `commands.md` match the code, except S2's exit-code sentence.

## Inputs for the next wave

- **B1 fix row** (`src/core/delivery/registered.ts`, `attribution.ts`, `test/delivery/`, `test/harness/attribution.test.ts`, D6).
  - `changedAfter` returns `{ changed, unknown }`, where `unknown` holds the paths of `start` revisions in the range, gaps left out.
  - `attribute` omits both lines when the closure meets `unknown`.
  - No store change. The test list is in B1.
- **S1 fix row** (`src/core/scheduler/bootstrap.ts` or `options.ts`, `src/core/daemon/daemon.ts`, `test/daemon/bootstrapped.test.ts`, the harness fake, D6).
  - Write the marker after `keys.bootstrap`.
  - Keep `bootstrappedMetaKey` and its value (the daemon's `startedAt`), so 0.1.12 hooks read it unchanged.
  - Re-measure SessionStart on spawn against a clone of a real repository, as in the table above, and report the marker time and whether the registration was recorded.
  - It can share a worker with B1: B1 owns `src/core/delivery/`, S1 does not.
- **001-90 fix row** (`src/cli/remove.ts`, `test/cli/remove.test.ts`, `references/commands.md`, D7 if the exit code changes). Covers S2 and S3, and N3's order if cheap: temp dirs first, `locks/` last.
- **Still missing:**
  - an attended check that "touches your changes" names the right file in a real session after a `git pull` and a resume (001-87's fixture);
  - a spawn-path latency case in `latency.test.ts`. Today it measures only a live daemon.
