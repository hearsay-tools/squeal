# Wave 14: candidate 0.1.196 (001-417)

**FAIL** `e135650e84dd743113ad72086617bd3a1230e81f`: **4 proven blockers, 2 proven should-fix, 1 proven nit**. One additional integration limit is unverified and nonblocking.

## Verification output

Range: `origin/main` (`90c114f8b0685a2e67915467c267a1b7b39aa17e`, package version 0.1.195) to `e135650e`. There is no local `0.1.195` tag. HEAD matches the assigned candidate. Checks run before writing this file, on the clean candidate; no product code changed. Temporary probes use the candidate's freshly built `dist` modules and private temporary stores, and clean their stores afterwards.

```text
$ git rev-parse HEAD
e135650e84dd743113ad72086617bd3a1230e81f
$ git status --short
(no output)

$ npm ci
added 196 packages, and audited 197 packages in 8s
found 0 vulnerabilities
(exit 0; also one deprecation warning and the six-package install-script allow-list warning)

$ npm run lint
> squeal@0.1.196 lint
> biome check .
Checked 1315 files in 502ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.196 typecheck
> tsc --noEmit
(exit 0)

$ npm run build
> squeal@0.1.196 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.196 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
(exit 0)
$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist plugins/pi/dist plugins/opencode/dist
(no output; exit 0)
$ git status --short
(no output)
```

Independent full suite, required by the reviewer role (not a Squeal checkpoint), finished with **exit 1**. It acquired the host lock after roughly 13 minutes and ran for 672.28 seconds. HEAD and the clean tree were checked again afterwards, before writing this review. Sampled host load during the run was about 6.6 to 11.5 on this shared host.

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/db16eb51-f393-4760-a2bb-da95d54c5385
 Test Files  6 failed | 636 passed | 1 skipped (643)
      Tests  20 failed | 5317 passed | 10 skipped (5347)
   Start at  16:33:15
   Duration  672.28s (tests 98%, import 2%)
(exit 1)

$ git rev-parse HEAD
e135650e84dd743113ad72086617bd3a1230e81f
$ git status --short
(no output)
$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist plugins/pi/dist plugins/opencode/dist
(no output; exit 0)
```

Nineteen failures end at `test/e2e/agree.ts:27` or `:34`: its old parser cannot read the intentional new header (S2). A representative failure:

```text
FAIL test/e2e/lifecycle.test.ts > a dead daemon, claude-code > is replaced by the next SessionStart
AssertionError: header line in:
Revision 1 · 96529ded + 1, dirty (changed src/math.ts): 5 current (3 tests, 2 test files loaded), 0 pending, 0 stale, 0 unknown. ...
expected null not to be null
  expectAgrees test/e2e/agree.ts:34:49
```

**Unverified cause of the twentieth failure:** pytest / Claude Code / Python 3.10 / “inherits into synced worktrees and waits for an unsynced one” throws `ENOENT` reading `runs/<run-id>/pytest/python%2Fbilling/run.json` from `storeEvidence` (`test/e2e/pytest.test.ts:157`). `withEvidence` calls that diagnostic in its catch before rethrowing the original error, so this output does not establish the original failure. That diagnostic helper predates the range; this is verification evidence, not another wave blocker. No full-suite rerun was used to replace the red result.

Reviewed rows 001-403, 001-404, 001-405 including W2b, 001-406, 001-409, 001-410, 001-411, 001-415 and 004-61, their notes, `tasks/wave-14.md`, spec 001 D2/D5/D6/D7/D9/D10/D11/D12, spec 004 D2 and the amendment logs. The findings below apply to this candidate, not its future repair.

## Blockers

### B1. A lane label ages out while its checkpoint remains, creating a false full-suite claim

**Proven.** `src/core/store/repos/runs.ts:105`, `:119`, `:152`; surfaced by `src/core/state/header.ts:89`.

004-61's done-when: “A one-lane run is not a full-suite checkpoint: the header and verdict say which lane completed.” Vision principle 2 forbids unexecuted tests presenting as validated.

`writeLane` keeps only 32 labels. `lastCompletedFull` treats every completed checkpoint absent from that map as full. It neither removes the corresponding old checkpoint nor establishes that a real full run superseded it. After 33 fast-only requests, the first fast-only record becomes a full run to the current reader. This is separate from the documented downgrade behavior of an older reader.

Probe: create one worktree and revision 1 in a real store. For `i = 1..33`, call `store.checkpoints.start({ id: 'fast-'+i, kind: 'run-all', worktreeId, revision: 1, testFiles: [], startedAt: i, lane: 'fast' })`, then `finish(id, 'completed', i)`. Empty fast checkpoints are valid when every fast file is already current. No full checkpoint is inserted.

```text
32 records: lastCompletedFull = null
fullSuite.atCurrentRevision = false
Full-suite checkpoint: none completed at any revision; only the fast lane completed, at revision 1 ...

