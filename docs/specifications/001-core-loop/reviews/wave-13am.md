# Wave 13am review

## Verification

Reviewed `bea3ad42..95ad49f5`, board rows 001-285 and 001-283, under the 001-289 brief in `tasks/wave-13.md`. Candidate HEAD was `95ad49f504101d395d096dfdf33c9c2cbaa0e18f`. The tree was clean before and after every candidate check. No product, board or spec changes were made. The report is the only committed change.

Independent commands and output, 2026-10-12. Lint, typecheck, build and every Vitest invocation used `env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null`. This is the reviewer's own full run, not a Squeal checkpoint.

```text
$ git rev-parse HEAD
95ad49f504101d395d096dfdf33c9c2cbaa0e18f
$ git status --short
(no output)

$ npm ci
added 56 packages, and audited 57 packages in 5s
found 0 vulnerabilities
exit 0

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npm run lint
> squeal@0.1.128 lint
> biome check .
Checked 893 files in 1037ms. No fixes applied.
exit 0

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npm run typecheck
> squeal@0.1.128 typecheck
> tsc --noEmit
exit 0

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npm run build
> squeal@0.1.128 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.128 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
exit 0
$ git status --short
(no output: both committed plugin builds reproduce)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run
Test Files  5 failed | 412 passed | 1 skipped (418)
     Tests  14 failed | 3335 passed | 9 skipped (3358)
  Start at  11:17:04
  Duration  350.00s (tests 94%, transform 3%, import 3%)
exit 1
```

`npm ci` also warned that the install scripts of `@parcel/watcher@2.6.0` and `esbuild@0.28.2` were not covered by `allowScripts`. Build succeeded without approving or changing them.

The full run encountered host limitations: load reached 90 on 24 CPUs; `test/integration/node-test.test.ts` and `test/watcher/change-feed.test.ts` reported `ENOSPC: System limit for number of file watchers reached`; the CLI, bundle-parse and reconciliation tests timed out. At the coordinator's instruction, each failed file was run separately with `npx vitest run <file> --maxWorkers 1`, then again after stopping this worktree's daemon with the installed absolute Squeal CLI. Both sets ran on the clean candidate with the same isolated Git/session environment:

| File | Before stopping daemon | After stopping daemon |
| --- | --- | --- |
| `test/cli/codex.test.ts` | 13 passed, exit 0 | 13 passed, exit 0 |
| `test/integration/node-test.test.ts` | 1 passed, exit 0 | 1 passed, exit 0 |
| `test/harness/codex/plugin.test.ts` | 15 passed, exit 0 | 15 passed, exit 0 |
| `test/watcher/change-feed.test.ts` | 10 passed, exit 0 | 10 passed, exit 0 |
| `test/watcher/reconcile-pass.test.ts` | 1 skipped, exit 0 | 1 skipped, exit 0 |

The reconciliation timing assertion is **unverified** at calm load. A passing independent full suite is also **unverified** here: the sole full run exited 1, and isolated passes do not replace it. None of those environmental failures is a finding against this wave.

Discriminating probes used the freshly built source modules, two real SQLite connections to disposable fixture stores, the recorded inputs of both harnesses, and `runHook`/`runCodexHook`. They changed no repository files and used no real agent tooling or HOME state. `SQUEAL_HOOK_DEBUG=1` produced no swallowed errors. The throwaway probe was removed before committing; the schedules and outputs are retained below so the repair worker can turn them into tests.

## Verdict

**FAIL 95ad49f5.** Two proven blockers, one plausible should-fix note, no nits. The blockers are the waiting Stop's loss of a slow failure at handoff and its acceptance of an obsolete completion snapshot. Neither depends on load, watcher availability or the full-suite failures.

## Blockers

### B1. A slow failure can land between the Stop entries and receive no continuation

**Proven.** `src/harness/shared/stop-slow.ts:93`, `:97`, `:181`.

The 001-285 outcome says: "A slow failure blocks once with the failure." Spec 004 D9 says: "A failure among them: one block naming it, with the delta." In a headless session a missed block leaves the final answer in place; there is no idle wake to repair it.

Reproduction in both Claude Code and Codex:

