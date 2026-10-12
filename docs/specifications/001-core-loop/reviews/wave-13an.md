# Wave 13an re-review

## Verification

Candidate `9df8d9db161ede7bd52ff0b13aff32eb9601939e` matches the assigned HEAD. The tree was clean for the candidate checks and throwaway probes. Scope: board row 001-296, the two 001-295 commits (`2ddba8f4`, `dec9c7de`), plugin build `f8163cd4` (0.1.129), and the candidate's coordinator bookkeeping. Read `reviews/wave-13am.md` first; this is a bounded second round on B1, B2 and the retained S1 note, not another review of 001-283.

Commands ran on 2026-10-12 with `env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null`. These are independent Vitest runs, not Squeal checkpoints.

```text
$ git rev-parse HEAD
9df8d9db161ede7bd52ff0b13aff32eb9601939e
$ git status --short
(no output)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npm ci
added 56 packages, and audited 57 packages in 1s
found 0 vulnerabilities
exit 0

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npm run lint
> squeal@0.1.129 lint
> biome check .
Checked 903 files in 263ms. No fixes applied.
exit 0

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npm run typecheck
> squeal@0.1.129 typecheck
> tsc --noEmit
exit 0

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npm run build
> squeal@0.1.129 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.129 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
exit 0
$ git status --short
(no output: both committed plugin builds reproduce)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --maxWorkers 4
Test Files  421 passed | 1 skipped (422)
     Tests  3436 passed | 10 skipped (3446)
  Start at  13:22:57
  Duration  466.12s (tests 98%, import 2%)
exit 0
$ git status --short
(no output)
```

`npm ci` warned that the install scripts of `@parcel/watcher@2.6.0` and `esbuild@0.28.2` were not covered by `allowScripts`; build succeeded without changing those approvals.

The first full-suite attempt (`npx vitest run`, default concurrency) terminated with SIGTERM, exit 143, before any final counts. It printed one failing case in `test/harness/hung-daemon.test.ts`: “is down past grace, unresponsive on its socket, and not replaced.” The cause of that interruption is **unverified**; the coordinator confirmed it did not send a signal during this review. Load rose above 55 on this 24-CPU host. The interrupted run is not a complete proof and is not a finding against this wave. The completed attempt in the verification block limits concurrency to four workers, as the coordinator requested after the interruption. The completed full run passes, including `hung-daemon.test.ts` and the candidate's original boundary regressions. It printed fixture gitdir repair diagnostics and swept one process from an earlier dead test run, without failing teardown. No ENOSPC was reported. At the coordinator's request, the earlier SIGSTOP timing failure was also checked alone, on the same clean candidate:

```text
$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run test/harness/hung-daemon.test.ts --maxWorkers 1
Test Files  1 passed (1)
     Tests  2 passed (2)
  Start at  13:31:08
  Duration  4.33s (tests 85%, transform 13%, import 3%)
exit 0
$ git status --short
(no output)
```

The initial timing failure did not reproduce in the completed full run or alone. It is not a finding against this wave.

The discriminating throwaway probe lived outside the worktree and imported the candidate's two-harness fixture and source hooks. Its writes used the fixture's daemon SQLite connection; hook reads used their own connections. No real agent tooling, HOME state or repository source was changed. The final probe asserted a block on each failure and silence on each pass:

```text
$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --config <throwaway>/vitest.config.mjs
Test Files  1 failed (1)
     Tests  6 failed | 6 passed (12)
  Start at  13:22:10
  Duration  1.32s (transform 55%, tests 33%, import 11%)
exit 1
```

Each harness had three failure schedules: unlisted completion before the first read, unlisted completion during that read, and a re-keyed owed file completing before the first read. All six failed because `waiting.decision` was `undefined` instead of `block`. Their six passing controls succeeded. These assertion failures prove the scenarios below, not an environmental inability to verify them. The probe was removed before committing; its schedule is retained here.

## Verdict

**FAIL 9df8d9db.** One proven blocker, two non-blocking notes (one proven, one plausible), no nits. The original listed-file handoff races and obsolete-snapshot schedules are repaired. An unfinished listing can still discharge an unobserved slow failure silently, leaving the original completion obligation unmet.

## Blockers

### B1. An unfinished listing's slow failure can still disappear from the waiting Stop's obligations

