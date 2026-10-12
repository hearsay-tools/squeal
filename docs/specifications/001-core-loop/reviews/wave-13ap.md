# Wave 13ap third review

## Verification

Candidate `ba491ae6b1936d80b71f2cee19534b72923f4c45` matches the assigned HEAD. The candidate tree was clean for all checks and probes. Scope: row 001-303, the 001-302 repair `f7ca11e5`, its spec 004 D9 amendment, and the integrated plugin build `84a4d992` (0.1.130). Read `wave-13am.md` and `wave-13an.md` first. This is a bounded third round on 13an B1 and S2; the watcher changes belong to 001-301 and were not re-prosecuted.

Independent commands and output, 2026-10-12. Lint, typecheck, build, the full Vitest run and the probes used `env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null`. The full suite uses four workers, following the prior review's successful concurrency limit, and is the reviewer's own run, not a Squeal checkpoint.

```text
$ git rev-parse HEAD
ba491ae6b1936d80b71f2cee19534b72923f4c45
$ git status --short
(no output)

$ npm ci
added 56 packages, and audited 57 packages in 1s
found 0 vulnerabilities
exit 0

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npm run lint
> squeal@0.1.130 lint
> biome check .
Checked 911 files in 337ms. No fixes applied.
exit 0

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npm run typecheck
> squeal@0.1.130 typecheck
> tsc --noEmit
exit 0

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npm run build
> squeal@0.1.130 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.130 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
exit 0
$ git status --short
(no output: both committed plugin builds reproduce)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --maxWorkers 4
Test Files  426 passed | 1 skipped (427)
     Tests  3504 passed | 10 skipped (3514)
  Start at  14:23:33
  Duration  544.35s (tests 97%, import 2%, transform 1%)
exit 0
$ git rev-parse HEAD
ba491ae6b1936d80b71f2cee19534b72923f4c45
$ git status --short
(no output)
```

`npm ci` warned that the install scripts of `@parcel/watcher@2.6.0` and `esbuild@0.28.2` were not covered by `allowScripts`. No approvals were changed; the build succeeded.

The full run printed two fixture gitdir repair diagnostics and swept one process from an earlier dead test run. Teardown and the suite passed. The candidate tree remained clean, and HEAD still matched after the run. The original B1/S2 regressions and cancellation controls passed as part of this full suite.

A throwaway Vitest probe outside the worktree imported the candidate's two-harness fixture and hooks. It wrote disposable fixture stores on the fixture's connection, while hook reads used separate SQLite connections. It used no real agent tooling or HOME state and changed no candidate files. It covered the combined unfinished-listing/re-key schedule before and during the first read, with pass controls and an observed-queued control. A confirmation run added explicit assertions that the final slow state was current at revision 2, with the expected outcome, before asserting the hook decision. Both runs gave four missed-block assertion failures and eight passing controls:

```text
$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --config <throwaway>/vitest.config.mjs
Test Files  1 failed (1)
     Tests  4 failed | 8 passed (12)
  Start at  14:24:53
  Duration  3.80s (transform 60%, tests 28%, import 11%)
exit 1

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --config <throwaway>/vitest.config.mjs
Test Files  1 failed (1)
     Tests  4 failed | 8 passed (12)
  Start at  14:26:01
  Duration  2.28s (transform 52%, tests 36%, import 11%)
exit 1
```

The failed assertions expected `waiting.decision === "block"` but received `undefined`. They prove B1 below, independently of the repository gate. The probe was removed before committing. Its schedule is preserved below.

## Verdict

**FAIL ba491ae6.** One proven blocker, one retained plausible non-blocking note, no nits. The original 13an B1 schedules at the recorded revision and S2 schedules for an already recorded file are repaired separately. Their combination still loses an owed failure: an unlisted file can first fail at the owed revision, then fail at a newer key, without ever joining the waiting entry's tracked file set.

## Blockers

### B1. An owed file from an unfinished listing is forgotten when its completed result moves to a newer key