33 records: lastCompletedFull.id = fast-1 (lane now absent)
fullSuite.atCurrentRevision = true
Full-suite checkpoint: completed at revision 1
```

**Repair:** preserve enough durable identity to distinguish full from one-lane records for their entire lifetime. A cap must not turn a forgotten lane into evidence of a full run. Keep compatibility with the shared schema. Test more than 32 lane records with no full run, with a real older full run, and with abandoned lane requests evicting completed ones. Assert the stored record, header and `stop.requireFullSuite` view.

### B2. A quiet rest still emits a down-daemon warning when other news needs a header

**Proven.** `src/core/delivery/liveness.ts:177` suppresses only the liveness transition; `src/core/delivery/delivery.ts:199` reads a normal down header through `src/core/delivery/liveness.ts:73`.

D10's new rule: “While the record is cleared and no heartbeat came after that time, the worktree's daemon rests: no delivery tells a consumer that no daemon is validating.” The restart must still be reported failed once its 10-second grace expires. Status deliberately remains down throughout.

A registered consumer can have an undelivered failure when the daemon finishes its work and later stops unused. Its next hook starts a successor. `livenessChange` returns null during the rest's grace, but the failure still needs delivery. `readLiveHeader` marks that delivery's header down and `formatDelta` prints the warning the rest rule was intended to prevent. The existing rest tests have no pending delta.

Probe through `createDelivery`: register while the daemon is alive and a check passes; store its fail without delivering it; `markRest(..., 200)`, clear the daemon record, `spawnedAfterRest(..., 300)`, then `onToolBoundary` at 301. The last heartbeat is 100. `restState(...)` is `quiet`, but output contains:

```text
SQUEAL · 1 check changed (1 test) at revision 1
... No daemon has validated since 1970-01-01T00:00:00.100Z; results are as of revision 1.
FAIL  a.test.ts > fails
      PASS -> FAIL, seen by Squeal's run at revision 1
```

**Repair:** carry the quiet-rest decision through delivery header rendering, including headers attached to actual news and policy reports. Keep public status truthful; do not turn a resting daemon into an alive one. Add a regression with undelivered failure news, and one with edit-summary news. Keep the overdue-restart test: a failed start must still become a down warning after 10 seconds, and a later real stop must not be hidden by an old mark.

### B3. A failure's age is looked up at its new key, not from the result that produced the failure

**Proven.** New `recordedAt` attachment at `src/core/retry/recorded.ts:76`, used by the new status path at `src/core/status/snapshot.ts:125`; the existing lookup at `recorded.ts:65-69` assumes the current key identifies the displayed outcome.

001-404's outcome and done-when cover every known-failure line in registration and status, dating the run that produced it. A stale or pending failure is still included in `Known failures`.

After a failing file re-keys, its old failure remains known while the new inputs await validation. `withRecorded` looks only at the file's current key. With no row there, it returns the failure without an age, although the producing result is still stored. If another worktree has cached a pass at that new key before this worktree applies it, the function attaches that pass's timestamp and run load to the old failure; it does not even check the row's outcome or fingerprint. A same-key replacement can cause the same mismatch.

Probe: retain a fail at `old-key`, recorded at 100, and its pending known state. Move `testFileKeys.key` to `new-key`. Public `readStatus` / `formatStatus` prints:

```text
Known failures: 1 (1 test)
  FAIL  a.test.ts > fails
        old fail
        observed at revision 1, pending
