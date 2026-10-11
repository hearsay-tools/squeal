# Wave 13ac: four subtractions from the quality pass (001-257)

## Verification output

Candidate: `9a9354a50728492964e32be284a1f58428242586`, package 0.1.114. HEAD matched the assigned candidate. Range: `8e5e5462..9a9354a5`. Scope: 001-253, 001-255, 001-258, 001-254, their rebuilt distributions and the repository-inputs teardown fix. Research documents 001-256, 001-180, 001-218 and 001-182 are inputs, not executable changes. Spec 006's eval implementation/reviews interleaved in the range are outside this assigned product review; the full suite includes their tests.

All checks and external probes ran at the exact candidate with a clean tracked tree, before writing this report. Linux, Node 24.21.0, Vitest 5.0.3. The independent full suite ran directly as explicitly required, with `GIT_CONFIG_GLOBAL=/dev/null` and `CODEX_SESSION_ID` unset; it was not replaced by Squeal. No product, test, board, specification, status or distribution file was edited. Only this report is committed.

```text
$ git rev-parse HEAD
9a9354a50728492964e32be284a1f58428242586
$ git status --short
(no output)

$ npm ci
added 56 packages, and audited 57 packages in 2s
found 0 vulnerabilities
(exit 0; warnings about unapproved @parcel/watcher and esbuild install scripts)

$ npm run lint
> squeal@0.1.114 lint
> biome check .
Checked 823 files in 925ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.114 typecheck
> tsc --noEmit
(exit 0)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --maxWorkers=4
Test Files  5 failed | 364 passed | 1 skipped (370)
     Tests  5 failed | 2795 passed | 10 skipped (2810)
    Errors  1 error
Duration 778.22s
(exit 1)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run test/cli/status-wait.test.ts test/delivery/harness-process.test.ts test/daemon/shared-store.test.ts test/delivery/expiry.test.ts test/status/why.test.ts --maxWorkers=1
Test Files  5 passed (5)
     Tests  44 passed (44)
Duration 55.39s
(exit 0; no unhandled error)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --config <external>/vitest.config.mts --reporter=verbose
Test Files  1 passed (1)
     Tests  5 passed (5)
Duration 12.53s
(exit 0; assertions reproduce B1 and its two controls, the real-socket successor and old-CLI fallback)

$ cmp plugins/claude-code/dist/cli/squeal.mjs plugins/codex/dist/cli/squeal.mjs
(no output, exit 0)
```

The independent full suite is **red**. Four tests exceeded 5 s: `status-wait.test.ts:110`, `delivery/harness-process.test.ts:117`, `delivery/expiry.test.ts:59`, and `status/why.test.ts:10`. The shared-store stress test (`daemon/shared-store.test.ts:178`) completed its three starts but found two `heartbeat failed: Error: database is locked` messages in the first daemon's stderr. The unhandled error was the timed-out status-wait test's delayed `settle` timer writing after its store closed (`ERR_INVALID_STATE`, `status-wait.test.ts:113`). Every other changed test file, the migrated earlier-review regressions and the key-format guard passed in that full run.

All five complete failed files passed in the single serial retry at the same clean candidate, with unchanged source, assertions and test timeouts. This does not make the full-suite result green. Sampled host load was about 43 to 56 during review/probing, and background reports named load 66 to 72; it was about 13 at the full run's end and 11 after retry. Contention is a **plausible** explanation; a causal connection between these failures and this wave is **unverified**, so they are not additional blockers. The earlier external probe also encountered a 5 s fixture timeout under contention; its final run used a 30 s outer test limit and explicit mutation-timer cleanup, without changing the candidate or the tested outcome.

`npm run build` was explicitly forbidden and was not run. Independent build reproducibility and native macOS execution are **unverified**, not blockers. Source/bundle inspection does not substitute for a rebuild. Squeal's concurrent baseline separately reported failures and recoveries, including timeouts in status/store tests, handover assertions and backlog/tier-sharing failures; those reports were read but are not this review's independent gate or proof of a cause in the range. All temporary probe sources, predecessor copies and private sockets were removed before committing.

## Verdict

**FAIL 9a9354a5: 1 proven blocker, 0 should-fix, 1 proven documentation nit.**

001-253, 001-255 and 001-254 keep their required product behavior. The store-based wait keeps the named prior regressions when the daemon writes moves throughout the wait, and removes their per-request retention machinery. Its mixed-version guarantee fails when an older daemon replaces a newer one after the sync answer and before refinement. This is the edge already named in 001-258's notes, now reproduced at the production socket/store/CLI boundaries.

## Blockers

