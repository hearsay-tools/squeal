# Wave 13bo: review 001-384 of release 0.1.179

## Verification and verdict

Candidate: `668e6dfd5868eedc5ccb8bc50ba9cbc1ffed73ac`. Range: `a091ae15..668e6dfd`. HEAD was detached at the exact candidate before any other work. Product code was not rewritten.

FAIL: **3 proven blockers**, **1 plausible should-fix note**, **1 proven documentation nit**. Independent verification ran from the clean pinned tree. Build left tracked files unchanged. The failure and wiring probes used temporary HOME, XDG_CONFIG_HOME and XDG_RUNTIME_DIR, with private fixture repositories, stores and pool directories. An exploratory Git-only layout command initially inherited its user environment; it was repeated with isolated directories and user/system Git config disabled before its output was used. All probe daemons were stopped and scratch repositories removed. No other worktree, store or daemon was manipulated.

```text
$ npm ci
npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead

added 196 packages, and audited 197 packages in 7s

32 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
npm warn install-scripts 6 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @google/genai@2.21.0 (preinstall: echo 'preinstall: no-op')
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
npm warn install-scripts   msgpackr-extract@3.0.4 (install: node-gyp-build-optional-packages)
npm warn install-scripts   opencode-ai@1.18.35 (postinstall: node ./postinstall.mjs)
npm warn install-scripts   protobufjs@7.6.6 (postinstall: node scripts/postinstall)
npm warn install-scripts
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
exit 0
```

```text
$ npm run lint
> squeal@0.1.179 lint
> biome check .

Checked 1178 files in 522ms. No fixes applied.
exit 0
```

```text
$ npm run typecheck
> squeal@0.1.179 typecheck
> tsc --noEmit
exit 0
```

```text
$ npm run build
> squeal@0.1.179 build
> tsc -p tsconfig.build.json && npm run build:plugin


> squeal@0.1.179 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
exit 0
```

```text
$ npx vitest run --maxWorkers=4
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/2476a73c-f841-4fc8-bb26-4fc5d42ef09c

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/2476a73c-f841-4fc8-bb26-4fc5d42ef09c/test/fixtures/scheduler/.tmp/e5046366-9e17-449a-aa75-58ffbadbb1a1/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/2476a73c-f841-4fc8-bb26-4fc5d42ef09c/test/fixtures/scheduler/.tmp/9afdcbbd-9682-4d01-8018-d4394e92594c/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 997492
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  561 passed | 1 skipped (562)
      Tests  4634 passed | 94 skipped (4728)
   Start at  23:27:39
   Duration  895.23s (tests 97%, import 2%, transform 1%)

    Isolate  562 workers spawned · ~224ms startup each (spawn + environment, per file)
             at least ~31.18s faster with isolate: false — reuses workers across files instead of one per file

npm notice
npm notice New major version of npm available! 11.19.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
exit 0
```

```text
$ git rev-parse HEAD
668e6dfd5868eedc5ccb8bc50ba9cbc1ffed73ac
$ git status --porcelain
(no output, before writing this report)
```

P1/P2/P3 remain **unverified** host measurements assigned to 001-380; they were not run here. The independent suite is green, but the additional probes prove the three blockers below.

## Blockers

### B1. Proven: shrinking a lease erases the waiting backlog's demand

Location: `src/core/capacity/pool.ts:195` and `:237`; caller `src/core/scheduler/tiers.ts:244`.

D11 Capacity: “At each tier boundary a daemon takes at most its fair share, the host's slots divided by the daemons with backlog work ... the longest waiter is served first, and slots one daemon cannot use go to the others.” The assigned review requires two backlogs to split the host at the next boundary.

Every successful scheduler start calls `lease.shrinkTo(files.length)`, even when no permit is returned. `#republish()` replaces `want` with `#inUse()`. Thus a waiter granted one worker is advertised as wanting only one, even though it is still starting a 200-file backlog tier. Older-waiter reservation also uses these reduced demands.

An isolated public-pool probe followed the scheduler's exact acquire/shrink/release sequence with hostSlots=8 and two daemons each requesting 200:

```text
A first acquire + shrinkTo(200): grant 8, mark want 8
B first acquire + shrinkTo(200): grant 1, mark want 1, since non-null
A releases, next acquire + shrinkTo(200): grant 7 (expected 4)
B releases, next acquire + shrinkTo(200): grant 2 (expected 4)
```

