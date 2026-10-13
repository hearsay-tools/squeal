# Wave 13aw review

## Verification

Reviewed `b167429e..75258812`, the 001-297 landing, for review row 001-319. Candidate HEAD was exactly `75258812701304dc39698902e14147c860ff7d0a`. The tree was clean before verification, after the build, and after both Vitest runs and the disposable probes. Only this report is committed. The board and product were not edited. No eval sessions were run.

Independent commands and output, 2026-10-13:

```text
$ git rev-parse HEAD
75258812701304dc39698902e14147c860ff7d0a
$ git status --short
(no output)

$ npm ci
added 56 packages, and audited 57 packages in 1s
found 0 vulnerabilities
exit 0

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npm run lint
> squeal@0.1.144 lint
> biome check .
Checked 979 files in 510ms. No fixes applied.
exit 0

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npm run typecheck
> squeal@0.1.144 typecheck
> tsc --noEmit
exit 0

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npm run build
> squeal@0.1.144 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.144 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
exit 0
$ git status --short
(no output: both committed plugin builds reproduce)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run --maxWorkers=4
FAIL test/cli/codex-trust.test.ts > squeal init --harness codex --trust --yes against Codex > installs the plugin from this checkout under the hub's name, trusts every Squeal hook, and only Codex writes
AssertionError: expected { code: 1, ... } to deeply equal { code: 0, stderr: '' }
Received stderr: squeal init: codex app-server did not answer initialize within 10 s
test/cli/codex-trust.test.ts:349:42

Test Files  1 failed | 456 passed | 1 skipped (458)
     Tests  1 failed | 3840 passed | 10 skipped (3851)
  Start at  16:28:50
  Duration  717.70s (tests 97%, import 2%, transform 1%)
exit 1

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run test/cli/codex-trust.test.ts --maxWorkers=1
Test Files  1 passed (1)
     Tests  13 passed (13)
  Start at  16:41:12
  Duration  4.78s (tests 74%, transform 20%, import 5%)
exit 0
$ git status --short
(no output)
```

npm warned about the unknown `store-dir` environment config. Installation also warned that `@parcel/watcher@2.6.0` and `esbuild@0.28.2` install scripts were not covered by `allowScripts`. No approvals or install-policy changes were needed for the successful build.

This was the reviewer's own full run, not Squeal's checkpoint. Its only failure was the external Codex app-server's initialization deadline, before hook discovery or execution. The trust implementation, its test and the plugin's hook declarations are unchanged in this range. The failed file passed once in isolation on the same clean candidate. Host load was 62 on the full run. A passing independent full suite remains **unverified**: the isolated pass does not replace the exit-1 gate. The timeout is not a finding against this wave.

The full run passed the changed harness suites (`stop-slow-wait`, `stop-require-slow`, `stop-retry-bound`) and the key-format guard. Disposable `node --import tsx --input-type=module` probes used source modules and real SQLite stores under private temporary directories. They wrote no repository files, ran no real agent session and removed their stores in `finally`. Their schedules and outputs are retained below.

## Verdict

**PASS 75258812.** Zero blockers, one proven non-blocking should-fix note, no nits.

This is the bounded review of row 001-297 and wave 13am S1. The distinct-session hole and the row's two-session done-when are closed. The new delta exposes the lifetime note below. The earlier review's B1/B2 repairs are outside this range and are not re-prosecuted here.

## Blockers

None.

## Should-fix

### S1. The marker survives the end of its consumer registration

**Proven, non-blocking lifecycle note.** `src/core/slow/stop-wait.ts:24`, `:57`, `:69`.

The new lifetime comment says, "The evidence lasts while the consumer is registered" and that a disabled waiting entry's slot stays "until the session ends." The actual lifetime can span an unregister and a resumed registration of the same consumer. `readSlot` reads its persisted slot without testing registration; the unregister path does not clear this kind of slot. Pruning happens only when `writeSlot` writes this particular row while the consumer is absent. Ordinary writes of turn, liveness or other slot kinds do not prune it, and `recordStopWait` skips its write when the current consumer's marker already matches.

SQLite reproduction through the public delivery interface:

1. Register main consumers A and B in one worktree. Record A's Codex waiting entry at `0.1.144`.
2. `delivery.unregister(A)`, then `delivery.register(A)`, with no waiting-marker write between them.
3. A's marker remains true. A resumed launcher with its waiting entry missing still defers to that entry.
4. Unregister A again, then record B's entry. That write does remove A's slot.

