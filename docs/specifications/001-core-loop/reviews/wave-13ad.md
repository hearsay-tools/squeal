# Wave 13ad: re-review of the store-wait repair (001-266)

## Verification output

Candidate: `2ec0efa1`, package 0.1.115. Range: `6864b726..2ec0efa1`. Actual HEAD was `3d70ac0f6b8e76fcec4397ef7bdec0c8eb4ff940`: the only later change is `docs/board.md`. This is the documentation-only continuation named in the assignment, not an executable mismatch. All checks and probes ran with the candidate's exact executable sources and committed bundles and a clean tracked tree, before this report was written. Interleaved spec 006 repairs are outside this bounded product review; the full suite includes their tests.

Linux, Node 24.21.0, Vitest 5.0.3. The independent suite ran directly with the requested environment and four workers. No Squeal checkpoint replaced it. No product, test, board, specification, status or distribution file was edited. `npm run build` was explicitly forbidden and was not run; reproducible build and macOS execution are **unverified**, not blockers.

```text
$ npm ci
added 56 packages, and audited 57 packages in 1s
found 0 vulnerabilities
(exit 0; unapproved @parcel/watcher and esbuild install-script warnings)

$ npm run lint
> squeal@0.1.115 lint
> biome check .
Checked 828 files in 301ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.115 typecheck
> tsc --noEmit
(exit 0)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --maxWorkers=4
Test Files  4 failed | 369 passed | 1 skipped (374)
     Tests  4 failed | 2842 passed | 10 skipped (2856)
    Errors  1 error
Duration 567.53s
(exit 1)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run test/status/slow-tier.test.ts test/cli/status-wait.test.ts test/watcher/foreign-links.test.ts test/harness/attribution.test.ts --maxWorkers=1
Test Files  4 passed (4)
     Tests  65 passed (65)
Duration 18.97s
(exit 0; no unhandled error)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run test/harness/primer-listing.test.ts --maxWorkers=1
Test Files  1 passed (1)
     Tests  9 passed (9)
Duration 914ms
(exit 0)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --config <external>/vitest.config.mts --reporter=verbose
Test Files  1 passed (1)
     Tests  11 passed (11)
Duration 12.53s
(exit 0; characterization assertions reproduce the blocker and the pre-existing note)

$ cmp plugins/claude-code/dist/cli/squeal.mjs plugins/codex/dist/cli/squeal.mjs
(no output, exit 0)
```

The independent full suite is **red**. Each failed test exceeded its 5 s limit: `test/cli/status-wait.test.ts:110`, `test/harness/primer-listing.test.ts:94`, `test/status/slow-tier.test.ts:114` and `test/watcher/foreign-links.test.ts:105`. The unhandled error was the status-wait test's delayed mutation after teardown closed the store (`database is not open`, `ERR_INVALID_STATE`, timer at `status-wait.test.ts:113`). Each complete failed file passed in its one serial retry, with no assertion, source or timeout changes. The coordinator's failed attribution file passed in this full run and in the retry group. These retries do not make the full run green.

Sampled host load during probes was about 19 to 24 and was 7.2 at the suite's end. Concurrent Squeal baseline reports named load 33.79 and failures in daemon/harness/e2e tests; they were read but are not this independent gate. Contention is a **plausible** explanation for the timeouts. A causal connection to this repair is **unverified**, so they are not additional blockers. All changed product regression files, retained wait regressions and the key-format guard passed in the independent full run.

The external probes used the actual 0.1.112 sources and CLI extracted from `cf7e8a2c`, the actual range-base wait from `6864b726`, and the candidate's production wait, synchronizer, socket servers/handlers, ledgers, state sink and store. The stronger round-trip probes computed keys with the production `KeyIndex`, changing only its supplied closure paths. This is a controlled runner stimulus, not a live older full-daemon process or an operating-system handover test. Both schema V1 and key-format 5 are shared with 0.1.112. The committed 0.1.115 CLI independently reproduced B1 below. The final eleven probes all passed without changing the candidate. Disposable probe sources, predecessor copies and private sockets were removed before commit.

The exact external probe [source snapshot](/p/squeal/tasks/e6701009-5d69-4630-8755-f76833dd4345/files?artifact=994723fe-abd9-4687-8197-956b4f07dc42) and [output snapshot](/p/squeal/tasks/e6701009-5d69-4630-8755-f76833dd4345/files?artifact=a1bf3379-29b2-4db5-b702-c7680d143940) are published task artifacts. To replay, save the source as `/tmp/squeal-001-266-probe/probe.test.ts`, link `current` there to this checkout, extract `src` and `package.json` from `cf7e8a2c` into `old` and from `6864b726` into `base`, and link their `node_modules` to this checkout's. Also extract `plugins/claude-code/dist/cli/squeal.mjs` from `cf7e8a2c` into `old`. Use an external Vitest config selecting only that probe, `maxWorkers: 1`, `testTimeout: 30000`. The assertions intentionally characterize the current false-quiet responses; turn those into expected timeout/no-window assertions for repair tests.

