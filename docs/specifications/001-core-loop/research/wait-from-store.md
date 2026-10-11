# Research: `status --wait` from the store's re-key record (task 001-256)

**Verdict: switch.** A store record kept per test file and re-key revision, resolved at a commit sequence number, answers every probed case of reviews 13k to 13t from the store. It needs no hold, no timer, no `sync-forget` and no `SyncRequests`. Each probe runs the real scheduler and the real `waitForStatus` with a prototype record, and each has a control that fails the way the original reproduction failed. The record needs four properties, and each was found by a failing control:

1. One entry per file and revision.
2. A resolve marker.
3. A move back to a resolved revision reopens it.
4. A prune that never runs while a runner part is outstanding.

Examined at commit 8e5e5462 (0.1.110, `KEY_FORMAT_VERSION` 4), Node 24.21.0, Vitest 5.0.3. Probes: `probes/wait-from-store/` (5 files, 13 tests, all passing, at load average 54 to 75).

## Questions answered

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1 | Can a store record per file and revision, with when each entry resolved, answer `status --wait` with no hold? | Yes. The start read takes the record's commit sequence. One later poll, the first whose refined revision covers the capture, reads the answer in its read transaction. | verified by experiment |
| 2a | 13k B1, a regrown sibling at its result's revision | Passes if a move to a resolved revision reopens it. The control without reopening ends both waits quiet with 0 files while a's re-run is held. | verified by experiment |
| 2b | 13k S1, a result before the answer | Passes. The control that names only open entries, as today's `open`/`last` record can, ends quiet with the failure as other news. | verified by experiment |
| 2c | 13l S1, a later cached discharge | Passes with entries per revision. The one-entry-per-file control ends quiet: 2 files, 1 other transition. | verified by experiment |
| 2d | 13q S1, eviction by count and by age | Count: passes with 10,050 later resolved entries and no cap. Age: passes. No prune runs while the runner part is held; the age-only control falls back. | verified by experiment |
| 2e | 13r B2, abandoned requests keep holds | Passes by construction. 40 revision-only syncs through the real handlers are answered while the runner part stalls, and none is left in flight. 40 waits abandoned at their timeout write nothing. A commit an hour past the catch-up prunes every resolved entry. | verified by experiment |
| 2f | 13s B2, a hold outlives its hour with no other operation | Passes. Two simulated hours pass while the runner part is held, with no commit; the answer is complete when it lands. Today the same wait fails at the hour. | verified by experiment (clock simulated) |
| 2g | 13t S1, a late timer postpones a younger hold | No timer exists. A prune runs in a commit, at that commit's time, in one pass. | verified by experiment (prune), read in source (no timer) |
| 3 | Does 001-228 leave a path to the one-hour backstop? | Yes. A `run --all` retry queued before the answer's `refined()` task hangs on a wedged runner. The held answer then ends only at `HOLD_MS`. The store already covered the capture 10 simulated minutes earlier. The baseline path is the same shape. | verified by experiment (retry), inferred (baseline) |
| 4 | Lines and tests a switch removes | About 470 source lines and about 720 test lines removed; 9 test files rewritten. See below. | read in source code |
| 5 | Store change it needs | A second meta row per worktree beside `rekeyed.<id>`. No schema migration. See below. | inferred from the prototype |

## Findings

**F1. Why today's store record cannot answer.** `rekeyed-record.ts:27-31` keeps one `{open, last}` per test file. It has no resolve time and no per-revision history. A store read can name only open moves, and that is exactly 13k S1's failure: the `openOnly` control in `13k-s1.probe.ts` returns `quiet`, 0 files, `otherTransitions: 1`. A per-file entry loses the earlier revision to a later cached move, and that is 13l S1's failure: the `perFile` control in `later-discharge.probe.ts` returns `quiet`, `testFiles: 2`, `otherTransitions: 1`. Verified by experiment.