```

There is no recorded line. Insert a pass at `new-key`, recorded at 500, without changing the known failure. `withRecorded` now reports that failure's `recordedAt` as **500**, the pass's timestamp.

**Repair:** resolve the trusted producing result for the displayed known state, including its origin, observed revision, outcome and fingerprint, rather than accepting any same-check row at the current key. `status/run-log.ts`'s `shownResult` already handles the related provenance problem for `why`; share the rule where appropriate. If the original row was replaced or pruned and cannot be identified, say its age/load are unknown. Add registration and status cases for re-keyed pending/stale failures, a cached pass at the new key, and a same-key replacement. An old stored fail must retain its real age where its producing row remains identifiable.

### B4. Returning HEAD to the revision's SHA discards the newer dirty observation

**Proven.** `src/core/state/revision-commit.ts:30`, `:41`.

001-406 requires the revision, HEAD and dirty marker, including partial commits and HEAD moves. The latest HEAD-move record must stand when no later content revision exists.

`readRevisionCommit` uses a newer move's dirty bit only when that move's SHA differs from `latest.head`. If HEAD goes away and returns to that SHA without changing file bytes, it falls through and takes `latest.dirty`, even though `recordHeadMove` has stored a newer, opposite dirty bit at the same revision.

Real Git probe, not just a fabricated metadata row:

1. Create commits A and B with different `a.txt` contents. Check out A clean and store revision 1 at A with `dirty: false`.
2. `git reset --mixed B`; reconcile via the real `recordHeadMove`. The index changes, file bytes stay A, and HEAD is B.
3. `git reset --soft A`; reconcile again. HEAD returns to A; the index remains B; file bytes still stay A. No content revision is due.

```text
git status --porcelain: MM a.txt
head-move record: { head: A, dirty: true, revision: 1 }
readHeader(...).commit: { head: A, sinceHead: 0, dirty: false }
```

The header, status and `why` omit the dirty marker despite the recorded observation and Git agreeing that the tree is dirty.

**Repair:** use the newest applicable HEAD-move record's dirty value even when its head equals the latest revision's head. Preserve the later-content-revision precedence and count rule. Add this real-Git round trip, or an equivalent regression that validates both stored move and rendered output.

## Should-fix

### S1. A fast-only request can join a full baseline and wait for its slow files

**Proven, nonblocking.** `src/core/scheduler/checkpoint-requests.ts:67-70`, `:91`; `src/core/scheduler/checkpoints.ts:234`.

The lane filter restricts the requested files, but `covers` accepts a full baseline's superset. Joined records finish with the owner, not when their own files finish. A probe using the real `Checkpoints`, `newFileState` and `queueFullSuite`, with queued `fast.test.ts` and `slow.test.ts`, starts a baseline over both and requests only fast. After `done(fast, baseline)` the fast record is still open; `failed(slow)` makes it abandoned.

```text
Fast file done, slow still pending: { owner: baseline, lane: fast, end: null }
Slow file crashed: { end: abandoned }
```

This contradicts the task notes' claim that “a pending slow file never holds a `--fast` wait,” but D5 already allows a joined request to end with its owner, and the board's queue-exclusion assertion still holds. It is therefore a follow-up rather than an additional blocking interpretation of the done-when. Either track joined lane completion separately or keep a one-lane request from joining an owner whose extra files can hold it. Test a slow timeout after the fast files finish, not only a fake daemon returning an already-completed fast checkpoint.

### S2. The end-to-end agreement parser still requires the old revision header

**Proven, nonblocking product finding; the required test gate is red.** The changed header at `src/core/delivery/format.ts:146` is consumed by `test/e2e/agree.ts:15`, whose `HEADER` regex accepts only `Revision N` followed by optional changed paths and a colon. It rejects the new commit display. Nineteen failures in the independent suite reach the helper from six e2e files that call `headerRevision` or `expectAgrees`: `worktrees`, `lifecycle`, `node-test`, `transitions`, `policy` and `pytest`.

The display is intentional, so this is a missing test-consumer update rather than a fifth product behavior blocker. Update the helper to recognize the optional commit display and verify its SHA, count and dirty bit against `status.commit`, retaining the existing revision/count/liveness/result agreement assertions. Do not merely remove the parser assertion. Final failure evidence and counts are recorded above.

## Nits

### N1. Most wave 14 contracts remain in notes and the board, not their design sections

**Proven, nonblocking.** `docs/specifications/001-core-loop/spec.md:50`, `:141`, `:159`, `:208`; `docs/specifications/004-slow-suites/spec.md:37` and their amendment logs.

The candidate amends D10 and the D11 daemon-key list, but D2 does not describe the commit display, D7 does not describe unknown-file reasons, failure ages, `failures` or duration aggregates, D9 does not define persisted session roots, D11 still says the longest waiter is first without the fast-lane preference, and 004 D2 does not describe the lane flags. Notes refer to these as amended sections. The coordinator should record the accepted contracts and dated amendments when folding this review, including the deliberately retained `run --slow` request and older-reader limitation. Do not infer a load range for passes from `failed-run-loads`.

## What fits

- Root pinning is injected into both shipped Claude Code and Codex entry points, and handlers use it before opening a context or ensuring a daemon. The memory/file-store paths distinguish main and subagent roots; an isolated subagent's synthetic start selects its own worktree, later tool cwd changes are ignored, and stop drops that root. Main compact/clear preserve the root; startup/resume deliberately resolve it again. Pi uses its session cwd and OpenCode its instance worktree, so their shell workdir does not choose the daemon root.
- The idle timer counts revision changes, queued/running scheduler work and request/sync activity. Registered consumers alone do not keep it alive. Its default is 30 minutes in project policy. The rest timeout is bounded by the first spawn, rather than renewed forever by each retry; existing tests cover overdue restart reporting.
- The first-seen-input path carries its file, discard reason and bounded sample paths into the ledger's transaction and the status/verdict formatter. Unknown entries at old keys are ignored; pending/current files are not listed as unknown. The unexplained second file of the historical cezar checkpoint remains explicitly unidentified in 001-403's notes, rather than guessed.
- Ordinary fast-lane requests filter slow files, both flags select a full request, and the fresh fast checkpoint's verdict filters its file set. Pool marks and acquisitions carry the lane through to grant reservation; the existing priority test exercises the younger fast waiter against an older slow waiter.
- Install guidance shares one formatter between scheduler and header, selects the lockfile's install command, handles Yarn 1 and workspaces, and describes result inheritance without promising every result.
- `failures` routes synchronously to bounded result reads through the existing status transaction, without an ensure/start call, result lookup touch or consumer mutation. Missing stores are not created. Tests cover producers from two worktrees, the time window, cap and JSON. It lists stored failing rows, not a guaranteed complete historical event log.
- `why` aggregates all stored pass/fail durations across worktrees, rather than just the 20 displayed rows. Candidate summaries share the same formatter. Skips are explicitly excluded from timing. Omitting the load range is honest because only failed runs have recorded load.

## Inputs for the repair wave

- Give B1 to the checkpoint-store owner: `runs.ts`, header/checkpoint tests and a durable classification fix. No unconditional schema migration that locks the other installed plugins out.
- Give B2 to the delivery/lifecycle owner: apply the existing rest decision to emitted headers without changing status's down state or the 10-second failed-start bound.
- Give B3 to the provenance/status owner: select the source outcome before attaching age and load; do not claim that a new-key pass produced an old failure. Current and inherited cases must retain their existing facts.
- Give B4 to the revision-display owner: the newer same-revision HEAD move wins for dirty state, including an A-to-B-to-A round trip. Waits and checkpoints still use the monotonic revision only.
- S1 can share B1's worker if ownership permits. Give S2 to the revision-display worker with B4, preserving the agreement assertions. N1 belongs to the coordinator; this review does not edit the board or spec.
- **Unverified, nonblocking integration limit:** the live isolated Claude Code SubagentStart `cwd` assumption was read from source and synthetic hook fixtures, not observed in a new native subagent run here. Board 001-416 already requests that probe and the separate timeout-before-unregister repair. This review neither declares that assumption proven nor reclassifies that already-planned work as a new blocker.

---

## Round 2 — repair 001-418, candidate adb833e5

**FAIL** `adb833e571b4c4ee88f394cb9620658b2d65aebc`: **1 proven blocker remains (B3), 1 proven should-fix remains in a narrower case (S1)**. B1, B2, B4 and S2 are closed. N1's requested amendments are present; the unconditional S1 sentence still exceeds the implementation after a restart. This addendum supersedes the round-1 verdict for the new candidate; the original review above is preserved verbatim from `3ddc950f`.

### Verification output

The assigned force-pushed branch was fetched, checked out and verified as `adb833e5`. The merge base with the locally available `origin/main` is `a8fedcc15c3c1d363bdcdce1e8a7f9a20694a50a`. Reviewed the repair delta, `tasks/001-418/notes.md`, the D2/D7/D9/D11 and 004 D2 amendments and their status-log entries. Checks and temporary probes ran on the clean candidate before restoring this review; no product code changed. Private-store probes use freshly built `dist` modules, and the revision probe uses real Git resets. The independent suite below is the reviewer gate, not the background Squeal verdict.

```text
$ git rev-parse HEAD
adb833e571b4c4ee88f394cb9620658b2d65aebc
$ git status --short
(no output)
$ npm ci
added 196 packages, and audited 197 packages in 12s
found 0 vulnerabilities
(exit 0; deprecation and the six-package install-script allow-list warnings)
$ npm run lint
Checked 1322 files in 2s. No fixes applied.
(exit 0)
$ npm run typecheck
> tsc --noEmit
(exit 0)
$ npm run build
> tsc -p tsconfig.build.json && npm run build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
(exit 0)
$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist plugins/pi/dist plugins/opencode/dist
(no output; exit 0)
```

The independent run acquired the host lock after roughly 12.5 minutes queued and completed with **exit 0**, in **683.82 seconds**. Sampled one-minute host load while running ranged from about 6.1 to 14.9. All e2e files passed, so no pass-alone e2e rerun was needed. The old parser failures and the masked pytest diagnostic failure did not recur. Git HEAD and the clean tree were checked again after the run, before restoring this report.

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/db16eb51-f393-4760-a2bb-da95d54c5385
 Test Files  648 passed | 1 skipped (649)
      Tests  5407 passed | 8 skipped (5415)
   Start at  17:47:43
   Duration  683.82s (tests 98%, import 2%)
(exit 0)
$ git rev-parse HEAD
adb833e571b4c4ee88f394cb9620658b2d65aebc
$ git status --short
(no output)
$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist plugins/pi/dist plugins/opencode/dist
(no output; exit 0)
```