### B1. A newer sync's capability survives an older successor, so the wait ends quiet over unrecorded re-keys

**Proven by an external regression and two controls.** Locations: `src/cli/status-sync.ts:72`, `src/cli/status-wait.ts:193`, `:197`, `:201`, `:218`; the incomplete-record checks are `src/core/scheduler/rekeyed-moves.ts:212`. The acknowledgement of the edge is `tasks/001-258/notes.md`, decision 1.

The sync object stops asking once it has a revision. Its `moves: true` belongs to the daemon that answered, but the CLI neither binds that capability to a daemon incarnation nor checks the writer again when refinement arrives. `answerMoves` accepts any readable row whose dropped watermark is old enough. An older daemon leaves that row untouched while continuing to write `test_file_keys`, known states, `rekeyed` and `refined`. When it completes the captured revision's runner part, the stale moves row can therefore become an apparently complete answer.

D7 requires every file whose key the captured edit moved, including closure/environment/observed growth, to have its result before quiet. The 001-258 brief also requires: "Keep mixed versions safe: an older CLI or daemon falls back and never ends quiet." The accepted fallback is general quiet only when *nothing* is pending, not an empty edit-window quiet that excludes unrecorded work.

Reproduction:

1. A live newer daemon has an empty moves row from a completed earlier revision. Revision 4 is stored, with refinement still at 3. A test file still has its earlier PASS and key; its new key is discovered by the runner part, rather than the initial content re-key.
2. Start the candidate public wait. The actual candidate `syncDaemon` talks to the candidate handler over a private Unix socket and receives `{state: "synced", revision: 4, moves: true}`. The CLI initially reads `refining`.
3. Replace that server with the actual pre-258 handler from 0.1.112 (`cf7e8a2c`). Update the worktree's daemon record to the older successor. The actual predecessor `Ledger.settle(..., {keyedAt: 4})` queues the runner-discovered key, and `Ledger.commit({refined: 4})` writes its pending states and refined revision. Its code writes the legacy re-key row but does not touch `rekeyed-moves`.
4. Before any result at that key, the candidate wait accepts the unchanged empty row. It returns `quiet`, zero edit files and zero edit pending. The key remains `queued`; the snapshot itself honestly contains two pending checks.

| Writer after the sync | Capability used | Result with the key still queued |
| --- | --- | --- |
| Pre-258 Ledger | Cached `moves: true` | **quiet**, 0 edit files, 0 edit pending, 2 snapshot pending checks |
| Same predecessor Ledger | `moves: false` control | timeout, broad fallback, no edit window |
| Candidate Ledger | `moves: true` control | timeout, 1 edit file, 1 edit pending |

The socket reproduction independently repeats the first row using the production synchronizer and both versions' actual handlers. The direct controls change only the writer implementation or capability flag. The key-index result is a controlled runner stimulus; the ledgers, store transactions, sink, socket protocol, sync client and public wait are real. No live repository daemon was replaced, no full predecessor daemon process was launched, and the probe does not claim an operating-system handover test. It proves the cross-version writer seam and resulting public response under the documented successor schedule. The predecessor and candidate both use schema V1; 0.1.112 already has key-format 5, so the failure does not depend on a key-format bump.

The notes' statement that the older successor's eventual results clear pending rows does not make this safe: the wait has already excluded those rows and returned before those results.

One worker's repair: make the store's attribution completeness conditional on the *writer that refined the capture*, not solely a capability cached from its former daemon. Bind the answer to a daemon incarnation and revalidate it in the same status read before building or trusting a window, or persist a writer/refinement token that an old writer cannot accidentally satisfy. On replacement or unverifiable coverage, discard the narrow window and use D7's broad fallback. A check only at initial sync, only for a missing row, or only of the dropped watermark cannot repair this schedule. Also handle replacement after a window has already been installed. Do not make every ordinary wait hold for unrelated backlog/slow work.

Ownership: `src/cli/status-sync.ts`, `src/cli/status-wait.ts`, the move-record/refinement or daemon-identity seam if the chosen repair needs it, and the CLI/scheduler/daemon regressions. Keep schema V1 and old readers safe. Retain both static mixed-version controls, add the real-socket successor-before-refinement case and a successor-after-window case, and assert no quiet while an unrecorded captured-edit key is pending. Route the blocker to the human before another repair/review round. It was sent to the parent during this review.

## Should-fix

None.

## Nits

### N1. The changed D2/D7 contracts have no dated amendment entries