A second probe followed the same shrink calls for a holder and two waiters. After the holder returned two permits, the younger waiter reached its boundary first and got grant 3; the older got 1. The required order is younger 1, older 3.

No preemption occurred; the errors are the next-boundary allocation and waiter reservation. Existing pool fairness tests omit `shrinkTo`, so they bypass the actual scheduler seam and pass.

Worker-sized fix: retain unsatisfied demand separately from held grants, including per-lease demand across concurrent lanes. A shrink should adjust demand to the files actually starting, without reducing their requested workers to the granted workers. Re-publish the remaining demand when a lane releases. Extend the existing pool tests to use acquire/shrink/release on every tier, including the longest waiter and a second lane.

### B2. Proven: a failed mark publication leaks an unreachable lease and can stall scheduling after recovery

Location: `src/core/capacity/pool.ts:149`; fallback `src/core/scheduler/capacity.ts:35`.

D11 holds a permit for one tier and returns it at its end; the assigned review requires a pool-directory failure never to stall the scheduler. TierCapacity promises that a failed pool lets the tier run without a grant.

`acquire()` takes the locks, adds the lease to `#leases`, then calls `#publish()` without rollback. If `writeMark()` fails, no lease handle reaches the caller. TierCapacity catches the error and runs the tier ungranted, leaving both its implicit worker and any locks assigned to an unreachable lease. That tier has no lease to release.

The isolated probe made the daemon's `pool.mark.<hash>.tmp` a directory in an otherwise usable private pool directory. With hostSlots=2:

```text
first TierCapacity.take(200): null, one EISDIR fallback note
remove the obstructing directory
next TierCapacity.take(200): wait
repeated TierCapacity.take(200): wait
competitor's grant while leaked lease remains: 1
```

The recovered pool still believes the daemon's free worker and sole permit belong to a live lease. There is no associated tier whose end can wake or release it. Only closing the pool recovers them. The note “tiers run without a grant” therefore describes an unsafe fallback. The same unguarded mark write in `shrinkTo()` can throw out of `startTier` after acquisition, before the normal flight's finally exists.

Worker-sized fix: make acquisition and shrink exception-safe. Return every newly taken lock and remove the implicit-worker reservation before an acquisition error escapes. Ensure bookkeeping/mark-write errors cannot escape release or strand the lease when startTier fails; use try/finally around acquisition-to-start transfer. Keep the single fallback note. Add failure injection after permit acquisition, at shrink, and while another lane remains held, then assert that recovery can acquire and that close returns all locks.

### B3. Proven: a configured repository cap is ignored with a separate Git metadata directory

Location: `src/core/daemon/user-config.ts:94`; uses `src/core/daemon/daemon.ts:178` and `:188`.

D11 Configuration: `capacity.projects` is “a map from a repository root path to { "slots": n } capping that project's daemons together.” The assigned review explicitly requires the cap to apply when the map names the repository.

`repositoryRootOf()` returns a common directory unchanged unless its basename is `.git`. A valid non-bare worktree created by `git init --separate-git-dir <metadata> <root>` is accepted by openDaemon, but this helper treats `<metadata>` as the repository root. The entry naming `<root>` is never matched. This also makes the basename heuristic unsuitable for submodule metadata directories.

A real-daemon probe used four held node:test files and user config hostSlots=8, projects[actualRoot].slots=2:

```text
ordinary repository: mark grant 2, project { id: actualRoot, slots: 2 }
DaemonOptions.capacity override: mark grant 3, project { id: injected, slots: 3 }
separate-git-dir repository: repositoryRootOf = metadata directory
separate-git-dir repository: mark grant 4, project null (expected grant 2)
```

The last daemon was running an actual backlog with the cap silently omitted. Each daemon was stopped normally, letting its held tier finish before fixture cleanup.

Worker-sized fix: resolve the repository's primary worktree root from Git's layout rather than the common directory's basename, and use the same canonical identity for lookup and pool project marks. Preserve ordinary linked-worktree sharing and explicitly handle bare-backed worktrees. Add a daemon wiring regression for an actual-root config entry on a separate-git-dir repository, plus a submodule case if the shared resolver supports it.

## Should-fix notes

### S1. Plausible: clarify whether checkpoint slow tiers must join the host pool

Location: `src/core/scheduler/slow-tier.ts:347`; D11 Capacity “Backlog and checkpoint tiers ... extended to every lane”; 001-376 notes, question 1.