```text
marked A / unmarked B: true false
A registration ended: true
A marker after unregister: true
A marker after re-register: true
A marker pruned by B write: true
```

A second probe seeded a queued `test/slow.test.ts` at revision 0, enabled `stop.requireSlowSuite`, registered and marked A, then unregistered and re-registered A in a turn. It invoked only the shared short Stop, with the current harness/version and a stubbed healthy daemon. The control cleared the marker row and invoked that same Stop again:

```text
resumed marker: true
resumed short Stop without waiting entry: null
marker cleared, short Stop blocks: true
control reason: Squeal policy stop.requireSlowSuite is on and 1 slow test file is not current at revision 0: test/slow.test.ts. `squeal run --slow --wait` runs them and waits for their results.
```

The store lifetime and shared Stop decision are proven. No live Codex trust change or alternate resumed launcher was exercised. This stays a follow-up note in this bounded review: the row's done-when concerns two distinct sessions, which pass, and the implementation explicitly retains the known mid-session-disable limitation.

**One-worker fix:** clear the consumer's waiting marker when its registration ends, including expiry, and establish fresh capability evidence for startup/resume of the same session ID. Preserve compaction within the same running session. Own the marker helper, the relevant delivery/session cleanup and both harnesses' lifecycle tests. Add the above unregister/resume schedule, a new-session control, and a test that compaction keeps the current running session's evidence. Update the comment to state the actual supported lifetime. Keep the short Stop's 2 s budget.

## Nits

None.

## What fits

- Both changed callers pass `(store, consumer, harness, version)` to the implemented interface. The consumer is `(worktree, session ID, agent ID or main)`, and the worktree still selects the meta row. `recordStopWait` encloses its read and `writeSlot` in one store transaction, as `slots.ts` requires.
- The new two-session test runs for both Claude Code and Codex. A's marker is present; B's short Stop blocks with the expected pending-slow reason; A's short Stop remains silent. It also asserts B's marker is false and A's remains true. The existing unmarked test invokes the real waiting entry and checks that it records its consumer, so the synthetic marker in the new isolation test is supported by an independent writer test.
- A stored legacy worktree-wide row containing both harness names at the current version is ignored. The probe registered A and B, seeded `{ "codex": "0.1.144", "claude-code": "0.1.144" }`, then read both consumers: `legacy row ignored: true`. An old row has no `session\nagent` slot and cannot authorize either session's deferral. A new write discards those legacy entries through the registered-slot filter.
- The new allowed seam is exactly `src/core/slow/stop-wait.ts -> src/core/delivery/slots.ts`, with a reason in `test/keys/key-format.test.ts:64`. The imported helpers only read/write consumer meta slots and inspect registered consumers. They cannot key, execute or record a test result. The guard still checks all guarded-to-exempt imports and detects changes to guarded sources. Version 9's hash was re-pinned as unreleased in `cb4fb75a`; the latest release recorded in status shipped version 8.
- The committed Claude Code and Codex bundles use consumer slots at both Stop entries and reproduce without drift. The patch version is `0.1.144`. The change introduces no asynchronous work or additional waiting into the short Stop. The waiting cap, handoff budget, setting-off exit and subagent exclusion are unchanged.
- No new stale-result or misleading-current-status path was found in this delta. Marker scope decides who holds the agent; it does not change result validity, revision provenance, stored results or header counts.

## Inputs for the next wave

No blocking fix wave is required for the distinct-session scope change. The coordinator owns the board/status closure and may dispatch S1 separately.

Keep the call order: the waiting entry records its own consumer/harness/version before checking handoff; the short entry defers only on that same consumer's matching marker; an unmarked consumer retains the immediate pending-slow block. Keep writes to the shared slot row inside a store transaction. Do not translate a legacy worktree-wide marker into per-consumer evidence. Clear stale evidence at lifecycle boundaries rather than waiting for an unrelated consumer's next marker write.

Preserve the short Stop's 2 s budget, `STOP_SLOW_HANDOFF_MS` of 3000 ms and the 600000 ms waiting cap under the 630 s hook timeout. Retain the distinct-session and wrong-harness/version controls in both adapters. A same-session-ID resume without the waiting entry remains the missing regression case; a live trust/disable transition and a passing independent full-suite gate remain unverified here.