**F2. The prototype that passes** (`shadow.ts`). The record is written inside `Ledger.commit`'s transaction, from the marks `recordRekeyed` already receives (`ledger.ts:402-425`). Per file it keeps `revision -> null | {seq, at}`. A mark with `open !== null` sets both `open` and `moved` to null, so a move back to a resolved revision reopens it. A mark with `open === null` resolves every open entry at this commit's `seq`. A cache hit that moves and resolves in one commit arrives as `{open: null, moved: R}` and is stored resolved at R; this is the 13l S1 case. The wait reads `seq` beside its start view. The answer has three parts:

- every entry at a revision in `(after, upTo]` that is open, or was resolved at a `seq` past the start;
- `incomplete` when `dropped > sinceSeq`, so the wait falls back to D7's no-sync path and never ends quiet;
- nothing until the store's refined revision reaches `upTo`.

A commit sequence replaces today's two clocks. Today the daemon stamps a discharge at `applyResults` and the CLI stamps its own start, so the sequence is exact where the clocks are not (F6). Verified by experiment.

**F3. The prune must wait for refinement.** On the first run, the prune was by age alone. The 13s B2 case then failed: the commit that finally landed the stalled runner part pruned math's entry in that same transaction, before the wait could read. The answer was `incomplete` where `answered` was expected. The rule that passes: a commit prunes resolved entries older than `G` only when refinement has been caught up for a grace, 60 s in the probe. Caught up means the refined revision at least equals the latest revision, read before this commit writes its own. A new revision resets the catch-up. The `ageOnly` control keeps the old rule and falls back. Why the rule is safe (inferred): while caught up for the grace, every captured revision was refined at least the grace ago, so every polling wait has already read its answer. Two cases are left for the watermark, and both fall back rather than end quiet:

- a wait whose capture lagged its start by more than `G`;
- a wait that could not poll during the grace.

**F4. Per probe.**

| Review case | Store-read result | Control that fails as the review found |
| --- | --- | --- |
| 13k B1 | Both waits stay open while a's re-run is held, then `quiet`, 1 file, 0 pending | `noReopen`: both `quiet`, 0 files, a still pending |
| 13k S1 | `news`, 1 own transition, 1 file, 0 other | `openOnly`: `quiet`, 0 own, 1 other |
| 13l S1 | `news`, 3 files, 0 other (with and without the cached edit) | `perFile`: `quiet`, 2 files, 1 other |
| 13q S1 count | `news`, 3 files, with 10,050 later resolved entries | none needed: no count cap |
| 13q S1 age, 13t S1 | `news`, 3 files, after a commit at +1 h while held | `ageOnly`: `news` with no edit window (fallback) |
| 13r B2 | 40 revision-only syncs answered, 0 in flight; 40 waits `timeout`, record unchanged; pruned to empty an hour past the catch-up | (not applicable: no per-request state) |
| 13s B2 | `news`, 3 files, after +2 h with no commit while held | today: `INCOMPLETE_ANSWER` at the hour (`later-discharge-wait.test.ts`) |
| D5 path | Store covers the capture once the runner part is abandoned | today's held answer pending 10 min later; `INCOMPLETE_ANSWER` only after `HOLD_MS` |

**F5. 001-228 and the backstop.** `refined()` (`scheduler.ts:308-310`) queues behind every runner task (`runner-work.ts:199-208`). That includes a `run --all` retry, `afterTier(retryRunner)` at `scheduler.ts:274-279`. `retryRunner` (`revision.ts:85-95`) calls `environment`, `testFiles` and `closure` through `tryRunner` with no bound, under the lock (D5, `spec.md:116`). `d5-backstop.probe.ts` sets this up as follows:

1. The runner is broken at the baseline, and `environment` never answers.
2. A revision's runner part is abandoned at its 2 s bound.
3. `run --all` is queued during that part, and an answer is taken after it.
4. Once the retry starts, the answer is still pending 10 simulated minutes later, with 1 hold. It ends with `INCOMPLETE_ANSWER` only after `HOLD_MS`.

