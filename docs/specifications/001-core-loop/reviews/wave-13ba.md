# Wave 13ba review

## Verification

Reviewed `0ec7f837..c0c211f8`, the 001-322 landing, for review row 001-327. Candidate HEAD was exactly `c0c211f83de247451ea39727f4af931289cf58d0`. The tree was clean before verification and after the build. This is the bounded follow-up to wave 13aw S1; the earlier review's settled cases are not re-prosecuted. Only this findings file is committed. No board edits or eval runs.

Independent commands and output, 2026-10-13:

```text
$ git rev-parse HEAD
c0c211f83de247451ea39727f4af931289cf58d0
$ git status --short
(no output)

$ npm ci
added 56 packages, and audited 57 packages in 2s
found 0 vulnerabilities
exit 0

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npm run lint
> squeal@0.1.148 lint
> biome check .
Checked 978 files in 500ms. No fixes applied.
exit 0

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npm run typecheck
> squeal@0.1.148 typecheck
> tsc --noEmit
exit 0

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npm run build
> squeal@0.1.148 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.148 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
exit 0
$ git status --short
(no output: both committed plugin builds reproduce)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run --maxWorkers=4
FAIL test/cli/remove.test.ts > squeal remove > deletes nothing and exits 1 while a daemon will not let go of its lock
Error: Test timed out in 5000ms.
test/cli/remove.test.ts:137:3
FAIL test/cli/setup/setup-flow.test.ts > squeal setup --yes > offers an outdated repository its upgrade
Error: Test timed out in 5000ms.
test/cli/setup/setup-flow.test.ts:155:3

Test Files  2 failed | 457 passed | 1 skipped (460)
     Tests  2 failed | 3870 passed | 10 skipped (3882)
  Start at  18:29:21
  Duration  955.15s (tests 96%, import 2%, transform 1%)
exit 1
$ git status --short
(no output)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run test/cli/remove.test.ts test/cli/setup/setup-flow.test.ts --maxWorkers=1
Test Files  2 passed (2)
     Tests  18 passed (18)
  Start at  18:45:36
  Duration  5.80s (tests 76%, transform 19%, import 6%)
exit 0
$ git status --short
(no output)
```

npm warned about the unknown `store-dir` environment config and the unapproved install scripts of `@parcel/watcher@2.6.0` and `esbuild@0.28.2`. Installation and build succeeded without changing install policy.

This was the reviewer's independent full run, not Squeal's checkpoint. Its two failures were the default five-second test deadlines in unchanged CLI suites. The host's one-minute load was 43.51 near the start, 58.51 during the run and 25.41 after the isolated follow-up. Both files passed once in isolation on the same clean candidate. A passing full-suite gate remains **unverified**: the isolated pass does not replace the exit-1 gate. These timeouts are not findings against this wave. The changed harness suite and the key-format guard passed in the full run.

The disposable SQLite probe below ran with `node --disable-warning=ExperimentalWarning --import tsx --input-type=module` against the candidate's source modules. Its schedules, output and limits are recorded with B1. The two targeted mutation runs described under What fits used a disposable archive; their expected failures establish test discrimination, not a passing candidate gate. The candidate itself stayed clean through every verification command and probe.

## Verdict

**FAIL c0c211f8.** One proven blocker, no separate should-fix findings, no nits. The original S1 failure is repaired when registration timestamps differ, but remains when a timestamp is reused. The blocker concerns the lifecycle guarantee added by this delta.

## Blockers

### B1. Two registrations in the same millisecond inherit the same waiting marker

**Proven.** `src/core/slow/stop-wait.ts:64-67`, `:82-85`; the tests avoid this case at `test/harness/stop-slow-wait.test.ts:31-35`, `:127`, `:136`.

Row 001-322's done-when: "mark, unregister, turn the handler off, register the same consumer again; its Stop blocks on slow files as an unmarked one does." The new lifetime comment promises that "the evidence is one registration's" and that a registration again "starts unmarked." Spec 004 D9 requires a missing or untrusted waiting entry to degrade "to the old hold, never to none."

`registeredAt` is a wall-clock millisecond, not a unique registration identity. The existing delivery registration obtains it from `Date.now` and stores it unchanged; unregister and expiry do not remove the Stop-wait slot. If the next registration has that same timestamp, `stopWaitRuns` accepts the previous registration's marker. `recordStopWait` would also skip rewriting it. With the waiting handler absent, the short Stop is silent although the slow test is queued. Repeated timestamps need no corrupt store, unusual marker or fake clock.

A disposable source-module probe used a real SQLite store, the public `createDelivery().register/unregister`, the real `Date.now` and the real shared `stopTurn` with a stubbed healthy daemon. It seeded one queued `test/slow.test.ts`, enabled `stop.requireSlowSuite`, and repeated this schedule until two timestamps matched:

1. Register the consumer in a turn; record its waiting marker at the current harness/version.
2. Unregister. Verify the absent consumer reads unmarked.
3. Register the same consumer again in a turn, without invoking the waiting handler.
4. If the timestamps match, read the marker and call the short Stop.
5. Clear only the marker row, then call the same short Stop as a control.

Both harness paths reproduced on attempt 11, with the production clock:

```text
claude-code first=1791909041203 second=1791909041203
oldMarkerAccepted=true; short Stop=null; cleared-marker controlBlocks=true
codex first=1791909041237 second=1791909041237
oldMarkerAccepted=true; short Stop=null; cleared-marker controlBlocks=true
control reason in both cases:
Squeal policy stop.requireSlowSuite is on and 1 slow test file is not current at revision 0: test/slow.test.ts. `squeal run --slow --wait` runs them and waits for their results.
```

The proof is through the actual delivery and Stop interfaces; no live Codex trust change or Claude resume was run. The probe closed and removed its private store, and wrote no repository file. A wall-clock adjustment can also reuse a timestamp, but is not needed for the proven case.

**One-worker fix:** invalidate the consumer's Stop-wait slot atomically whenever a new registration replaces an old one, including unregister/expiry followed by registration and startup/resume without SessionEnd. Alternatively, use a registration identity guaranteed fresh independently of the wall clock, kept in compatible consumer meta data. Do not clear it on compaction of a still-registered consumer. Own the helper, the smallest delivery/session lifecycle seam needed, and both harnesses' tests; keep the store schema compatible. Add deterministic equal-timestamp controls for both resume schedules. Keep the timestamp-different and compaction cases. Rebuild both bundles, raise the patch version and refresh the unreleased key-format pin if required by the guard. No sleeps or larger hook budgets are needed.

## Should-fix

None separate from B1. The `nextMs()` gap belongs to B1's regression coverage: both invalidation tests deliberately wait for the discriminator to change and therefore cannot rule out timestamp reuse.

## Nits

None.

## What fits

- For different registration timestamps, the reader rejects the old slot. It returns false while the consumer is absent; the writer does nothing for an absent consumer and checks/writes inside the store transaction. The `(store, consumer, harness, version)` interface and both Stop callers are unchanged.
- A still-registered main consumer's `compact` path returns the primer before re-registration (`src/harness/shared/session.ts:52-53`), so it retains both `registeredAt` and its marker. Both compaction tests discriminate against dropping the marker, as verified below.
- Both legacy shapes read unmarked: a worktree-wide `{harness: version}` and a per-consumer `{harness: version}` without `registeredAt`. The real-store probe tested both shapes for each harness. An absent-consumer marker write left `{}` unchanged. No migration turns historical capability into current evidence.
- The three new tests run for Claude Code and Codex. In a disposable archive of the candidate with its installed dependencies linked, restoring only `stop-wait.ts` from `0ec7f837` and running `test/harness/stop-slow-wait.test.ts -t 001-322 --maxWorkers=1` yielded `4 failed | 2 passed | 25 skipped`: the two resume cases fail in each harness; compaction still passes. Restoring the candidate helper but forcing `stopWaitRuns` to return false, then running `-t 'compaction.*001-322'`, yielded `2 failed | 29 skipped`. Each compaction assertion received a pending-slow block instead of `{}`. These are deliberate mutation failures, not failures of the candidate. The archive was deleted before filing. They prove the intended distinctions, with the equal-timestamp coverage gap identified in B1.
- The changed built Stop readers/writers match the source in both plugins; the other bundle changes are the `0.1.148` version. The build reproduces them. Key format remains 9 with its unreleased hash re-pinned; this delta does not alter result keys, stored results, revision validity or header counts.
- The short Stop gains only synchronous store reads. Its 2 s budget, the 3000 ms handoff and the 600000 ms wait cap under the 630 s waiting-hook timeout remain unchanged. Disabling a waiting handler within one registration remains an explicitly documented limit outside this repair.

## Inputs for the next wave

Dispatch B1 as one lifecycle repair. A new registration must forget earlier waiting capability even when the clock repeats. A still-running consumer's compaction must retain it. The waiting entry records the current consumer/harness/version before checking the handoff; the short entry defers only on that registration's marker; an unmarked consumer blocks immediately on pending slow files. Do not restore or park capability evidence with attribution history, and do not turn a legacy marker into a current one.

Keep marker writes and lifecycle invalidation in the registration's transaction. Preserve the 2 s short Stop, 3000 ms handoff and 600000 ms waiting cap. Keep the existing two-session, wrong-harness/version, setting-off and compaction controls. Add both equal-timestamp resume schedules without waiting for a tick. Verification of live handler trust/disable transitions remains outside this review; no evals are needed to settle the store-level defect.
