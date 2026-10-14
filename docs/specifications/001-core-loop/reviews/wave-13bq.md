# Wave 13bq: bounded re-review of candidate 0.1.182

## Verdict and verification

**PASS** `5808fdafdca6f27a158def1a302e737fb872e147`, with a narrow test-only addendum at `72076a6fb5c2e204a47fe3bc6e39c9b2709b6185`: **0 blockers, 0 should-fix, 1 proven documentation nit, 1 proven out-of-scope test-failure note**. The scoped judgment does not claim a green independent full suite.

Inputs: wave-13bo B1 to B3, N1 and the settled S1 ruling; wave-13bp B1 to B4; board rows 001-386, 001-389 and 004-60; their task notes; 001 D4/D5/D6/D11 and 004 D2. Other observations are notes under this brief. The coordinator subsequently requested a narrow review of `5808fdaf..72076a6f`, which changes only `test/daemon/drain.test.ts`.

The original candidate was fetched and checked out detached. `git rev-parse HEAD` returned exactly `5808fdafdca6f27a158def1a302e737fb872e147`. The tree was clean for all original verification and remained clean after the build and full suite. Each probe and the independent suite used temporary HOME and XDG config/runtime/cache/data/state directories; no other worktree's store or daemon was used.

Original candidate verification, output excerpts:

```text
$ npm ci
added 196 packages, and audited 197 packages in 10s
found 0 vulnerabilities
exit 0

$ npm run lint
> squeal@0.1.182 lint
> biome check .
Checked 1224 files in 705ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.182 typecheck
> tsc --noEmit
exit 0

$ npm run build
> squeal@0.1.182 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.182 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
exit 0; git status --porcelain: empty

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
RUN v5.0.3
FAIL test/harness/opencode-hooks.test.ts > the Squeal plugin in OpenCode > run: a child session gets the primer and its own registration
AssertionError: expected [ { consumer: { …(3) }, …(3) } ] to deeply equal []
test/harness/opencode-hooks.test.ts:131:50
Received: one consumer with agentId "main"; expected: []
Test Files  1 failed | 582 passed | 1 skipped (584)
Tests       1 failed | 4754 passed | 94 skipped (4849)
Start at    01:16:02
Duration    723.40s (tests 97%, import 2%, transform 1%)
exit 1
```

This was the reviewer's independent full run, not a Squeal checkpoint. It waited for the host's shared lock. The host has 24 CPUs; an observed one-minute load during the suite was 25.49 (5-minute 33.97, 15-minute 46.63). Load is context, not a demonstrated cause of the failure. N2 below records the failure without re-prosecuting an unrelated module. All scoped probes below completed on the original candidate before checkout changed.

## Test-only addendum verification

Origin was fetched while the original suite ran. After that suite exited, the checkout moved detached to `72076a6fb5c2e204a47fe3bc6e39c9b2709b6185`; `git rev-parse HEAD` matched. `git diff --name-only 5808fdaf..HEAD` returned only `test/daemon/drain.test.ts`. The tree was clean for this focused verification, again with temporary HOME and XDG directories:

```text
$ npm run lint
> squeal@0.1.182 lint
> biome check .
Checked 1222 files in 604ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.182 typecheck
> tsc --noEmit
exit 0

$ taskset -c 0-3 npx vitest run test/daemon/drain.test.ts --maxWorkers=4
RUN v5.0.3
Test Files  1 passed (1)
Tests       5 passed (5)
Start at    01:28:32
Duration    70.54s (tests 98%, transform 1%)
exit 0; git status --porcelain: empty
```

The full suite, installation and build evidence above belong to `5808fdaf`, not to this addendum SHA. A second independent full run was not performed for the single fixture-only change. The focused four-CPU run discriminates the reported failure mode.

## Blockers

None. Every blocking scenario from wave-13bo B1 to B3 and wave-13bp B1 to B4 is closed on this candidate.

## Re-review evidence