**Proven documentation drift.** `spec.md:58` now applies the timestamp rule to extras as well as the root, and `spec.md:144` replaces the held-answer protocol with store moves. `status.md:173` still ends its amendment log with authorization of the quality rows; it has no entries for 001-253 or 001-258. The process and wave's shared rules require those entries. The coordinator should record the accepted D2 change and final repaired D7 contract, plus the rows' required completion lines. No board or status file was edited here.

`src/cli/status-wait-edit.ts:47` also still names removed `SyncState.rekeyed`; the membership now comes from `answerMoves`. Update that comment in the repair. It is documentation, not surviving executable coupling.

## What fits and answers to the brief

### 001-253: Parcel extras use the root's timestamp rule

The required watcher correctness is retained; the old backend's exact suppression of unchanged *hints* is intentionally replaced by conservative timestamp hints, as the approved brief specifies. `ErasedEvents` shares `stamp`, `nowNs` and `RACY_NS` with the root. It keeps existence separately, so an erased delete/add still becomes unlink/add and real paths still report every declared alias.

| Earlier proof | Candidate protection |
| --- | --- |
| 001-235, erased extra write/create/delete | `parcel-links.test.ts` retains the public callback and real-Parcel cases. |
| 001-243, same-size rewrite in one timestamp tick | `parcel-racy.test.ts` holds the real stat's prototype, inode and size, and varies only timestamps and the clock; a write within the previous-batch/racy boundary is reported. |
| 13x B1, a failed seed/recheck read becoming trusted | There is no content read or hash state to become trusted. All attempted content-read APIs are refused and counted; same-tick seed and subsequent rewrites are still hinted. A failed stat is conservatively `written`. |
| 13x S1, 13y B1, 13z, growth/aggregate/exact-EOF/partial-read/descriptor paths | The bounded-reading mechanism is removed completely. A 12 MiB rewrite is reported without opening or reading it. Seeding and callbacks read zero content bytes and own zero descriptors; there can be no accepted truncated digest, failed-close bypass or byte-budget overrun. |
| 001-236, root erased-event recovery and its budgets | Root selection and budgets are unchanged; its boolean timestamp predicate became the shared three-way stamp. `parcel-root.test.ts` retains coverage. |

An unchanged recent extra may now generate a duplicate hint; `diffCandidates` still compares content and creates no revision for unchanged bytes. The timestamp/two-second clock assumptions remain those of the already accepted root rule. Native macOS execution and the worker's 50-repeat claim were not independently replayed here.

No obsolete `Signature`, unknown-hash state, byte `Budget`, chunk loop, `contentHash` or extra-file `READ_BUDGET` remains. The root's `READ_BUDGET` is still used for directory-entry counts and must stay. Key-format 4's shipped pin is unchanged; the constant is 5 and the current pin is independently checked by the suite.

### 001-255: stopped notes carry commands as data

`describe` preserves the original text, including pid, parent, age, SIGTERM/SIGKILL and lane/shared run provenance, and adds `{stopped: {what, commands}}`. Both tier cleanup and daemon-exit cleanup persist the field beside time/revision. The read path validates it; older prose-only or malformed data stays unfolded. Formatting counts and sorts commands from the data, so `sh -c "a; b (c)"` stays one command. Single notes, other notes and `status --notes` retain their full prose. The real-process and overlap/identity tests still check attribution and signalling; their text assertions now select `.text`.

`parseStopped`, the production `STOPPED` regex and the duplicate `COMMAND_CHARS` are gone. The one cap in `terminate.ts` still limits actual command lines and is live. No schema migration, process-identity relaxation or new signal path was introduced.

### 001-258: prior wait regressions

The named prior cases have product-record coverage rather than tests of the removed memory machinery:

| Prior review case | Current proof and boundary |
| --- | --- |
| 13k B1, completed sibling regrown at the same revision | `environment-growth-same-revision.test.ts` keeps both ordinary/heard-window waits pending for the new key. `apply` deletes that revision's resolved entry when it reopens. |
| 13k S1, result before membership answer | `resolved-wait.test.ts` returns the failure as one own transition and one edit file; the start sequence and result sequence are in the same store transaction boundary as their respective views. |
| 13l S1, later cached discharge | `later-discharge-wait.test.ts` keeps the earlier resolved revision alongside the later cache-hit revision; its one-discharge control remains. |
| 13q S1, 10,000-entry boundary | The same file records 10,050 later moves without a count eviction; the original edit's failure remains its own news. |
| 13q S1, age boundary | Resolved moves are retained while refinement is outstanding; a commit past the hour does not remove the needed earlier move. |
| 13r B2, 40 forgotten/abandoned requests | The handler still retains 32 retrievable IDs, but no request takes an attribution hold. `sync.test.ts` verifies all 40 revision-only passes complete and old IDs disappear; `moves-retention.test.ts` verifies 40 timed-out waits leave the moves row byte-identical. |
| 13s B2, hour with no operation | The two-hour/no-commit test still returns the edit's own failure once refinement lands. There is no hold deadline or timer to release/reject. The old one-hour failure of a live answer is deliberately replaced by continued readable membership. |
| 13t S1, delayed timer and younger holds | There is no timer, callback re-arm or per-hold resource. Pruning uses the committing clock and protects outstanding refinement, then enforces retention after the catch-up grace. |
| Incomplete history | The dropped-sequence watermark forces the broad fallback. The prune-after-catch-up test returns news with no edit window, rather than losing the failure as other news. |
| D5 retry backstop | `moves-retention.test.ts` reads an answered record after revision refinement is abandoned at its bound while the subsequent `run --all` retry remains hung. |