### B3 remains: an identical later inherited result is mistaken for the producer

**Proven, blocking; the original B3 is partially repaired.** `src/core/retry/recorded.ts:78-89`, `src/core/state/shown-result.ts:42-56`. D7 now explicitly requires the time and load of “the result that produced it.”

The ordinary re-keyed own failure now keeps its old run's facts, a cached pass at the new key lends it nothing, and an identifiable mismatch prints the new unknown line. Those independent probes pass. But `withRecorded` passes `+Infinity` as the inherited-row bound. Matching outcome, fingerprint, commit and source worktree does not identify a producing run: a later forced rerun can replace the same-key row with exactly those fields unchanged. Neither the source revision nor run id nor result time is retained in the inherited known state's origin.

Independent probes through the actual store, state sink, `withRecorded`, delivery registration and public `readStatus` on a discoverable private worktree:

1. Store source `other`'s failure at key `k1`, source revision **7**, run `source-old`, recorded at **100**, load **1.5**. Receiver `wt` first confirms the failure locally at that key through `createStateSink.applyResults`, then applies the source row through normal `sink.refresh` at receiver revision **1**, so the unconfirmed-foreign-failure gate is respected. Its origin is inherited, commit `c0ffee`, fingerprint `Error: boom @ a.test.ts:1:1`.
2. Without refreshing or applying anything to the receiver, replace that same `(check, key)` result with source `other`'s identical failure at revision **8**, run `source-new`, time **500**, load **9.9**. Outcome, fingerprint and commit are unchanged. This is a normal shared-store replacement; the receiver's known state is byte-for-byte unchanged.
3. `withRecorded` reports `{ revision: 8, recordedAt: 500, loadPerCpu: 9.9 }` with no `recordedUnknown`. Registration and public `readStatus` / `formatStatus` format those replacement facts beside the old known failure. The original producer at time 100 was replaced and is no longer stored, so those facts cannot be established from the remaining row.

