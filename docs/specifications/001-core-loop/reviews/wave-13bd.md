# Wave 13bd review

## Verification

Bounded second review of wave 13ba B1 for board row 001-333. Range `cb427734..4db621b7`, commits `768b8a38` and `4db621b7`, candidate `4db621b75bb8f1d2de6d71734dfed487ce44e4ab`. Read wave 13ba first and wave 13aw S1 for the original goal. Prior settled findings are not re-prosecuted. Checks and source probes ran against the clean pinned candidate before this findings file was written. No product, board or status edits, eval runs or third-party agent runs.

Independent verification, 2026-10-13:

```text
$ git rev-parse HEAD
4db621b75bb8f1d2de6d71734dfed487ce44e4ab
$ git status --short
(no output)

$ npm ci
added 56 packages, and audited 57 packages in 1s
found 0 vulnerabilities
exit 0

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npm run lint
> squeal@0.1.150 lint
> biome check .
Checked 982 files in 331ms. No fixes applied.
exit 0

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npm run typecheck
> squeal@0.1.150 typecheck
> tsc --noEmit
exit 0

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npm run build
> squeal@0.1.150 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.150 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
exit 0
$ git status --short
(no output: both committed plugin builds reproduce)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run --maxWorkers=4
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/1ba2dfa4-2e28-47b0-b94f-bba050b863fe/test/fixtures/scheduler/.tmp/3613cd70-e55e-4192-abcd-8dfd0fc8a58c/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/1ba2dfa4-2e28-47b0-b94f-bba050b863fe/test/fixtures/scheduler/.tmp/ce4858d1-7a83-4fe4-9de2-2ee64fd93da9/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 3762767
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  460 passed | 1 skipped (461)
      Tests  3886 passed | 10 skipped (3896)
   Start at  19:23:24
   Duration  606.45s (tests 97%, import 2%, transform 1%)

    Isolate  461 workers spawned · ~167ms startup each (spawn + environment, per file)
             at least ~19.04s faster with isolate: false — reuses workers across files instead of one per file
exit 0
$ git status --short
(no output)
$ git rev-parse HEAD
4db621b75bb8f1d2de6d71734dfed487ce44e4ab
```

npm warned about unknown `store-dir` environment config and install scripts not covered by `allowScripts` for `@parcel/watcher@2.6.0` and `esbuild@0.28.2`. Installation and build succeeded without changing install policy. This is the reviewer's independent full run, not a Squeal checkpoint. The full gate passed once at the pinned clean candidate: 460 files passed, one skipped, 3,886 tests passed and ten skipped, exit 0 in 606.45 s. There were no load timeouts and no retry. The one-minute host load was 12.65 at launch, reached 76.51 during the run, and was 23.56 near completion. The fixture gitdir repair lines, stale-run cleanup line and experimental type-testing notices above did not fail the run.

## Verdict

**PASS 4db621b7.** Zero blockers, zero should-fix findings, one proven administrative nit. Wave 13ba B1 is fixed. No product repair is required by this review.

## Blockers

None. B1's real-clock schedule now starts the replacement registration unmarked and the short Stop blocks on its queued slow file in both harnesses.

## Should-fix

None.

## Nits

### N1. The board still describes the repair as running

**Proven, non-blocking administrative drift.** `docs/board.md:419`, `:425`. Row 001-322 still says review 001-327 is running, although row 001-327 at line 424 records its failure. Row 001-328 is still running although candidate commits `768b8a38` and `4db621b7` have landed the repair as 0.1.150. The task brief identifies this candidate as the landed repair. The process gives board ownership to the coordinator. This is status drift, not a product defect in the candidate range.

**Coordinator fix:** when folding this review, record the landed repair and this verdict on the affected rows. Do not dispatch a product worker for it. The reviewer left the board unchanged.

## What fits

### B1 and the registration seam

`src/core/delivery/delivery.ts:258-265` calls `forgetStopWait` immediately after the consumer registration, inside the same outer store transaction. `src/core/slow/stop-wait.ts:95-96` clears this consumer's slot through the established `writeSlot` interface, preserving other registered consumers and pruning absent ones. Every current harness registration path calls that delivery method: session/subagent start, first prompt, first tool boundary and short Stop fallback. There is no separate direct `store.consumers.register` path in the current harnesses. Subsequent prompts and tools for a registered consumer do not register it again.

A source-module probe used a private real SQLite store, real `Date.now`, public `createDelivery().register/unregister`, shared `stopTurn`, a stubbed healthy daemon, one queued `test/slow.test.ts` at revision 0 and `stop.requireSlowSuite` on. It repeated the first review's register, mark, unregister, register schedule until the two registration timestamps matched, then called only the short Stop, without running the waiting handler. It also cleared the marker row and repeated the Stop as the same control:

```text
claude-code real-clock attempt=13 first=1791912315399 second=1791912315399
oldMarkerAccepted=false; shortStopBlocks=true; clearedControlBlocks=true
codex real-clock attempt=9 first=1791912315440 second=1791912315440
oldMarkerAccepted=false; shortStopBlocks=true; clearedControlBlocks=true
```