**Proven; residual combination of 13an B1 and S2.** `src/harness/shared/stop-slow.ts:160`, `:161`, `:192`, `:195`.

Spec 004 D9, as amended for 001-302, includes among the slow files owed by the waiting Stop “when that end left the runner part of its revision pending, each slow check first observed up to that revision that the agent was never told.” It requires “A failure among them: one block naming it, with the delta” and says an owed file's failure at a newer key blocks even when it was “queued and run between two reads.” The 001-303 brief asks whether any schedule of listing, keys, revisions and results still ends silently while an owed slow file failed at its recorded or a newer key.

Reproduction in **both Claude Code and Codex**, using `test/harness/stop-slow-helpers.ts`:

1. Make `repo(harness, { requireSlowSuite: true, slowWaitMs: 400 })`. Remove `SLOW_FILE` from `testFileKeys` and set the refined revision to `"0"`, while the latest revision is 1. Run the short Stop. It returns `{}` and leaves `handoff = { revision: 1, keys: {}, newTestFiles: true, ... }` on the idle consumer.
2. List and queue `SLOW_FILE` at `slow1`, then `landSlow(r, "fail")` at revision 1. Keep refinement unfinished. This previously unknown check was first observed at the owed revision, its failure has never been delivered, and the Stop still owes it.
3. Before the waiting entry's first read, append revision 2 with `r.apply()`, queue the same slow file at `slow2`, refresh the sink, land its failing result at `slow2`, and finish refinement at `"2"`. Both of the file's runs finished between hook reads.
4. Run the waiting Stop. It returns `{}`, leaves the consumer idle, and leaves the slow check `fail/current` at revision 2.

For the **during-read** variant, do step 3 at `deps.now` call 2 instead of before the waiting entry starts. That is inside its first poll, after states and keys were fetched. Its first snapshot actually contains the owed revision-1 failure and unfinished refinement. Its next snapshot contains the same file's current revision-2 failure and completed refinement. It still returns silently.

```text
claude-code, before first read: quick={}, waiting={}, turn=idle, slow=fail/current at 2
claude-code, during first read: quick={}, waiting={}, turn=idle, slow=fail/current at 2
codex,       before first read: quick={}, waiting={}, turn=idle, slow=fail/current at 2
codex,       during first read: quick={}, waiting={}, turn=idle, slow=fail/current at 2
```

The worker can turn the core schedule into a test directly:

```ts
const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 400 });
r.store.testFileKeys.remove(r.worktreeId, [SLOW_FILE]);
r.store.meta.set(refinedMetaKey(r.worktreeId), "0");
expect(decision(await harness.stop(r))).toEqual({});
slowKey(r, "queued");
landSlow(r, "fail"); // first observation at owed revision 1; not told
const moveAndFail = () => {
  r.apply();
  slowKey(r, "queued", "slow2");
  r.sink.refresh(r.worktreeId, 2, { checkpointId: null });
  landSlow(r, "fail", "slow2");
  r.store.meta.set(refinedMetaKey(r.worktreeId), "2");
};
moveAndFail(); // or call at deps.now call 2, inside the first poll
expect(decision(await harness.stopSlow(r)).decision).toBe("block"); // fails
```

Replacing the second failing run with a passing run returns silence in all four pass controls. Leaving the new file queued at revision 1 until the first poll observes it, then performing the same revision-2 move/completion during that read, blocks on failure and stays silent on pass in both harnesses. Thus the distinction is whether a poll saw a pending phase, not whether the file was owed or the current result failed.

**Cause:** the new listing obligation is evaluated only against the latest failure's `observedAt`. That field is the current own result's run revision, not the check's first observation (`src/core/state/derive.ts:99`, `:101`; existing semantics, not a separate finding). Once the next result replaces it, `2 <= handoff.revision` is false. The file was absent from `handoff.keys`, and `read` adds only non-current files to `seen`, so even a poll that saw its owed current revision-1 failure never retains membership. The live write transaction then accepts silence. The revision guard prevents an obsolete header; it does not preserve the obligation.