Earliest/latest open revisions, resolved-only membership, terminal unknown, baseline/backlog/forced-rerun exclusions, slow-file exclusions and upper captured-revision bounds remain covered by the scheduler and CLI tests. The record resolves an earlier daemon's open move without recreating completed `keyedAt`. The four reported fix-removal mutations in the worker notes were not repeated by this reviewer; their structural properties and green product tests were inspected. B1 above is the failed mixed-version extension of these guarantees.

The static fallback story is sound: a new daemon ignores an old CLI's `after`/`resolvedSince` and omits `rekeyed`, and an actual 0.1.112 CLI against the candidate socket uses the broad path and times out while work is pending. A new CLI seeing `moves` absent takes the same broad path even if a newer moves row remains. This permits general quiet only with no pending work; it does not permit quiet on an incomplete edit window. An older successor *after* a successful new sync is unsafe, as proven above.

No `Discharges`, `SyncRequests`, `sync-forget`, `forgetSync`, `Scheduler.refined`, `rekeyedSince`, `rekeyedOnceRefined`, `FileState.lastKeyedAt`, old held-window constants, or wire `after`/`resolvedSince` fields remain in executable source or either plugin bundle. `RekeyedTestFile` is live as the record answer type. `RunnerWork.afterTier` is live for the full-suite retry, rather than a leftover of the removed public refinement method. The legacy `rekeyed` row remains deliberately necessary for hook delivery and old versions.

The approved store record has no count cap. Its commit/read cost and retained size during a long refinement stall remain unmeasured, as the research already states; this review does not claim a numeric memory/storage bound. The pre-capture baseline/retry lock stall remains the research's known 001-259 follow-up. It leads to timeout, not a falsely complete answer, and is not introduced by this subtraction.

### 001-254: one registry of 23 worktree rows

Every registry entry reproduces its former exact prefix and delimiter. Every producer/reader uses `worktreeMetaKey`, including the slow header's independent turn read, avoiding a delivery import cycle. `WorktreeRepo.remove` deletes all 23 exact names in its existing transaction, including moves. The registry test seeds three worktrees and shared rows, removes one and keeps both remaining worktrees and shared observation/flaky/store-recovery rows, even when their names end with the removed ID. Prefix uniqueness and source scans cover every registered owner/key builder.

The old prefix list and both unreleased `edit-keys` cleanup paths are gone. Those snapshots' versions 0.1.100 to 0.1.102 never reached the hub, as the assigned quality brief records. No required reader or writer still uses them. Shared node:test and observed-input rows remain outside the registry and outside worktree deletion. Removal still preserves the existing claim-ownership and short pruning-transaction boundaries.

### Teardown and packaging

The repository-inputs teardown closes the store and retries recursive fixture removal five times with 100 ms delay. It adds no product behavior and does not broaden the deleted path. The two committed CLI bundles are byte-identical and contain all four new source paths; the removed code is absent. This source/bundle inspection is not a reproducible-build check.

## Inputs for the next wave

1. Send B1 to the human and dispatch a bounded compatibility repair only after that decision. Keep the store design and the already preserved prior regressions; the missing invariant is the writer/capability relationship across successor refinement.
2. Preserve `recordMoves` inside `Ledger.commit`'s transaction, before this commit writes its refined revision. Preserve start-view/sequence atomicity, reopening, per-revision resolved membership, refinement-aware pruning and incomplete-history fallback.
3. Keep additive wire compatibility and schema V1. Preserve the legacy hook record; do not restore the deleted holds, timers or forget transport to fix B1.
4. Record the accepted amendments under N1 after the final D7 repair. Build reproducibility and native macOS behavior remain unverified by instruction/scope, and the independent suite's exact result remains the result recorded above.