## Verdict

**FAIL 2ec0efa1: 1 proven blocker. N1 is closed. One proven pre-existing limit is recorded separately as a note.**

The original single-move B1 reproduction is repaired, including replacement after the window. The row mark is nevertheless a snapshot of values, not evidence of which writer wrote them. A same-revision key round trip by an older writer restores those values and escapes both polling and takeover adoption. The mixed-version guarantee therefore remains incomplete.

## Blockers

### B1. A same-revision older-writer round trip restores the mark while leaving an unrecorded edit pending

**Proven by actual old-ledger commits, production-key calculations, real sockets and the committed candidate CLI.** Locations: `src/core/scheduler/moves-keys.ts:19`, `:24`, `:38`; `src/core/scheduler/rekeyed-moves.ts:138`, `:149`, `:293`; `src/cli/status-wait.ts:197`, `:208`; first-commit adoption is `src/core/scheduler/ledger.ts:422`.

The required D7 behavior is to hold for every test file whose key the captured revisions moved, until its result or terminal unknown. Task 001-265 requires that the review's successor cases "never end quiet while an unrecorded captured-edit key is pending", and the re-review explicitly asks about older or newer succession before or after the window.

`KeyMark` holds only `[row.revision, digest(row.key)]`. The actual older `Ledger.commit` writes `ledger.revision.number` on each dirty row, not a monotonically increasing key-move number. `settle` can move a file's key twice while that workspace revision stays fixed, and a miss remains queued through both moves. In particular a backlog file with no result at its original key need not become current when the key returns to it. The mark's equality then says nothing about the intervening writer or move. This is not a hash collision.

Reproduction at the public CLI boundary:

1. The candidate's record vouches for A at key K and row revision 4, queued as baseline/backlog with no result at K and no edit move in `moves.files`. B has an open edit move at 4. The store's current revision is 4, its refinement is 3.
2. The actual 0.1.115 CLI starts `status --json --wait 1500` and receives the candidate handler's real sync answer `{revision: 4, moves: true}` over a private Unix socket.
3. Replace that server with the actual 0.1.112 handler and update the worktree's daemon record. Using the actual 0.1.112 `Ledger`, apply a supplied closure that adds `src/extra.ts` to A, call `settle([A], empty, {keyedAt: 4})`, and commit. A moves K to K2 and is queued at row revision 4.
4. Supply A's original closure, settle it with the same attribution, apply B's passing result through the actual sink, and `commit({refined: 4})`. A moves K2 back to K, still queued, still attributed to revision 4 in the legacy record. Both key moves and the row revision are actual production calculations/writes. The moves row stays byte-identical because this old ledger never writes it.
5. The next CLI poll sees the old marks match again. It accepts the B-only edit window, sees B completed, and returns quiet with A still pending.

Observed from the committed CLI, exit 0:

```text
Returned on quiet: nothing the edits since revision 4 re-keyed is pending
(1 test file) at revision 4 after 0.5 s; 1 check pending in all

wait = { outcome: "quiet", transitions: 0,
         edit: { since: 4, testFiles: 1, pending: 0, otherTransitions: 0 } }
A = { key: K, revision: 4, pending: "queued" }
legacy[A] = { open: 4, last: 4 }
movesVouch(...) = true
unrecordedRows(...) = []
```

The same schedule after the source wait installed its B-only window also returns quiet. Both old commits occur between two polls; relying on a poll to observe K2 is not a guarantee. A separate old-then-new probe makes both old commits before a newer ledger's first commit and before the wait's sync. `unrecordedRows` returns empty, the newer first commit leaves the sequence/drop watermark unchanged, and B's subsequent result makes the new wait quiet with A queued. Thus the startup repair also mistakes the final values for provenance.

A discriminating control keeps refinement at 3 until a **candidate** ledger performs the same K to K2 to K moves and completes B. Its record contains A's open move; the wait times out with two edit files and one edit pending. The old writer's missing move record is what makes the before-refinement case quiet.

The worker's notes correctly identify two weaknesses of *bare* alternatives: binding only to the answering daemon misses an old-then-new takeover, and a token that changes only when the numeric refined revision advances misses writes and growth at that same revision. They do not establish that those strategies cannot cover the brief. Nor does checking current key values solve writer ownership. The notes expressly cover ABA "at a later revision"; the unhandled case is ABA at the same row revision. Closure replacement and environment discovery are not specified as irreversible, and the key index imposes no such restriction.