The probes imported this candidate's freshly built pool, adapter and scheduler. Daemon probes used the rebuilt shipped Codex CLI, with the sources under tsx for the explicit library override; all four held test bodies were observed before each cap was read. Every fixture, HOME and XDG directory was temporary. Git's user and system configuration was disabled. Real daemons served only the probe repositories and were stopped before cleanup. Probe-harness failures were corrected before using their results: Node's eval-only `--input-type` flag reached a worker, and the scheduler recorder initially left class methods unbound. An initial packages probe also used plain tsc CLI output without the copied node:test runtime; it was replaced by the candidate's shipped Codex CLI. None of those harness failures was candidate evidence. The following results came from the corrected probes, without candidate edits.

### Wave 13bo

- **B1, closed, proven.** `src/core/capacity/pool.ts:134`, `:221`, `:249` keep demand separately from held workers. Repeating acquire, unconditional shrink-to-files and release gives grants **8, 1, 4, 4** for two 200-file backlogs on eight slots. The newcomer's mark remains `want: 200, grant: 1`. Repeating the holder/older/younger probe gives the younger **1** and older **3**, even when the younger reaches its boundary first. The new two-lane regression also checks that releasing one lane leaves the other's demand in the mark.
- **B2, closed, proven.** `pool.ts:164` rolls acquisition back after mark failure; `:274` makes shrink publication nonthrowing. Repeating the private `pool.mark.<hash>.tmp` directory obstruction through `TierCapacity` produces two ungranted starts and one EISDIR note. Removing it immediately permits a grant of **2**, without closing/reopening the pool. Shrink and release under the obstruction do not throw; recovery again grants **2**; close leaves the physical permit takeable. Fast and slow selection both release a lease in `finally` until a tier owns it (`src/core/scheduler/tiers.ts:184`, `slow-tier.ts:389`). The candidate adds acquisition, shrink/release and another-held-lane regressions.
- **B3, closed, proven.** `src/core/daemon/user-config.ts:102` takes both the worktree root and common directory. The daemon computes this identity once at `daemon.ts:183` and uses it for both lookup and pool project identity. Repeating the real-daemon probe with four held node:test files gives **grant 2, project actualRoot/2** for ordinary and separate-git-dir repositories. Explicit `DaemonOptions.capacity` still gives **grant 3, project injected/3**. The separate-git-dir root resolves to the checkout, rather than the metadata directory. Actual Git-layout regressions include submodules, linked worktrees and bare-backed worktrees. The documented separate-git-dir linked-worktree fallback remains the metadata directory; no shared-cap claim is made for that exception.
- **N1, closed, proven.** The comments at `user-config.ts:68` and `daemon.ts:147` now describe a start-time pool snapshot and application to daemons started after an edit. The old worker notes are explicitly superseded by 001-386's notes.
- **S1, closed under the human's ruling, proven.** Slow selection takes `files × slow.maxWorkers` from the same `TierCapacity` before starting claims. Its lease wrapper converts `startTier`'s file count back to workers; its separate slow-file permits shrink to the actual files and remain in the isolated slow slot directory. An idle two-file tier carries **workers 4**. With another private daemon holding eight slots, both slow files run as separate **one-file, workers-1** tiers. An explicit slow request finding `WAIT_FOR_CAPACITY` runs ungranted; this exception is now in D11. These are scheduler grants and admission evidence, not proof that the still-planned 001-378 runner sizing is implemented.

### Wave 13bp