Both blocks named the one slow file not current at revision 0 and the `squeal run --slow --wait` command. B1's equal production timestamp no longer inherits capability. A deterministic replacement at timestamp 1000 with no unregister also read unmarked. A forced error in a later registration statement rolled back both the consumer replacement and its marker deletion, retaining the earlier marked registration. Invalidation is atomic with registration, not a separate cleanup after commit.

### Lifetime and compatibility

The same source probe checked both harness marker names:

```text
claude-code and codex, each:
equal-clock replace-without-end unmarked=true
registered compaction retains marker=true
second consumer unmarked=true; first marker retained=true
expiry and equal-clock re-register unmarked=true; shortStopBlocks=true
legacy and older-registration markers unmarked=true; absent write no-op=true
failed registration rolls marker and consumer back=true
all lifecycle assertions passed
```

`src/harness/shared/session.ts:52-53` still returns the primer for compaction of a registered main consumer before calling register. No invalidation is reached. Startup/resume reaches register even when the main consumer has not ended; it does not depend on a SessionEnd cleanup. Expiry makes the reader false while absent, and registration clears the leftover slot even if its timestamp repeats. A waiting entry can mark the new registration again. Another registered consumer's marker survives the invalidation.

The timestamp check at `stop-wait.ts:69-72` remains unchanged. The probe seeded the legacy worktree-wide shape, a pre-001-322 per-consumer shape without `registeredAt`, and a timestamp-mismatched older registration's per-consumer shape. All read unmarked. An absent consumer's marker write changed nothing. The store schema and consumer columns are unchanged; historical markers are not migrated into fresh capability. Disabling a waiting handler within the same registration remains the documented limit; live harness trust/disable changes were not exercised.

### Tests and the handoff

The new deterministic tests pin both registrations to `AT`, assert that the timestamp was reused, and drive both harness adapters. In a disposable archive of `4db621b7`, removing only the `forgetStopWait(store, consumer)` call and running:

```text
$ vitest run test/harness/stop-slow-wait.test.ts -t 001-328 --maxWorkers=1
AssertionError: expected undefined to be 'block'
test/harness/stop-slow-wait.test.ts:168:54
test/harness/stop-slow-wait.test.ts:177:54
Test Files  1 failed (1)
     Tests  4 failed | 2 passed | 31 skipped (37)
Duration  3.60s
exit 1 (expected mutation failure)
```

Both resume schedules fail on each harness, and both compaction controls pass. This demonstrates that the new tests reject B1's implementation. The mutation is not a candidate gate failure. Probes and mutation ran with a scratch HOME and no live agent CLI; private stores and the archive were removed. The candidate remained clean.

`src/harness/shared/stop-slow.ts` is unchanged in this range, so the reviewed 001-326 handoff algorithm is not reopened. The per-consumer reader/writer and wrong-harness/version checks are unchanged. The complete independent candidate suite passed, including the changed 37-test Stop-wait suite, its two-session control and the existing handoff/untold-failure suites. No 001-297 or 001-326 regression was observed.

### Builds, version and keys

Both committed `plugins/*/dist` trees match `npm run build` without drift. All four version files say 0.1.150: the root package, Claude Code package and the two plugin manifests. Built registration paths contain the same marker deletion as the source; built Stop paths retain the timestamp guard. The waiting Stop bundle's changed behavior comes from its delivery dependency, not a change to `stop-slow.ts`.

`KEY_FORMAT_VERSION` remains 9 and its pin is `211f7aaa3d85c1d31cd4c35eddabf680551155885f9766000c146f7ac19e166f`. The guarded `src/core/slow/stop-wait.ts` changed, so the source fingerprint must move. The delivery source is exempt from that fingerprint. Re-pinning 9 is consistent with the explicit unreleased candidate scope: the latest repository release tag, `squeal--v0.1.131`, has key format 8. No shipped format-9 pin is overwritten within the task's stated release history. The delta changes consumer capability metadata, not stored results, result-key meanings, revision validity or status counts. The key-format guard passed in the full independent run.

## Inputs for the next wave

No blocking fix wave is needed. The coordinator can close B1 and fold N1 into the board. Keep all registrations through `createDelivery.register`: its marker invalidation must commit with the registration, before another connection can observe it. Call `recordStopWait(store, consumer, harness, version)` only for the current registered consumer; the waiting entry records that evidence before its handoff check. A registered main consumer's compaction must continue to bypass registration. Do not restore or park capability evidence with attribution history.

Preserve the 2 s short Stop, the process-start-based 001-326 handoff slack and the 600000 ms waiting cap under the 630 s hook timeout. Keep the two-consumer, equal-timestamp resume, compaction and wrong-harness/version controls. The separate 001-332 handoff-test suggestions from wave 13bc remain outside this bounded repair review. No new public interface or store schema is needed.