The public status probe prints the replacement's facts:

```text
FAIL  a.test.ts > fails
      boom
      at a.test.ts:1:1, observed at revision 1, current
      recorded just now in worktree other at revision 8, load 9.90 per CPU when it ran; no retry asked at these inputs
```

This directly checks the repair note's decision to skip `why`'s inherited ordering bound. It fixes the valid case where inheritance happened after the receiver revision began, but reintroduces the same-key replacement ambiguity the bound defended against. A fingerprint establishes which failure text recurred, not which run produced the displayed state.

**Worker-sized repair:** retain an unambiguous producer reference when a known state is applied (for example the key plus source run id/time, compatibly stored); accept a row's age/load only when that reference matches. When a producer was replaced/pruned or old states have no trustworthy reference, use the new unknown wording. Keep the positive inherited-after-revision-start case; simply reinstating the revision-creation bound loses its facts. Add current and re-keyed inherited cases with a later same-key, same-commit, same-fingerprint failure from the same source, asserting both status and registration never borrow its time/load. Keep `why`'s existing conservative log policy until its separately documented provenance choice is resolved.

The second decision in the repair notes is sound: when no stored producer is identifiable, both status and registration explicitly say “recorded at an unknown time and load: the result that produced it is no longer identifiable in the store.” The private-store mismatch probe reaches that branch. The defect is the false identification before that branch.