**One-worker fix:** retain or recover the unfinished listing's owed membership across result replacement and key moves, including a file that first completed before any waiting-entry read. Preserve the revision boundary and the exclusion of failures already told before the turn ended. Merely adding current failures to `seen` fixes the during-read variant but cannot fix the before-read variant. Do not redefine `KnownState.observedAt`, block on every existing slow failure, widen to unrelated later-listed files, or extend the deadline. Add both combined schedules, their pass controls and the observed-queued controls in both harnesses. Keep prompt/wake cancellation and the live write-transaction decision. This is the existing listing/handoff repair, with whatever bounded membership evidence it needs, not a watcher or idle-waiter change.

## Should-fix

### S1. The worktree-wide waiting-handler capability remains session-agnostic

**Plausible, non-blocking; unchanged 13am/13an S1.** `src/core/slow/stop-wait.ts:45`; `src/harness/shared/stop.ts:129`.

The waiting-handler marker remains shared by a worktree. One session can inherit evidence written by another session whose waiting handler runs. Spec 004 D9 says a missing or untrusted waiting entry “degrades to the old hold, never to none.” This review did not exercise a live trust/disable transition; the note remains outside 001-302 and belongs to planned row 001-297. Its worker should test two sessions sharing a worktree, only one with the waiting handler, and scope the capability to its consumer/installed handler or acknowledge that Stop within the short entry's budget.

## Nits

None.

## What fits

- `endTurn` now records `newTestFiles` alongside the owed keys and revision in the same transaction. Parsing an older handoff defaults the absent field to false. The idle waiter's own key-scoped rule is unchanged.
- The original 13an B1 before-read and during-read schedules, and their pass controls, are now explicit tests in `stop-slow-owed.test.ts`. At the handoff's revision, an untold completed slow failure is accepted even without a pending-phase observation.
- Original S2 for a file in `handoff.keys` is repaired: membership no longer requires the original key. Tests cover newer-key completion before the first read and between polls. Passing controls stay silent. The blocker combines that rule with a newly listed file absent from those keys.
- Tests keep known failures already told outside the new-listing obligation and exclude a file first failing only at a later revision without a pending observation. Those controls must survive the repair; a blanket current-failure filter is not acceptable.
- The original 13am B2 repair remains intact: the final decision re-reads revision, refinement, states, keys and idle ownership under the write transaction. A newer pending revision retries within the same wait budget, and delivery is guarded by the accepted revision.
- The repair changes neither the monotonic wait deadline nor the 600000 ms cap, 3000 ms handoff, 2 s short entry or 630 s waiting-hook timeout. It retains setting-off, active-Stop and subagent exits, and the atomic idle-to-turn claim. Existing tests exercise cancellation when a prompt/wake owns the turn and silence after the short entry speaks. No additional double block or timeout overrun was reproduced.
- Both committed plugin builds reproduce. The primer/skill findings and other settled 13am/13an matters were not reopened. Board and status were not edited.

## Inputs for the next wave

This third-round blocker goes to the human under the brief; the coordinator decides the next repair. S1 remains row 001-297. No code was rewritten by this review.

Keep the sequence: short Stop decides/delivers, then silent `endTurn` atomically records owed files and the unfinished-listing obligation; nudge the daemon; accept the fresh handoff; preserve the covered listing's membership across completion and newer keys; poll; decide from a live read under `BEGIN IMMEDIATE`; claim the idle turn once or cancel if another prompt/wake owns it; deliver only at the accepted revision. Keep one wait deadline and the existing hook budgets.

The fix row should start with the two combined schedules above in both harnesses, prove them red on `ba491ae6`, and retain the passing/observed-queued controls plus the candidate's unrelated-known-failure, later-revision and cancellation tests. The original separate B1/S2 schedules need no new investigation. The coordinator owns any spec amendment, bundle/version/key-format change, board/status bookkeeping and landing decision.