**Proven; residual of 13am B1/B2.** `src/core/delivery/turn.ts:136`, `:141`; `src/harness/shared/stop-slow.ts:111`, `:150`, `:168`, `:277`.

Spec 001 D2 requires: “headers, status and every wait treat a revision ahead of [the refined revision] as pending, so a test file added during a tier is never reported as nothing pending.” The Stop contract in spec 001 D9 includes “while the runner part of the revision is pending, checks first observed later, up to that revision.” Spec 004 D9 requires “A failure among them: one block naming it, with the delta.” The 001-296 brief explicitly asks whether an unlisted slow file the Stop owes can still end the turn silently.

Reproduction in **both Claude Code and Codex**, using `test/harness/stop-slow-helpers.ts`:

1. `repo(harness, { requireSlowSuite: true, slowWaitMs: 400 })` gives a passing existing file, a registered main consumer in a turn, and a trusted waiting handler. Remove the queued `SLOW_FILE` key, so it is not yet listed, and set `refinedMetaKey(worktreeId)` to `"0"` while the latest revision is 1.
2. Run the short Stop. It returns empty output and records an idle turn with `newTestFiles: true`, `revision: 1`, but `handoff.keys: {}`. This Stop still owes the unfinished revision's listing.
3. Before the waiting entry's first read, list and queue `SLOW_FILE`, land its failing result at revision 1, and finish refinement at revision 1, on the fixture's separate daemon connection. These writes can be grouped in `store.transaction`.
4. Run the waiting Stop. It returns empty output, the consumer stays idle, and the slow failure is current.

There is an equally deterministic variant **after waiting begins**: do step 3 at the waiting entry's `deps.now` call 2. That call occurs inside its first read transaction after states and keys have been fetched. The first poll still sees the old unfinished listing; its next poll sees refinement complete and the failure current, and still returns silently. This is not a hook-start scheduling delay.

```text
claude-code, before read: quick={}, waiting={}, turn=idle, slow=fail/current
claude-code, during read: quick={}, waiting={}, turn=idle, slow=fail/current
codex,       before read: quick={}, waiting={}, turn=idle, slow=fail/current
codex,       during read: quick={}, waiting={}, turn=idle, slow=fail/current
```

Replacing the failing result with a passing result returns silence in all four controls, as required.

A repair worker can reproduce the core schedule with the existing fixture:

```ts
const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 400 });
r.store.testFileKeys.remove(r.worktreeId, [SLOW_FILE]);
r.store.meta.set(refinedMetaKey(r.worktreeId), "0");
expect(decision(await harness.stop(r))).toEqual({});
const refine = () => r.store.transaction(() => {
  slowKey(r, "queued");
  landSlow(r, "fail");
  r.store.meta.set(refinedMetaKey(r.worktreeId), "1");
});
// Either call refine() here, or at deps.now call 2 inside the first poll.
refine();
expect(decision(await harness.stopSlow(r)).decision).toBe("block"); // fails
```

**Cause:** the idle turn already records `newTestFiles`, but its new `StopHandoff` contains only currently known keys and does not carry that obligation. The waiting entry tracks only handoff keys and files it actually reads while not current. A newly listed file that completes between reads enters neither set. `failedOf` discards its current failure and the live write transaction accepts silence. The transaction fixes snapshot acceptance; it cannot reconstruct the missing obligation.

**One-worker fix:** preserve and consume the unfinished-listing obligation, bounded to the revision(s) it covers, so a first observation that already completed is still decided. Keep existing known failures outside that obligation and preserve cancellation when a prompt or idle wake owns the turn. Add before-read and during-read failure schedules plus pass controls in both harnesses. Own `src/core/types/delivery.ts`, `src/core/delivery/turn.ts`, `src/harness/shared/stop-slow.ts` and their tests. Do not fix this by blocking on every existing slow failure or extending the wait deadline.

## Should-fix

### S1. The prior worktree-wide capability note remains open

**Plausible, non-blocking; unchanged 13am S1.** `src/core/slow/stop-wait.ts:45`; `src/harness/shared/stop.ts:129`.

The marker remains `{ harness: version }` per worktree, so another session can inherit evidence that only a different session ran the waiting handler. Spec 004 D9's fallback says “a missing or untrusted waiting entry degrades to the old hold, never to none.” No live trust/disable transition was exercised in this review. This was not reopened as a blocker and is already planned as row 001-297. That worker should test two sessions sharing a worktree, only one with the waiting handler, and scope the evidence to the consumer and installed handler or acknowledge the current Stop within the short entry's budget.