### S1 remains on resume, with its original nonblocking classification

**Proven, nonblocking; ordinary joining is repaired.** `src/core/scheduler/checkpoints.ts:205-225`, `:273-288`; `docs/specifications/004-slow-suites/spec.md:46`.

The independent `queueFullSuite` probe now completes a joined fast request as soon as its fast file finishes, and a later slow crash leaves it completed. But the repair notes deliberately leave own-file tracking behind when a daemon stops. `resume` appends the owed records without reconstructing their `lanes` tracking (or initializes an empty map).

Independent restart probe: a full baseline over fast and slow owns `fast-owed` with lane `fast` and only the fast file. `owe()` leaves that request open. A successor `Checkpoints` reads `takeOwed()`, starts its full baseline, and calls `resume(taken.records, [], [])`, as the existing-baseline resume path does. Completing the fast file leaves `fast-owed.end === null`; crashing the slow file changes it to `abandoned`. Its stored `testFiles` still contains only the fast file.

This is the original slow-file dependency after a restart, rather than a new blocker. Preserve or reconstruct each owed lane request's remaining own files on resume, and test fast completion followed by a slow timeout. N1's new sentence “ends with its own files and is never held by the slow lane” should describe that behavior too; the notes' restart exception is not in the amendment.

### Closed findings and specification check

- **B1 closed:** 65 completed fast checkpoints retain the first lane and yield `lastCompletedFull = null`, `fullSuite.atCurrentRevision === false`, and the explicit fast-only header. Adding an older real full checkpoint returns that full record. The label cap is gone; stale label ids are removed on subsequent lane writes, and the tests also cover abandoned records.
- **B2 closed:** the original undelivered-failure probe now delivers the failure with “A daemon is starting,” while public record-based liveness remains down. At 10,001 ms after the spawn it emits the down warning. `readLiveHeader` now applies this to the common header path used by edit summaries and policy reports as well; before a spawn it renders “The daemon stopped while unused.” A mark older than the last heartbeat cannot hide a later stop. The failed restart still becomes news; the rest is not reported alive.
- **B4 closed:** the real Git A → B (`reset --mixed`) → A (`reset --soft`) probe leaves `MM a.txt`, and now renders `Revision 1 · <A> + 0, dirty`. A newer content revision's observation takes precedence. The revision number remains monotonic and separate from HEAD.
- **S2 closed:** the candidate helper's actual `HEADER` declarations parse generated changed-path headers with no commit, a clean commit and a dirty commit/count; capture groups agree with revision and counts. Source inspection confirms `expectAgrees` also compares the short SHA, count and dirty flag against `status.commit`, keeping its previous liveness/result checks. The independent full suite also passes every e2e file.
- **N1 amended:** D2 describes commit/K/dirty and same-revision moves; D7 describes unknown-file reasons, producing-result age/load (subject to B3), bounded read-only `failures` and all-stored-result durations without a load range; D9 describes persisted main/subagent roots and compact/clear versus startup/resume; D11 describes the fast waiter's priority; 004 D2 describes lane flags, retained `run --all --slow` request behavior and durable fast labels. These align with the code except S1's documented resume exception. The unobserved live Claude Code isolated-subagent cwd assumption remains the already-planned, nonblocking 001-416 limit; it is not re-prosecuted here.

