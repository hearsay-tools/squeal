# Wave 13v review (001-239)

## Verification output

Clean candidate HEAD: `42b1aee9314d12646c5e47f82d32fac4aaa18136`, package 0.1.103. Reviewed repair range: `1f4905e9..e7a2a16b`, second round on `reviews/wave-13u.md`. The only subsequent change is `docs/board.md`, as the dispatch permits. Product and test sources at HEAD equal `e7a2a16b`. Linux, Node 24.21.0. All checks and probes below completed on the clean candidate before writing this report. The reviewer changed no product, test, bundle or board file.

```text
$ git rev-parse HEAD
42b1aee9314d12646c5e47f82d32fac4aaa18136
$ git status --short
(no output)

$ npm ci
added 56 packages, and audited 57 packages in 1s
found 0 vulnerabilities
(exit 0; npm warned about optional @parcel/watcher and esbuild install scripts)

$ npm run lint
> squeal@0.1.103 lint
> biome check .
Checked 768 files in 229ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.103 typecheck
> tsc --noEmit
(exit 0)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run
Test Files  2 failed | 348 passed | 1 skipped (351)
     Tests  2 failed | 2528 passed | 10 skipped (2540)
Duration 233.87s
(exit 1)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run test/harness/user-prompt-submit.test.ts test/watcher/linked-dirs.test.ts --maxWorkers=1
Test Files  2 passed (2)
     Tests  11 passed (11)
Duration 8.95s
(exit 0)

$ git diff --check
(no output; exit 0)
```

The full suite is **not green**. Both failing files passed in the isolated retry, which does not replace the full-run result.

| Full-run failure | Evidence | Classification |
| --- | --- | --- |
| `test/harness/user-prompt-submit.test.ts:97`, “registers nothing in no attended flag” | 5,000 ms timeout; reported duration 5,561 ms. | Passed isolated. A wave-caused regression is **unverified**. This case uses the fake daemon but never queues a file, so the new attribution calls are inactive. |
| `test/watcher/linked-dirs.test.ts:73`, linked-file add | `condition not met in 3000 ms`. | Passed isolated. A wave-caused regression is **unverified**; watcher code is unchanged by this repair. |

Host load was 52.26 at one sample during the full run. Timing alone does not establish either failure's cause. The independent run passed the changed delivery, scheduler, store and CLI tests, `test/e2e/transitions.test.ts`, and the key-format guard. The separately delivered Squeal baseline initially reported seven failures and incomplete coverage, then recovered all seven and completed revision 0 with no known failures. It is not the independent gate above.

`npm run build` was expressly forbidden and was not run. Build reproducibility and bundle drift remain **unverified**, not blockers. Version 0.1.103 is recorded in both plugins. Re-pinning KEY_FORMAT_VERSION 3 is consistent with the supplied unreleased history: `status.md` records version 2 shipped in 0.1.99. The guard passes at 3.

Two throwaway TypeScript probes ran with `node_modules/.bin/tsx` outside the checkout, using the real store, ledger, state sink and delivery. The first also called the actual `queueReruns`. Their sequences and output are preserved below. Both exited 0, removed their temporary stores, and were deleted before committing. They do not substitute for the full suite.

## Verdict

**FAIL** `42b1aee9314d12646c5e47f82d32fac4aaa18136`: **1 proven blocker, 1 proven should-fix finding, 0 nits**.

The previous review's two B1 reproductions and its B2, S1 and S2 are repaired. The new settlement predicate reopens 001-223's explicit “No line while any is pending” contract when an edited file has a confirmation run pending. The blocker was sent to the coordinator for routing to the human.

## Blockers

### B1. A discharged edit is called current while its confirmation run is pending

**Proven.** `src/core/delivery/edits.ts:147`, with the rendered claim in `src/core/delivery/format.ts:357`.

The wave brief for 001-223 says: “once every test file the consumer's edits re-keyed is current, the next delivered header says so once ... No line while any is pending.” D5's validity contract says pending takes precedence when a run for the current key is queued or running. The re-review expressly asks whether the settled line can still appear while an edit's file is pending.

The repair uses `entry.open !== null && row.pending !== null` to hold the line. The first result at the edited key correctly discharges the edit's wait attribution, setting `open` to null. When that result fails anew, 001-171 immediately queues a forced confirmation run at the same key. `tiers.ts` applies the result, calls `queueReruns`, then commits. The row and its known check are pending again, but delivery ignores that pending phase because the attribution is discharged.

Probe sequence, through the actual `Ledger`, `queueReruns`, store and `createDelivery`:

1. Apply a baseline PASS at key A and register `s1/main`.
2. Append a watched source edit. Move the file to key B with `Ledger.settle(..., { keyedAt: 1 })`, commit as refined, and deliver the first-edit line.
3. Apply a FAIL at B. Call `queueReruns` with that file as an unforced new failure, then `Ledger.commit`, in the same order as the real tier path.
4. Call `onToolBoundary`.

```text
FIRST EDIT: {"queued":1}
REKEY RECORD: [["\u0000test/a.test.ts",{"open":null,"last":1}]]
FILE ROW: key B, revision 1, pending "queued"
KNOWN STATE: [{"outcome":"fail","validity":"pending"}]

SQUEAL · 1 check changed at revision 1
Revision 1 (changed src/a.ts): 0 current, 1 pending, 0 stale, 0 unknown.
The test file your edits since revision 0 re-keyed is current.

FAIL  test/a.test.ts > a
      PASS -> FAIL, seen by Squeal's run at revision 1, revision 1 pending
      expected 1 to be 2
```

That delivery also advances the consumer's edit state to revision 1 and prunes the resolved attribution. The eventual confirmation result can no longer carry the settled line for this edit.

**One-worker fix:** use the daemon-written record to select the edited files, then withhold the settled/current claim whenever any selected keyed file's current row is pending. Keep `status --wait`'s existing discharge semantics: its wait deliberately excludes the same-key confirmation run. Keep Stop silence and the 223/224 merge. Add a regression through the real ledger and automatic rerun path that asserts no settled line while the confirmation is queued or running, and exactly one on later news after it completes. Also cover a forced same-key run after the edit's first result.

## Should-fix

### S1. A restarted ledger can leave a completed file's persisted attribution open

**Proven.** `src/core/scheduler/ledger.ts:457`, with the new record in `src/core/scheduler/rekeyed-record.ts:103`.

The new row is described as the scheduler's earliest unresolved re-key, null once its current key has a result. A restart creates files with `keyedAt = null`; bootstrap's lookups and results do not restore the persisted attribution. `#discharge` only schedules a persisted update when the in-memory `keyedAt` is non-null. Thus a file whose edit was open when the old daemon stopped remains open in the store after the new daemon applies its result. `pruneRekeyed` then refuses to remove it, including when the last consumer leaves.

The second probe repeated steps 1 and 2 above, then created a fresh ledger over the same store, added the same file, settled it as a baseline without `keyedAt`, applied its current-key PASS, and committed. This follows bootstrap's fresh-file and result path.

```text
RESTART LIVE ATTRIBUTION: {"keyedAt":null,"lastKeyedAt":null}
RESTART PERSISTED ATTRIBUTION: [["\u0000test/a.test.ts",{"open":1,"last":1}]]
RESTART FILE ROW: key B, revision 1, pending null
AFTER LAST CONSUMER LEFT: [["\u0000test/a.test.ts",{"open":1,"last":1}]]
```

This is a lifecycle consistency and pruning note. Storage still has one entry per test file, and the probe does not establish an additional false-current claim, so it does not block.

**One-worker fix:** reconcile the persisted record during bootstrap/current-key discharge, preserving the latest re-key revision needed by existing consumers. Test a restart while an edit is open, its later current-key result, and pruning after the last consumer leaves. Explicitly define whether the live wait attribution is restored or only the delivery record is discharged.

## Nits

None.

## Brief answers and what fits

### Are wave 13u B1, B2, S1 and S2 closed?

| Prior finding | Assessment |
| --- | --- |
| B1, cold registration | **Original reproduction repaired.** `test/scheduler/rekeyed-delivery.test.ts` registers before the scheduler's first listing, proves that baseline listing produces no attribution, then edits an imported source through the real scheduler and delivers a count of one. |
| B1, revert before the first result | **Original reproduction repaired.** The delivery regression counts two edited files, moves the never-run second file back, withholds settlement until its result, then names both. `test/scheduler/rekeyed-record.test.ts` independently proves the real ledger keeps its earliest open revision on the move back. The broader 001-223 done-when remains unmet because of this review's B1. |
| B2, unregister/resume | **Repaired within the parked lifetime.** `drop` parks `editsSaid` before deleting active edit state. `tellRegistered` restores it and `startEdits` uses it. Tests cover explicit unregister/resume, the waiterless expiry's `drop` path, expiry of the parked lifetime, and a new session ID. The waiterless test calls `drop` directly; source inspection verifies that actual waiterless expiry uses that path. |
| S1, worktree removal | **Repaired for the named rows.** Exact ownership prefixes remove `edits:`, `checkpoint.` and `rekeyed.`. Legacy `edit-keys:` ownership is parsed from its JSON tuple. Removal tests preserve a live worktree's rows and shared node:test rows even when their names end with the removed ID. |
| S2, CLI harness environment | **Repaired.** The literal-command fixture passes `env: {}` and the second fixture explicitly supplies `CODEX_SESSION_ID` and asserts the Codex command. Both pass in the independent suite with the process variable unset; both code paths are exercised regardless of the invoking environment. |