- **B1, closed, proven.** `src/runners/vitest/run.ts:79` preserves the rejection marker in the timeout mapping used by both cancellation graces. Repeating the delayed always-throwing global setup at timeout 50 ms, followed by timeout 10 s, gives **calls 2**, first end `timed-out`, second end `crashed`, and **zero completed files in both**. The second call reports `bootstrap` again. Abort mapping already spreads the underlying execution, and the adapter's existing rejected/hung cleanup remains shared by both paths.
- **B2, closed, proven.** `src/runners/vitest/startup.ts:96` normalizes primitive thrown values; classification catches conversion errors, allowing the adapter to dispose of the rejected instance. Two calls each with `throw null`, `throw undefined` and `throw "database is down"` all give **calls 2**, two crashed runs and zero completed files. Null and undefined retain their contextual text, and the string retains `database is down`. No TypeError escapes in these probes.
- **B3, closed, proven.** `startup.ts:73` searches actual run projects, accounts for the root project's setup and shared ownership, and falls back to the run projects when the named file is ambiguous. `src/core/scheduler/setup.ts:77` defensively intersects attribution with the not-started tier. In the review's real scheduler fixture with empty project `a` and only project `b` runnable, baseline gives **one setup call**, one crashed run attributed to **[b]**, one `[b] setup.ts` known failure at revision zero, and no immediate retry. An explicit checkpoint gives exactly the second call. The adapter regression also requests only `b` twice and requires attribution to `b` both times.
- **B4, closed, proven.** `reporter.ts` records requested module queue events, `run.ts:224` supplies `startedProjects`, composite merge preserves it (`src/core/daemon/composite-runner.ts:182`), and `recordTier` clears setups from it before applying any new startup failure (`tiers.ts:504`). Repeating the throw-once setup followed by a hanging test with runner timeout 5 s gives **calls 2**, a confirmed test-body marker, retry end `timed-out`, **zero completed files**, `startedProjects: [""]`, setup state **pass**, and exactly **[(null, fail), (fail, pass)]** in its transition history. Vitest 5.0.3's `runFiles` awaits `initializeGlobalSetup(specs)` before the pool queues modules; `initializeGlobalSetup` awaits all requested projects and the root project. Thus the signal proves successful setup, even when no file completes. An aborted-before-queue run supplies no such evidence.

### 004-60 and the test condition

- **004-60, proven.** `SlowTier.#fastFirst` uses `editPending() || (!requested && !fastIdle())` at candidate selection, after guard/slot acquisition and after completion. The scheduler's `fastIdle` includes runner refinement, queued fast files and fast flights, so baseline, checkpoint and `run --all` use the same ordering. Separate external baseline and forced-checkpoint probes held the first fast file at zero load with no consumer: no slow run occurred while it was held, and both fast tiers completed before a two-file slow tier. With hostSlots 1 and the fast baseline held, `requestSlowSuite` completed both slow files as **one-file, ungranted** tiers before releasing fast work. A backlog arriving after a slow tier started is not preemptive, as D2/D4 say. The candidate's new `slow-backlog` tests and adjusted activity tests test these states rather than accepting an earlier waiting reason.
- **node-test-packages, proven by a shipped-CLI probe and source.** `test/integration/node-test-packages.test.ts:148` waits for at least twice the three reaching files in run rows and for every row to end, in addition to the prior current-failure/quiet condition. The following exact equality still requires each reaching file exactly twice and the plain file never; failure ownership is still checked. A missing retry times out, an extra/unrelated retry fails equality, and an unfinished retry cannot satisfy the new predicate. `queueReruns` records a new failure immediately and queues its forced retry without making the already reported failure pending. The isolated shipped-CLI probe reproduced the exact former settle window: status was `current: 8, pending: 0`, all first failure rows had ended, but only the three first file runs existed. The new predicate waited for all six ended file runs; their exact identities were each of the three reaching files twice, with no plain-file run. This confirms the worker explanation; the same scheduler mechanism predates pool admission. Waiting for the run records is appropriate for this test's purpose; no product assertion was dropped. Whether an explicit checkpoint should await such a follow-up retry is a separate D7/product decision, already named in the notes, not a hidden pass in this review.

### Drain fixture addendum, `5808fdaf..72076a6f`

**Fits, proven.** `test/daemon/drain.test.ts:142` writes `capacity.hostSlots: 16` into the fixture's private `runtimeDir/config/squeal/config.json` before `suite.daemon(repo)` starts. `childEnv` sets that same `runtimeDir/config` as `XDG_CONFIG_HOME` (`test/daemon/helpers.ts:153`); the daemon reads it once at startup. Cleanup already removes the runtime directory. It neither changes the repository's config nor touches a real user's config.

On four CPUs the default is three host slots, so two files asking for two workers each are admitted one at a time. That is the intended D11 capacity admission, not a product failure. The fixture tests draining and slow-file parallel admission when enough permits exist. Its explicit capacity now supplies those permits independent of CPU affinity. Both queued-in-turn cases share the fixture; their assertions about no starts during a turn, both starts during drain, fast edit precedence, stored outcomes, and exit remain unchanged. The independent four-CPU run passed all five tests. Pool shortage remains covered by the held-pool probe above, so this change does not hide that boundary. N1's wording adjustment remains useful.

## Should-fix

None.

## Nits