1. Seed a passing fast file and a queued slow file at revision 1. Set `stop.requireSlowSuite: true`, and record that this harness's waiting entry runs at this version. Register the main consumer and start its turn.
2. Run the 2 s `stop` entry. It returns no output and records the slow file in the idle turn's pending-file set.
3. On the fixture's daemon connection, store that slow file's current failing result and clear its pending phase, as the scheduler/sink do.
4. Run `stop-slow` on the same recorded Stop input. It also returns no output. The consumer stays idle and the failure is current.

```text
claude-code: quick="", waiting="", current slow failures=1, turn=idle
codex:       quick="", waiting="", current slow failures=1, turn=idle
```

The early `waited.open.length === 0` return discards that failure. There is a second boundary with the same consequence: the initial `read` sees the file open, but the result lands before the first `waitForSlow` read. The initial open set is never passed into the wait, which initializes `seen` empty. Its first poll sees the file already current, adds nothing to `seen`, and the failure filter removes it. This variant was reproduced by using the waiting entry's `deps.now` second call, inside the initial read after its states and keys were fetched, to commit the failure from the other connection. Both harnesses returned empty output with one current slow failure and an idle consumer. Replacing the failure with a pass in the handoff schedule correctly produced silence, the negative control.

**Worker-sized fix:** preserve the files owed at the short entry's silent end, including its recorded keys, and seed the waiting entry's tracked files before any completion read. Include files the initial read sees open. Decide and deliver a current failure of those files even when it completed before the waiting entry's first poll. Keep the existing cancellation when a prompt or idle wake has already taken the turn. Add both schedules as tests in both harnesses, with pass controls. The current tests land the result 200 or 300 ms later, after tracking has begun, so they miss both boundaries.

### B2. The waiting Stop's silent decision is not protected against a newer revision or unfinished listing

**Proven.** `src/harness/shared/stop-slow.ts:94`, `:99`, `:125`, `:192`.

Spec 001 goal 3 requires truth "at the moment it is told"; D2 requires that "headers, status and every wait treat a revision ahead of [the refined revision] as pending." The 001-285 done-when requires holding while the slow tier is not current. The short Stop already guards its silent end with `delivery.endTurn(..., { atRevision })` in `src/harness/shared/stop.ts:145`. The new waiting entry has no equivalent guard before either silent return. Its block-taking transaction checks only registration and the idle turn, not whether the snapshot still describes the current revision.

Reproduction in both harnesses, using the same fixture as B1:

1. The short Stop silently ends revision 1 with the slow file queued.
2. During the waiting entry's first poll, commit that file's passing result from the daemon connection. The poll's existing read transaction still sees it open, so the next poll will decide completion.
3. During that next poll, after it fetched passing states and keys but while it holds that old read snapshot, commit revision 2, move the slow file to key `slow2`, mark it queued and refresh its state from the other connection.
4. The waiting entry returns no output from its revision-1 snapshot. The store is already at revision 2 with the slow file queued, and the consumer remains idle.

```text
claude-code: quick="", waiting="", revision=2, queued=slow2, turn=idle
codex:       quick="", waiting="", revision=2, queued=slow2, turn=idle
```

The deterministic injection uses `deps.now`: its third call lands the pass, its fourth commits/rekeys revision 2. Those calls occur after `read` fetched states and keys. The writes succeed on the separate SQLite connection; the reader retains its old snapshot. There are no prompts or wakes, so cancellation does not explain the silence.

An additional completion gap is visible without a concurrent write: with all listed slow files current, latest revision 1 and `refinedMetaKey(worktreeId)` set to `0`, both entries return silently. The waiting entry has read a header whose runner part is pending but ignores it. A new matching slow file can be in that unfinished listing. This probe also returned empty output in both harnesses. Treat this as another variant of accepting incomplete completion evidence, not an additional blocker count.

**Worker-sized fix:** accept completion against the live revision in a transaction, and retry when the revision moved. Do not accept an empty open-file list while `header.runnerPartPending` is true. Keep one overall wait deadline across retries; at the bound, report the pending refinement as pending rather than claiming that no slow work is owed. Guard block reasons as well as silent completion so an old failure cannot be presented beside a newer header. Restore read-boundary tests for the waiting entry, with daemon commits from a second connection; the removed `stop-require-slow-snapshot.test.ts` exercised this kind of boundary for the short entry.