One worker's bounded repair: keep the store design, schema V1, additive compatibility and no holds. Make trust across succession depend on actual writer/incarnation continuity, including invalidation/adoption on takeover even when all row values match. Bind an installed window to that continuity and abandon it when the writer cannot be verified. An answering-daemon check alone needs the startup counterpart for an older writer before the answer; a refinement-only token needs coverage of every key write. Current-value comparisons may remain an optimization, but cannot certify the absence of same-revision intervening writes. Preserve ordinary same-daemon edit waits' exclusion of unrelated baseline/slow work. Retain this same-revision round-trip probe before refinement, after the window, and across old-then-new adoption, with the candidate-writer control.

This is the second round. The parent was notified during review; another repair/review decision belongs to the human.

## Should-fix

None introduced by the bounded repair.

## Nits

None. **N1 closed, proven by source inspection.** `status.md` now has dated 2026-10-11 amendment entries for 001-253/D2, 001-258/D7 and 001-265's repaired contract. `spec.md` D7 names the record's keys and poll/adoption rules. The stale `SyncState.rekeyed` comment in `status-wait-edit.ts:47` now names `answerMoves`. The advertised ownership guarantee still fails under B1; the amendment log itself is present.

## Notes outside the repair

### S1. New moves recorded after a window is installed do not extend its membership

**Proven, pre-existing at `6864b726`; not a second blocker against this range.** `src/cli/status-wait.ts:193` reads `answerMoves` only while no window exists. The per-poll addition verifies writer/key marks but never refreshes membership from moves. In the same B-only window setup, a candidate ledger can record A's same-revision move after installation, complete B, and leave A queued. The cached window still returns quiet. The external probe ran both candidate and actual base `waitForStatus` against the same candidate-writer schedule; both returned `{outcome: "quiet", edit: {testFiles: 1, pending: 0}}`.

This qualifies the answer to "any ... newer ... after the window": yes, a newer writer's additional same-captured-revision membership can still be missed, even though its record itself is complete. It is not an unrecorded-key regression introduced by 001-265. The human/coordinator can choose a later row to refresh or conservatively invalidate membership when a commit adds a captured-window move. No product or board repair was made by this reviewer.

## What fits and answers to the brief

| Case | Independent result |
| --- | --- |
| Original real-socket new sync, old single key move before refinement | timeout, no edit window, A queued; actual old handler and ledger |
| Candidate writer instead of old writer, same single move before refinement | timeout, one edit file and one pending |
| New CLI, static old daemon with `moves` absent and a leftover marked record | timeout, no edit window |
| Actual 0.1.112 CLI, static candidate socket | exit 0, timeout, no edit window, pending remains |
| Older successor, one key move after an installed window | timeout, no edit window, with actual old handler and ledger; also green in the full suite |
| Older successor, same-revision round trip before refinement or after window | **quiet with A queued**, B1 |
| Old round trip, then newer ledger first commit and newer sync | **quiet with A queued**, B1; nothing is adopted |
| New writer, same round trip before refinement | timeout, two edit files, one pending |
| New writer adds a captured-revision move after window | quiet with A queued at candidate and base; pre-existing S1 |

The per-poll checks run in the same read transaction as the window decision, including after window installation. A detected mismatch permanently takes the broad fallback. Missing marks from 0.1.113/0.1.114 are rejected, and the first commit takes unmatched pending rows in before its own upserts, setting the dropped watermark in that transaction. These are the right safeguards for the cases in which a mismatch remains observable. A later-revision round trip differs in the row revision and is caught; the same-revision case is not.

The retained 001-258 regressions and the key-format guard are checked by the independent full suite. Source and bundles agree on the new per-file mark path, both committed CLI bundles are byte-identical, and the repin changes only the unreleased version-5 hash. Earlier shipped pins and `KEY_FORMAT_VERSION = 5` remain unchanged. This is inspection and test evidence, not a rebuild. The record remains one transactional meta row, and no request holds, timers, forget transport or migration were restored. Per-poll all-file hashing and retained size remain unmeasured, as the accepted research and worker notes state.

## Inputs for the next wave

1. Route B1 to the human. Do not dispatch an automatic third round on this second-round result.
2. If authorized, repair writer continuity at both takeover and every window poll. Same-revision round trips must never restore trust solely by restoring row values. Keep the actual 0.1.112 CLI fallback and both static controls.
3. Preserve move recording inside the ledger transaction before refinement, start-view/sequence atomicity, resolved move history, refinement-aware pruning, legacy hook attribution and the broad fallback for unverifiable coverage. Do not resurrect held sync answers.
4. Keep S1 separate as the proven pre-existing membership limit. Keep the independent full-suite result exactly as recorded, distinct from its serial retry and concurrent Squeal reports.