### Inputs for the next repair

B3 needs producer identity, not a broader fingerprint heuristic. Preserve the valid inherited-after-revision-start case and unknown fallback, and cover same-source identical replacements. S1 needs lane tracking across owed-checkpoint resume; keep its ordinary join behavior. Do not repeat the settled B1/B2/B4/S2 work or turn the existing native-subagent observation limit into a new gate.

---

## Round 3 — repair 001-419, candidate 4c6a6f78

**PASS** `4c6a6f78439ad3fc5a084434b1b353c2596a2d73` for this narrow re-review: **0 remaining blockers; 1 new proven, nonblocking follow-up note (N2)**. The round-2 B3 scenario and its requested positive cases pass. The human's accepted S1 resume exception is now explicit in 004 D2 and matches the code. This addendum supersedes the previous verdict for the new candidate; rounds 1 and 2 above are preserved verbatim from `f06b4c33`. The mixed older-writer case below is new evidence from the repair delta, recorded as a note under the bounded re-review rule.

### Verification output

Fetched the force-pushed `cand/0.1.196`, checked it out and verified HEAD. Reviewed `8164f3bd` (producer references), `7e7adf16` (S1 amendment), `tasks/001-419/notes.md`, the rebuilt bundles and key-format re-pin. Checks and private-store probes ran before restoring this review, on the clean candidate. No product code changed.

```text
$ git rev-parse HEAD
4c6a6f78439ad3fc5a084434b1b353c2596a2d73
$ git status --short
(no output)
$ npm ci
added 196 packages, and audited 197 packages in 9s
found 0 vulnerabilities
(exit 0; deprecation and six-package install-script allow-list warnings)
$ npm run lint
Checked 1322 files in 406ms. No fixes applied.
(exit 0)
$ npm run typecheck
> tsc --noEmit
(exit 0)
$ npm run build
> tsc -p tsconfig.build.json && npm run build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
(exit 0)
$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist plugins/pi/dist plugins/opencode/dist
(no output; exit 0)
```

The independent full run acquired the host lock after about 11.7 minutes queued and completed with **exit 0**, in **691.72 seconds**. Sampled one-minute host load while running ranged from about 6.2 to 14.7. Every e2e file passed; no pass-alone rerun was needed. HEAD, the clean tree and bundle drift were checked again after the run, before restoring the report.

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/db16eb51-f393-4760-a2bb-da95d54c5385
 Test Files  649 passed | 1 skipped (650)
      Tests  5432 passed | 10 skipped (5442)
   Start at  19:16:48
   Duration  691.72s (tests 98%, import 2%)