The store's refined revision covered the capture when the runner part was abandoned. A store-read wait answers then and never waits for the retry. Verified by experiment.

The baseline is the same shape, read in source and not probed. An install that ends the install wait runs `#baseline` under the lock inside `handleBatch` (`scheduler.ts:188-194`), and `refined()`'s task needs that lock.

Both designs share one limit: the sync's own reconciliation needs the lock (`daemon.ts:489`, `handleBatch`). A retry or a baseline that hangs before the capture leaves the wait pending until its own `timeout`. It never ends quiet, and no hold exists then.

**F6. A clock gap today, which the sequence closes.** Inferred from source; not probed. `#discharge` stamps `context.now()` at `applyResults` (`ledger.ts:462-464`, called at `tiers.ts:428`). The tier's `commit` comes after the loop over every file, with `storeResults` writes in between (`tiers.ts:460`). The CLI stamps `startedAt` after its start read (`status-wait.ts:181-184`). Suppose a start read lands between a file's discharge and the tier's commit. Its view lacks the result, `startedAt` is later than the discharge, and the attribution is already cleared. The edit's news would then count as other news. The window is the length of one tier's result loop, longer on a loaded host. A commit sequence read with the start view has no such window.

**F7. Restart.** Inferred from source. A successor daemon starts with no `keyedAt` and no discharges (`rekeyed-record.ts` header; `ledger.ts:455-460`, review wave 13v S1). The store record survives a restart, so a wait that re-syncs with a successor (`status-sync.ts:101-107`) still reads the earlier moves.

## Lines and tests a switch removes

Removed from `src` (read in source):

- `scheduler/discharges.ts` (249 lines).
- `daemon/sync-requests.ts` (32).
- `refined`, `rekeyedSince` and `rekeyedOnceRefined` in `scheduler.ts:308-358` (51) and their contracts in `types/scheduler.ts:212-249` (38).
- `Ledger.discharges` and its `note`/`forget` calls (`ledger.ts:77-78`, `112-113`, `145`, `464`).
- `FileState.lastKeyedAt` (`files.ts:30`, `90`, `112`, `118`).
- `#syncs` and the `after` path of `#requestSync` (`daemon.ts:42`, `131`, `426-428`, `470-503`); `sync` then always answers after reconciliation.
- `forgetSync` and `sync-forget` (`handlers.ts:24`, `49-61`, `189-192`; `desk.ts:35`, `165-166`, `221`; `front-desk.ts:63`; `desk-messages.ts:55-58`).
- `after`, `resolvedSince` and `rekeyed` on the wire (`types/daemon.ts:81-92`, `193-206`; `protocol.ts:27-34`; `handlers.ts:86`, `121`).
- The `after`/`resolvedSince` plumbing in `cli/status-sync.ts`.

That is about 470 lines. About 150 come back: the record (the prototype is 150 lines with its controls) and the window read in `status-wait.ts`.

Removed tests: `discharges.test.ts` (254), `held-answers.test.ts` (101), `held-deadline.test.ts` (169), `held-socket.ts` (105) and the forget cases of `daemon/sync.test.ts` (from line 195 to the end).

Rewritten tests: the cases they prove move to the record and the store-read sync. The files are `resolved-wait`, `later-discharge-wait`, `environment-growth-same-revision`, `environment-growth-wait`, `environment-growth-siblings`, `rekeyed-wait` and `rekeyed.test.ts` (which call `rekeyedSince`); `delivery/edits-confirmation.test.ts:182` (`ledger.discharges.since`); and `environment-growth.test.ts:95`.

## The store change

Use a second meta row per worktree, `rekeyed-moves.<worktreeId>`, written in `Ledger.commit`'s transaction beside `rekeyed.<id>`. Leave `rekeyed.<id>` untouched, so an older plugin's hooks keep reading `[open, last]` (`readRekeyed` skips a shape it cannot read). The row holds four things:

- `seq`, incremented every commit;
- `caughtUpAt`;
- `dropped`, the latest `seq` a prune removed;
- per test file, the earliest and latest open revision and each resolved revision's `{seq, at}`.

The prototype keeps intermediate open revisions too. `after` is always 0 since 001-191, so only the earliest open revision matters for a wait.

There is no schema migration. The schema is still V1 (`schema.ts:208`), and a newer `user_version` is refused by older Squeal (`open.ts:72-74`), which a shared store must avoid. The row joins 001-254's prefix table and is removed with the worktree.

Mixed versions fall back and never end quiet. An older CLI sending `after` gets no `rekeyed`, so it takes its "daemon before 001-186" path (`status-sync.ts:95`). A newer CLI that finds no `rekeyed-moves` row takes D7's no-sync path.

Size: one entry per resolved move for `G` past the catch-up. On cezar's suite this is small. A 10,000-file environment re-key would rewrite about 1 MB of JSON per commit for an hour (inferred, not measured). If that ever matters, a count cap stays correct because of the watermark.

The one-worker row: "001-2xx `status --wait` from the store. Add `rekeyed-moves.<id>` (per file and revision, commit `seq`, `caughtUpAt`, `dropped`) in `Ledger.commit`'s transaction. Prune resolved entries older than an hour only after refinement has been caught up for 60 s. The wait reads `seq` with its start view and reads the window in the first poll whose `refinedRevision` covers the captured revision; `dropped > seq` falls back. `sync` answers after reconciliation only. Remove `Discharges`, `SyncRequests`, `sync-forget`, `rekeyedOnceRefined`, `rekeyedSince`, `refined` and the wire fields. Own `src/core/scheduler/` (ledger, record, scheduler), `src/core/daemon/` (sync path), `src/cli/status-sync.ts`, `src/cli/status-wait*.ts`, `src/core/types/`, and the tests above. Done when: each case of `probes/wait-from-store` passes as a test against the product record, and each control's failure is red at that test's base where it applies; the D5 retry probe answers before the retry ends; lint, typecheck and the full suite are green with `GIT_CONFIG_GLOBAL=/dev/null` and `CODEX_SESSION_ID` unset." D7's held-answer paragraph (`spec.md:144`) is replaced; `KEY_FORMAT_VERSION` is unaffected unless a guarded source moves.

## Open questions

1. F6's clock gap in today's code is inferred, not reproduced. A probe needs the wait in another process, reading during one tier's result loop.
2. The record's size per commit on a large repository is not measured. The 10,000-entry probe checks correctness only.
3. The grace (60 s) and `G` (1 h) are the probe's choices. `G` only decides how late a wait may capture before it falls back. The grace must exceed a wait's poll gap under a busy store (`STATUS_BUSY_TIMEOUT_MS`).
4. The reconciliation's lock (F5, last paragraph) still lets a hung retry or baseline hold every wait to its timeout. That needs 001-228's bound extended to `retryRunner` and the baseline, not this change.

## Sources

- Reviews: `reviews/wave-13k.md` (B1, S1), `wave-13l.md` (S1), `wave-13q.md` (S1), `wave-13r.md` (B2), `wave-13s.md` (B2), `wave-13t.md` (S1).
- Source at 8e5e5462: `src/core/scheduler/{discharges,rekeyed-record,ledger,scheduler,runner-work,revision,tiers,files}.ts`, `src/core/daemon/{daemon,handlers,desk,front-desk,desk-messages,protocol,sync-requests}.ts`, `src/cli/{status-wait,status-wait-edit,status-sync}.ts`, `src/core/delivery/edits.ts`, `src/core/store/{schema,open}.ts`, `spec.md` D5 (line 116) and D7 (line 144).
- Existing tests the probes copy: `test/scheduler/{resolved-wait,later-discharge-wait,environment-growth-same-revision,held-socket}.test.ts`.
- Probes: `research/probes/wait-from-store/` (README has the command and the recorded run).