Slow selection calls `startTier(..., false)` without a pool lease even for an explicit full-suite checkpoint. It holds only `slow.lock` permits, which are independent of `pool.<i>.lock`. Worker notes flag this interpretation as unresolved. D2 defines a separate slow width and permits, so this is a scope ambiguity, not an additional blocker. The coordinator should settle and amend the wording: either name the fast lanes in D11, or dispatch slow-lane pool integration with an explicit rule for its existing file permits and per-file workers. Nested-daemon directory isolation must remain intact.

## Nits

### N1. Proven: the reader's comments still promise live reconfiguration

Location: `src/core/daemon/user-config.ts:62`; `src/core/daemon/daemon.ts:145`.

The comments say capacityReader is for “each tier boundary” and an edit applies “without a restart”. Integration passes a concrete capacity object at loop creation. The amended D11 explicitly says edits apply to daemons started afterward. Runtime follows the amended spec, so this is documentation drift only. Update the comments and the next-worker handoff to describe the start-time snapshot.

## What fits

- Edit tiers bypass `TierCapacity.take` in selectTier and carry no worker grant. The added scheduler regression occupies both the pool and the daemon's free worker while a node:test edit runs beside the held Vitest backlog.
- For successful pool operations, acquisition occurs before startTier's transaction marks keys running. A capacity wait commits selection bookkeeping without taking claims.
- Ordinary tier completion, crash, timeout, cancellation and completion-barrier withholding all pass through recordTier/endTier; errors during flight have a finally release; normal shutdown awaits the pump and closes the pool. These paths share release rather than checking report verdicts. B2 covers the unprotected acquisition/start/publication boundary.
- SQLite exclusive locks provide OS crash release. The existing SIGKILL regression checks immediate lock recovery and the conservative 30-second expiry of a dead holder's mark.
- The pure share calculation covers water-filling, remainder to the longest waiter, unused shares, project grouping and the free-worker floor. B1 concerns published demand, not that arithmetic.
- The user loader collects errors into one note, retains valid project entries, rejects capacity in committed project policy, resolves symlink spellings and clamps a project cap above hostSlots. The real-daemon probe verifies normal config wiring and the explicit options override. Config edits need a new daemon under the approved amendment.
- Old releases use no new pool paths and the existing slow.lock filenames remain unchanged. New pools use the daemon's supplied runtime environment, preserving distinct nested-e2e directories. Scheduler tests without capacity retain their previous behavior.
- Explicit run --slow preempts an existing guard wait, reads load for width only and runs one file per tier under load. The added regression keeps the idle trigger waiting, then drains a request as widths [1, 1], and verifies that a later idle pass waits again. Neither the old slow permits nor runner priority changed.

## Inputs for the next wave

Preserve the existing budgets: edits use runner.tierSize; backlogs use runner.backlogTierSize and the last-known duration sum capped at min(300 s, half runner.timeoutMs), with D5's first-file exception. Pool marks count for 30 s and holders refresh every 10 s. A second lane without a permit waits for its own daemon's tier boundary; an edit never enters that wait. No host-pressure threshold is established by this review.

1. Repair B1 before runner sizing consumes the grant. Keep demand and grant distinct and test the unconditional startTier shrink call. Preserve one free worker per daemon, never one per lane, longest-waiter reservation and no preemption.
2. Repair B2 before relying on the pool as an admission boundary. Acquisition precedes claims; ownership transfers to Tier only after a successful start; every failed transfer returns it. Mark I/O failures must preserve scheduler progress and release every OS lock. Normal release must remain idempotent.
3. Repair B3 with one canonical repository identity shared by the user-config lookup and pool mark. Keep explicit DaemonOptions.capacity authoritative, ordinary linked worktrees on one cap, and nested runtime directories separate.
4. Resolve S1 before changing slow admission. Under high load explicit requests remain one file per tier, while idle triggers retain the guard. Pending edits stay ahead of slow work.
5. 001-378 still must apply RunOptions.workers to the runner's actual parallelism, respect the project's ceiling and Vitest's specified floor, and remove maxWorkers from the key with the format change. It is intentionally absent here. 001-379 still supplies pressure sizing; P1/P2/P3 remain the calm-host work of 001-380. The worker's done-when mentions P3 but its notes defer it; this review's small probes do not substitute for that host measurement.