### S2. A re-keyed owed file can fail between reads without joining the tracked set

**Proven behavior, non-blocking note under the bounded re-review.** `src/harness/shared/stop-slow.ts:173`, `:175`.

Starting with the ordinary queued slow file, run the short Stop, then append revision 2 (`r.apply()`), queue the slow file at `slow2`, refresh the sink, and land its failure at `slow2`, all before the waiting entry reads it. Both harnesses return `quick={}`, `waiting={}`, with the consumer idle and the revision-2 slow failure current. Pass controls return silence.

The file is in `handoff.keys` at `slow1`, but never in `seen`; the equality to `slow2` fails. This extends beyond the original same-key B1 proof. Spec 001 D9 deliberately excludes later-key results from the ordinary idle waiter's obligation, while the waiting Stop's tests already accept later queued work once a poll sees it. The result is established, but whether a file that moved and finished entirely between polls belongs to this Stop's failure obligation needs a coordinator decision; it is not a second blocker in this bounded review.

**One-worker follow-up:** settle the waiting Stop's rule for later keys, document it in 004 D9, and test failing/passing completions entirely between reads alongside the already covered still-queued revision change. If owed across a key move, track that obligation without requiring a poll to observe the queued phase. Keep the idle waiter's distinct rule unchanged.

## Nits

None.

## What fits

- Original 13am B1's listed, same-key file is recorded in the short Stop's transaction and retained in `handoff` after idle-waiter trimming. The repair includes both reported completion boundaries and pass controls in both harnesses. `failedOf` accepts the current failure at that recorded key even if no poll observed it pending.
- Original 13am B2's obsolete-read decision is repaired: `decide` takes `BEGIN IMMEDIATE`, re-reads states, keys, revision, refinement and turn, then accepts completion or takes the turn under the same write lock. A newer queued key seen there retries within the existing monotonic deadline; its passing control stays silent. Old failures do not ride beside a new revision's header.
- An unfinished listing stays pending while it remains unfinished, including with an empty open-file list. The bound names its pending runner part. Refinement that completes with passing slow files stays silent. B1 concerns a failure first observed after that listing finishes.
- `newsText(..., atRevision)` is wired to delivery's transaction-level revision guard, returns nothing on a mismatch, and does not consume the later delta. The fallback status text uses the accepted decision's header. Callers without the option keep the existing behavior; both bundles reproduce.
- The wait still spends one `performance.now()` deadline across retries, with the same 600000 ms cap, 3000 ms handoff and 630 s hook timeout. Taking an idle consumer back into a turn remains atomic. Setting-off, active-Stop, SubagentStop and prompt/wake cancellation exits remain in place. No double block or timeout overrun was reproduced.
- The fixture extraction changes no product behavior; the added boundary tests use separate SQLite connections and explicit clock hooks. Their missing case is an unlisted file that is already current when first read, not lack of deterministic read boundaries.
- The primer/skill findings settled by 13am are unaffected by the repair and were not re-prosecuted. Board/status are coordinator-owned and were not edited.

## Inputs for the next wave

Dispatch one repair row for B1 only after the coordinator handles this second-round blocker under the brief's human escalation rule. S1 already belongs to 001-297; S2 is a policy note, not an implicit expansion of the blocker repair.

Keep the order: short Stop decides and delivers; silent `endTurn` records known owed files/keys **and unfinished listing obligations** in the same transaction; daemon nudge; waiting-entry handoff; track those obligations before reading completion; poll through refinement and later pending files; decide using a live read under `BEGIN IMMEDIATE`; either take the idle turn once, cancel because another prompt/wake owns it, or return silent only after all owed failure evidence was considered. Retain the transaction/revision guards and one wait deadline. Do not alter the 2 s short entry, 600000 ms cap or 630 s hook timeout.

A stranger should add the two unlisted-completion schedules in both harnesses to `stop-slow-boundary.test.ts`, with their pass controls, prove them red on this candidate, then repair the handoff/tracking and run the integrated gate. The coordinator owns bundle/version/key-format changes and board/status amendments. No product code was rewritten by this review.