## Should-fix

### S1. A worktree-wide marker is evidence of a past hook run, not this session's hook availability

**Plausible, non-blocking.** `src/core/slow/stop-wait.ts:45`, `src/harness/shared/stop.ts:128`.

The marker stores only `{ harness: version }` per worktree and never expires with its consumer. Spec 004 D9 describes the fallback as "a missing or untrusted waiting entry degrades to the old hold, never to none." A different Codex session using another config/launcher, or a session whose waiting hook is disabled after it once ran, can share that marker while its short Stop is still enabled. The short entry will defer to an entry that does not run there. The historical lookup is established in source; the concrete harness trust/disable transition was not exercised with a live Codex process, so this is not blocking.

**One-worker follow-up:** scope the capability evidence to the consumer/session and installed handler identity, or arrange an acknowledgement for the current Stop. Test two sessions in the same worktree, only one with the waiting handler, and document the supported fallback lifetime. Preserve the 2 s entry's budget. A new turn/session must not inherit a capability solely because another session had it.

## Nits

None.

## What fits

- The source and committed bundles reproduce on build. Both plugins include `stop-slow` beside the short Stop, with timeout 630 s. The wait cap is 600000 ms, handoff budget 3000 ms and default 120000 ms; the configured timeout leaves room for the handoff and normal store/output work. No hook-timeout overrun was reproduced.
- Both adapters call the shared functions with the right harness and `stopHookActive` fields. The setting-off, active-Stop, SubagentStop, ordinary delayed pass/failure, bound, late-queued file and cancellation tests pass in the independent full run. The first unmarked Stop's fallback and the other-harness/other-version cases are covered. There is no demonstrated double block in those covered schedules.
- `read` takes states, keys, header and turn from one SQLite read transaction. B2 concerns acceptance of that snapshot after it becomes obsolete, not mixed statements inside the snapshot.
- The optional `SlowTierState.stopWaitMs` and rendering share the policy cap and leave it absent when off. The header no longer says slow files are outside Stop's wait when the setting is on.
- The 001-283 primer names `run --slow --wait 60000` before a claim and retains the configured runner list, uncovered-suite sentence, command fallback and 1500-character cap. Both harnesses' coverage and long-command tests pass. The skill moves red/green behind a named pointer, supplies observable completion criteria, and points at policy for the waiting Stop. The removed "never during Stop's wait" wording does not survive in these texts.
- The 13 findings in `research/primer-skill-writing.md` map to the actual levers in the pinned upstream `SKILL.md` and `SKILL-MECHANICS.md`, read as text for this review. Keeping mandatory material in the primer, preserving the human's prohibition, disclosing red/green, co-locating wait semantics and keeping the measured busy-host figure have the stated basis. No additional proven false coverage or wait claim was found in the rewrite.

## Inputs for the repair wave

One repair worker can own `src/harness/shared/stop-slow.ts`, the handoff data it needs in shared Stop/turn code, and the corresponding harness tests. Address B1 and B2 together; they share the transition from a short Stop's recorded obligations to an accepted waiting decision. Leave the primer/skill rewrite alone. S1 is a follow-up note unless the coordinator explicitly includes it.

The order must remain: short-entry delivery and policy decision; silent `endTurn` recording the owed files/keys and revision; bounded daemon nudge; waiting-entry handoff; seed the owed set before reading completion; wait through unfinished refinement and subsequent queued files; accept a live decision once, or cancel if another prompt/wake owns the turn. A passing file must stay silent, and one slow failure or the deadline must produce one continuation.

Keep the short entry within 2 s, cap slow waiting at 600000 ms under the 630 s hook timeout, and spend the existing deadline across read retries. Preserve setting-off and `stop_hook_active` exits and the absence of SubagentStop waiting. Add deterministic read-boundary schedules, not only longer timers. Verify the original blockers and pass controls in both harnesses; run the independent repository gate on the integrated repair. A calm-load full-suite pass remains for the coordinator's landing gate. The coordinator owns board/status updates and any bundle/version/key-format integration.