(exit 0)
$ git rev-parse HEAD
4c6a6f78439ad3fc5a084434b1b353c2596a2d73
$ git status --short
(no output)
$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist plugins/pi/dist plugins/opencode/dist
(no output; exit 0)
```

### B3 closed for the round-2 scenario and requested positive cases

The sink records `{ runId, recordedAt }` in `failure-producers:<worktree>` alongside the known state, in the same transaction. `withRecorded` resolves the named run, rather than treating a matching fingerprint as a producer reference. The reference also changes on a refresh that applies a replacement, even when the visible state does not change. The bounded map may forget an old reference; that conservatively yields unknown facts.

Independent probes use freshly built `dist` modules, private stores and public status/registration reads:

- **Current own failure:** applying run `own`, time 50, at receiver revision 1 returns that run's facts.
- **Valid inherited failure after revision start:** receiver revision 1 was created at time 10. After confirming the failure locally at `k1`, normal `sink.refresh` inherits source `other`'s revision-7 result `source-old`, time 100, load 1.5. Status/registration retain that source's facts; the revision-creation bound no longer drops them.
- **The exact round-2 replacement:** replace `(check, k1)` with identical outcome/fingerprint/commit/source from `source-new`, source revision 8, time 500, load 9.9, without refreshing the receiver. Its known state and producer reference stay unchanged. Status and registration now give `recordedUnknown: true`, no recorded facts and the explicit unknown line; neither borrows time 500, revision 8 or load 9.9. The re-keyed/pending inherited variant also reads unknown.
- **Replacement actually applied:** refreshing the receiver at `k1` makes `source-new` the producer, and its time 500/revision 8/load 9.9 are then reported. This distinguishes an applied result from an unobserved shared-store replacement.
- **Upgrade without a reference:** delete the producer meta entry while leaving the failing state and result row intact. Both public reads say the producing time/load are unknown; no nearby row is guessed. A normal refresh supplies a reference again.
- **Older reader:** extract the committed 0.1.195 main plugin CLI and run its `status --json` against the store with the new meta row. It exits 0 with `available: true`, `schemaVersion: 1`. No schema bump or refusal occurs. This establishes older-reader compatibility, separately from the older-writer note below.

`why` keeps its existing conservative ordering rule, as requested. The old native Claude Code isolated-subagent observation limit remains the previously planned nonblocking 001-416 work; nothing in this delta reopens it.

### S1: accepted exception now matches the resume behavior

004 D2 now says that a fast-only joined request is not held by slow work **except after an owed checkpoint resumes on a successor daemon**, when it ends with the checkpoint it joined. The unchanged independent restart probe produces exactly that: after `owe`, successor baseline and `resume`, completing fast leaves the fast request open; crashing slow abandons it. Its stored `testFiles` remains fast-only; the lost part is its separate remaining-file tracking. The spec's new exception describes the waiting/completion behavior. This is an accepted limitation, not an implementation claim that resume was repaired.

### N2. An older writer can leave a producer reference belonging to a different state

**Proven, nonblocking new follow-up.** `src/core/state/producers.ts:89-103`; the mixed-writer claim in `tasks/001-419/notes.md`, “Where the producer lives.”

The notes say an older daemon rewriting a state is guarded by the match on outcome/fingerprint/commit. An older daemon leaves the new meta row alone, however, and those fields can stay equal while the state's origin and observed revision change. `producingResult` checks neither. A still-stored result named by the old reference can then supply the facts of a different state.

Private-store probe uses the **actual older state-sink source** from Git (main 0.1.195 and `adb833e5` have the identical blob `1a4bdbc234070ce005f21758ae4cb11ebca0d041`; its derivation, transition, inheritance and failure-key dependencies are unchanged). After the valid inherited result above has been applied, its producer reference names `source-new`, time 500, in worktree `other`, source revision 8 at `k1`. The older sink then applies a receiver-owned failure at receiver revision 2 under **new key `k2`**, run `older-own-new-key`, time 900. It has the same fingerprint and commit. The `k1` result still exists; the old sink cannot update or clear the new producer row.

```text
known state: { origin: { kind: "own" }, observedAt: 2, commit: "c0ffee" }
reported recorded facts: { worktreeId: "other", revision: 8, recordedAt: 500, loadPerCpu: 9.9 }
recordedUnknown: false
```

Public status says both “every current result here was run in this worktree” and “recorded … in worktree other at revision 8, load 9.90 per CPU” for that own failure. It should report the new producer only with trustworthy evidence, otherwise unknown. This case requires an older writer taking over after a newer producer-aware writer; it is separate from the repaired round-2 shared-row replacement without receiver refresh. It is a new note under the narrow re-review scope, not a reopened blocker.

**Follow-up input:** reject stale companion references when an older writer changes the known state's identity. Restore the origin/own-observed-revision checks and tie the reference to the failure key older sinks already record (`recordFailureKeys`), so an applied result at a different key cannot retain the old producer. Alternatively invalidate producer references across an older-daemon handoff. Add a mixed-version regression that retains the old row at a different key and changes the state's origin. Keep the positive producer-aware refresh case and older-reader compatibility. The notes should not claim the current outcome/fingerprint/commit check establishes this mixed-writer guarantee.