### N1. Proven, nonblocking: name the slow admission floor in D11

Location: `docs/specifications/001-core-loop/spec.md:208`; implementation `src/core/scheduler/slow-tier.ts:386`.

The new wording says “`slow.maxWorkers` per slow file, and as many slow files as the grant holds”. With `slow.maxWorkers: 2` and a one-worker grant, the implementation takes `max(1, floor(grant / perFile))` files, and the held-pool probe proves that one file runs with `workers: 1`. This forward-progress floor is intentional and consistent with the free worker, but missing from that parenthesis. Worker-sized documentation fix: add “at least one file” to the admission rule and distinguish requested width from the whole-tier worker grant. No product change is requested.

## Notes outside the bounded scope

### N2. Proven observed failure; cause unverified: OpenCode root consumer remains after the child-session test

Location: `test/harness/opencode-hooks.test.ts:131` at `5808fdaf`.

The independent full suite expected no consumers after OpenCode exited, but the store retained one consumer with `agentId: "main"`. The child request, primer and child registration assertions before it passed. The suite therefore exited 1. This is outside the prior findings, slow admission, package retry predicate and spec-amendment scope, so it is a note, not a blocker in this judgment. No isolated reproduction or claim about the load causing it was made.

One-worker follow-up: reproduce this exact child-session case in isolation, then inspect root disposal and registration ownership before choosing a repair. Preserve the empty-consumer assertion; report whether it reproduces alone and the load at each run. The coordinator must account for the red independent gate separately from this scoped PASS.

## What fits

- D4's new rejection/cancellation/primitive wording matches the lifetime repairs. D5's run-project-only attribution and root/shared-setup cases match the new owner resolution. D6's successful-setup evidence is sound: any requested module queue proves all run-project setups finished in the supported Vitest, while completion remains sufficient as a compatibility fallback. Setup outcomes still use known state and transitions, never keyed results or inheritance, as the prior review settled.
- D11's pool demand, mark-write rollback, user-config snapshot and repository-layout exception match the repaired boundaries. The slow lane now joins admission without merging its file permits with pool worker permits. The new request exception preserves prompt explicit work. N1 is the sole wording nit in these amendments.
- 004 D2 now consistently says fast backlog goes first unless `run --slow` asked. Edit work retains priority even for the request. The source no longer contains the old contradictory “background fast work does not hold it back” promise in that section.
- No product code was rewritten by this review. Settled storage, delivery, counting and restart paths from wave-13bp were not re-prosecuted. Unrelated candidate changes are outside this narrow judgment.

## Inputs for the next wave

No blocker repair wave is needed within this scope. Amend N1 as documentation and triage the out-of-scope red gate in N2. Preserve these seams for 001-378 and later pool work:

1. Acquire before claims. Demand is the requested workers, not the grant; unconditional `shrinkTo` must preserve that distinction. Return acquisition locks on publication failure and release a lease on every failed transfer to a tier. Shrink remains nonthrowing; release remains nonthrowing and idempotent.
2. Slow demand is `files × slow.maxWorkers`. The whole-tier `RunOptions.workers` grant is not the width of each file's Vitest instance. Admission uses `max(1, floor(grant / slow.maxWorkers))`; explicit slow work may have no grant. Do not turn a one-worker grant into zero runnable files. Runner ceilings/floors and sizing remain 001-378's work, not a claim of this release.
3. Idle/checkpoint slow work waits for its own daemon's entire fast backlog. Explicit slow work bypasses backlog/load/capacity waits as specified, keeps edit priority, and keeps the slow-file permits. A tier already in flight finishes. HOME/XDG isolation must continue covering both pool and slow slots.
4. Keep `RunExecution.rejected` through all end mappings. `startupFailure.projects` names only projects of the run. Carry `startedProjects` through composite reports and clear setup state before new failures, including when no file completes; never infer recovery from a cancellation before queueing.
5. Keep D5 budgets: backlog duration sum at most min(300 s, half runner.timeoutMs), first-file exception, runner.backlogTierSize; edits use runner.tierSize. Marks remain fresh for 30 s, refreshed every 10 s, without preemption. P1/P2/P3 and pressure/runner sizing remain the separately assigned work. This review supplies no host-pressure threshold or performance measurement.