The old review supplies the failing pre-repair evidence for B1 and B2. This reviewer verified the candidate tests and source; no fresh red run of the old candidate is claimed. The full-suite-green gate was not met in this run.

### Can the settled line still appear while an edit's file is pending?

**Yes: B1.** The two original unresolved-edit cases now hold it correctly. A resolved edit followed by its pending confirmation run does not. An untouched backlog still contributes neither to the selected set nor its count.

### Is daemon-written attribution consistent with `status --wait`?

**At ordinary re-key and result commits, yes.** Both come from `FileState.keyedAt` and `lastKeyedAt`. A keyed revision calls `noteKeyedAt`; the new commit marks carry the live earliest unresolved revision and the latest move. `#discharge` clears the live attribution and records the null open value in the same transaction that updates key rows and known state. A reverted key without a result stays open. A baseline or unrelated backlog run creates no mark.

Delivery additionally retains the latest resolved move so it can count files after their result; `status --wait` uses bounded discharge history for its captured answer. Those different retention periods serve their different readers. The wait's discharged result does not imply that the current row is non-pending, which is the distinction B1 loses. Across daemon restart, the new persisted open value can diverge from the live attribution and never discharge: S1.

### Is every new meta row bounded and pruned?

- `edits:<worktreeId>` contains one `{ since, said }` slot per registered consumer. Slot writes discard unregistered identities; unregistration and expiry remove the active slot. Worktree removal deletes the row.
- `rekeyed.<worktreeId>` contains at most one pair of revision numbers per test-file ID, replacing entries on successive edits. Ledger file removal deletes the entry. Delivery settlement and departure prune resolved entries at or before every remaining consumer's edit floor. Worktree removal deletes the row. S1 prevents normal resolved pruning for a record left open across restart; it remains bounded by files.
- The once-told marker is one boolean inside the existing parked-registration row, with the same identity and 12-hour lifetime. `park` and `unpark` use the existing cleanup of older entries. No separate parked-marker row is added. General removal of older parked-registration meta rows is outside this repair's range.
- The old per-consumer key snapshot is no longer written. It is deleted on consumer departure and by explicit ownership parsing on worktree removal. The already-added checkpoint progress/debt row is also deleted on removal.

These are cardinality bounds, not fixed byte caps: total cost scales with test files, path lengths and consumers. Scheduler writes and hook delivery read/tell/prune execute in short synchronous store transactions. The source has no await inside those updates, so no new concurrent-hook lost-write path was found.

### Does the changed fake daemon stay faithful to the real daemon?

**For its existing fixture contract, yes.** `test/harness/helpers.ts:95` retains the earliest open revision across queued edits, records the latest move with `recordRekeyed`, and clears open when the queued run's nonempty result lands. Its baseline-only `apply` creates no attribution. Existing queue callers supply changed keys, and their subsequent `pass`/`fail` results use the current queued key. These are the same attribution transitions the real ledger commits.

The fake applies its steps synchronously in several transactions; the real ledger commits its row, attribution and sink changes together. Hook tests call it to completion before invoking the hook, so they do not observe that intermediate state. It supplies neither automatic confirmation reruns nor a daemon restart. Consequently it cannot prove the pending-rerun or restart cases above. This review used the real ledger for both.

## Inputs for the next wave

1. Fix B1 in delivery selection/settlement and add the real automatic-rerun regression. Preserve scheduler wait discharge semantics, Stop silence, and the merged first-edit/settled wording.
2. Consider S1 in the same repair: reconcile persisted open attribution when a restarted daemon accepts a result. Keep one entry per file and preserve resolved history until all active consumers have passed it.
3. Keep the original cold-registration, revert, resume, ownership-prune and CLI environment tests. They now discriminate the old failures; the new probes identify the missing cases.
4. Rebuild both plugin bundles at landing under the repository's version rule. Check whether guarded sources change before pinning key-format 3 again while it remains unreleased. The reviewer did not build.
5. The independent full suite still needs a green gate. The two isolated successes above provide useful failure context, not a replacement gate. Timing fixes and unrelated watcher changes require their own scope and evidence.
