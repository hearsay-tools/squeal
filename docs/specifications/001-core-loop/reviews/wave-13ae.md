# Wave 13ae: third review of writer continuity (001-269)

## Verification output

Candidate: `64f2a64f`, package 0.1.116. Range: `4f9c33f2..64f2a64f`. Actual HEAD: `d0c01079b854f1577bcbcb41f29e9b60210b5ebe`; its sole later change is `docs/board.md`, as the assignment allows. The executable sources and committed distributions are the candidate's. Review scope is `wave-13ad.md` B1 only, including the human's narrowed first-commit adoption and the agreed clean-exit identity retention. Interleaved spec 006 work is outside that scope; the independent suite includes its tests.

Linux, Node 24.21.0, Vitest 5.0.3. The independent full run and final external probes ran on a clean tree before this report; retry provenance is recorded below. The independent suite ran directly with the requested environment and four workers; no Squeal checkpoint replaced it. No product, test, board, specification, status or distribution file was edited. `npm run build` was explicitly forbidden and was not run. Build reproducibility and macOS execution are **unverified**, not blockers.

```text
$ npm ci
added 56 packages, and audited 57 packages in 1s
found 0 vulnerabilities
(exit 0; unapproved @parcel/watcher and esbuild install-script warnings)

$ npm run lint
> squeal@0.1.116 lint
> biome check .
Checked 836 files in 247ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.116 typecheck
> tsc --noEmit
(exit 0)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --maxWorkers=4
Test Files  1 failed | 379 passed | 1 skipped (381)
     Tests  1 failed | 2896 passed | 9 skipped (2906)
Duration 516.32s
(exit 1)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run test/cli/status-wait-successor.test.ts --maxWorkers=1
Test Files  1 passed (1)
     Tests  3 passed (3)
Duration 5.39s
(exit 0; first serial retry)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run test/cli/status-wait-successor.test.ts --maxWorkers=1
Test Files  1 passed (1)
     Tests  3 passed (3)
Duration 5.38s
(exit 0; clean-tree confirmation)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --config /tmp/squeal-001-269-probe/final.config.mts --reporter=verbose
Test Files  3 passed (3)
     Tests  35 passed (35)
Duration 44.81s
(exit 0)

$ cmp plugins/claude-code/dist/cli/squeal.mjs plugins/codex/dist/cli/squeal.mjs
(no output, exit 0)
```

The independent full suite is **red**. The sole failed test, `test/cli/status-wait-successor.test.ts:24`, exceeded its 5 s outer limit (reported duration 6,676 ms). There was no assertion failure or unhandled error. The complete failed file passed in each of two serial retries, with unchanged source, assertions and timeout: 3 of 3 in 5.39 s, then 3 of 3 in 5.38 s. The first retry had only this untracked report draft present; the second ran after moving that draft outside the checkout, on a fully clean tree. Neither retry makes the full-suite result green. All other changed regressions, retained wait tests, real-daemon predecessor/step-down tests and the key-format guard passed in the full run.

Sampled host load rose from about 16 to 44 during the independent run and was 3.56 near its end, then 2.06 after retries. The direct original-succession external probe also took 6.9 s during contention, with its 30 s outer limit, and passed its outcome assertions. Contention is a **plausible** explanation for the timeout; the cause and a causal connection to the repair are **unverified**, not an additional blocker. No timing or product fix is proposed. The suite also printed two gitdir-repair notices from fixtures and one dead-earlier-run process sweep; neither produced an additional failed test or error. Squeal's concurrent baseline separately reported a timeout in `status-wait.test.ts:405`, then recovery under the same inputs and a completed revision-0 checkpoint; those reports were read and do not replace this independent gate.

The external probes replay every one of the eleven published wave-13ad probes, including wave-13ac's original real-socket successor, static old-daemon fallback, new-writer control and actual 0.1.112 CLI. They use actual 0.1.112 sources and CLI from `cf7e8a2c`, the actual base wait from `6864b726`, the actual 0.1.115 CLI from `2ec0efa1`, and the candidate's production synchronizer, handlers, socket server, ledgers, sink, store and `KeyIndex`. Only supplied runner closures and mutation scheduling are controlled. The old-then-new replay now registers both incarnations before their writes, as real daemons do. The old release's clear is its actual `createWorktreeRepo(...).setDaemon(null)`, not a guessed SQL replacement. Additional probes exercise twelve succession combinations, four predecessor-exit/adoption cases, two new-to-new restarts, clean-exit liveness and both legacy CLI boundaries. Two further probes start real candidate source daemons, request stop or step-down over their private sockets, await exit and restart them.

The final 35-probe run passed unchanged product code. Earlier iterations of the supplementary external fixture failed because it updated a nonexistent worktree row, defaulted an explicitly unknown predecessor to the known writer, asserted an exact membership list instead of inclusion, and used the wrong snapshot property. These were probe errors, corrected before the final run; they are not evidence against the candidate. No live repository daemon, store or worktree was replaced. The succession matrix controls registrations and actual ledger writes; it does not claim to launch complete legacy daemon processes or simulate an operating-system crash. Disposable sources, predecessor copies and private sockets were removed before commit.

Replayable [probe source snapshot](/p/squeal/tasks/c2bd3b0b-35d9-4df6-9f50-d06da28ba641/files?artifact=973db00d-dc61-4fc6-abea-2fd80407f20d) and [final probe output snapshot](/p/squeal/tasks/c2bd3b0b-35d9-4df6-9f50-d06da28ba641/files?artifact=c80c43ae-83b8-4a91-bccc-3a9867b3c668) are published task artifacts. The source snapshot includes setup instructions and all three probe files. The [verification output snapshot](/p/squeal/tasks/c2bd3b0b-35d9-4df6-9f50-d06da28ba641/files?artifact=41726202-f389-4c8d-ae93-bcd9065d7b76) preserves the full gate and both retries.

## Verdict

**PASS 64f2a64f: B1 closed, 0 proven blockers, 0 should-fix, 0 nits.**

Within the specified distinct-incarnation and single-writer registration contract, no tested succession makes a candidate wait trust moves its answering incarnation did not keep. The old writer's restored key values no longer restore trust. The predecessor check also closes the old-then-new gap without making ordinary new-to-new restarts adopt unrelated backlog.

## Blockers

None. **B1 closed, proven by external actual-ledger/key/socket/CLI probes and source inspection.** The requirement is still D7's result before quiet for every captured edit's re-keyed test file, with broad fallback when coverage cannot be verified. The repair checks ownership rather than row-value coincidence:

1. `daemon.ts:267` reads the predecessor before overwriting registration, in the registration transaction. The worktree lock is already held. Every inspected released daemon also registers before its loop can write rows. An older writer therefore leaves a different predecessor even if K -> K2 -> K restores every key and row revision.
2. `ledger.ts:422` adopts before the first upsert when the predecessor is unknown or differs from the moves' writer. `recordMoves` opens every previously pending row and advances `dropped` in the same commit transaction as row updates and refinement. A restored value cannot evade adoption. Fresh worktrees skip it; a known predecessor that wrote the moves also skips it because its commits already kept that record.
3. `handlers.ts:110` names the answering incarnation; `status-sync.ts:80` accepts it only with `moves: true`. `rekeyed-moves.ts:159` requires the record's writer, answering incarnation and registered daemon to match, with retained coverage. `answerMoves` checks that before checking refinement. `status-wait.ts:217` checks it again after window installation, inside the same read transaction as the decision. A mismatch permanently discards the window. Registering a new daemon without committing yet already invalidates the old wait.
4. A clean exit still removes the socket and interval. `worktrees.ts:64` preserves only the predecessor identity in addition to the already preserved heartbeat. It does not retain a live `DaemonRecord`: `toRecord` gates that on the socket. Thus exits cannot authorize a window, while a later new daemon can identify the predecessor accurately.

These checks cover arbitrary finite chains of distinct registrations: if the last predecessor wrote the record, no later unrecorded writer ran under another registration; if it did not, or cannot be identified, the first commit adopts. A waiting reader binds to the incarnation that answered, so a different subsequent registration or writer invalidates that reader even when a successor legitimately preserves the prior move history. A poll need not observe the intermediate key or intermediate daemon.

## Answers to the brief

| Succession or control | Independent result |
| --- | --- |
| 13ac: new sync, actual 0.1.112 handler/ledger, one unrecorded key move before refinement | timeout; no edit window; moved key queued |
| Same writes by the answering candidate ledger | timeout; one edit file, one pending |
| Static new CLI, old handler with no moves/incarnation, leftover newer record | timeout; broad fallback |
| Actual 0.1.112 CLI, static candidate socket/record | exit 0; timeout; no edit window |
| 13ad: actual old ledger's single move after the window | timeout; window discarded |
| Old K -> K2 -> K at one revision between polls, before refinement | committed 0.1.116 CLI: timeout, no window, A queued |
| Same round trip after the source wait installed B's window | timeout, no window; byte-identical moves row is rejected by registration |
| Old round trip, then new first commit, then new wait | A adopted; timeout, two edit files, one pending |
| Answering candidate's own round trip before refinement | timeout, two edit files, one pending |
| Older, newer or unverifiable successor, before refinement or after window, at one or across revisions | all twelve combinations timeout with no window; A stays queued |
| Old round trip, crash-style registration left intact, then new | adoption and dropped watermark; later wait holds A |
| Same with clean clear preserving the old identity | same; old identity differs from record writer |
| Same with actual 0.1.112 clear erasing the old identity | unreadable predecessor; adoption; later wait holds A |
| Same with unreadable predecessor version | adoption; later wait holds A |
| New-to-new restart, crash-style or clean | no adoption; old incarnation cannot be trusted; new wait returns quiet on B with unrelated A backlog queued |
| Real candidate daemon stop and step-down (`superseded`), followed by restart | identity retained; status down after exit; restart writes new identity, `dropped` stays 0 |
| Clean exit without restart | store get/list, `recordedDaemon`, delivery liveness and public wait see down; wait returns `no-daemon`, no edit window |
| Actual 0.1.115 CLI, static candidate and original ABA schedule | both exit 0 and timeout without an edit window |
| Sync says moves but names no incarnation (0.1.113 to 0.1.115 contract) | timeout; no edit window |

The actual 0.1.115 CLI cannot certify this record: its required `keys` marks are gone. The actual 0.1.112 CLI continues to use its older broad path. Both static compatibility directions therefore remain conservative. Missing, different or unverifiable incarnations never authorize a candidate window. Adoption covers `queued` and `running` pending rows; actual registration releases leftover `running` rows before its first heartbeat. The full suite retains fresh-start and wait-before-first-commit controls in `status-wait-first-commit.test.ts`, actual daemon predecessor capture in `first-commit-predecessor.test.ts`, and the record/store tests.

## Liveness and packaging

**Proven by source inspection and real-daemon exit probes:** retaining `daemon_started_at` and `daemon_version` changes no liveness read. All product reads of those raw columns are in `WorktreeRepo`; only the new `lastDaemon` deliberately reads them without a socket. `get` and `list` use `toRecord`, which still returns `daemon: null` when `daemon_socket` is null. Status and delivery use that record plus the last heartbeat, socket lookup uses `recordedDaemon`, hooks' ensure and step-down paths use that record, and claims/slow-state readers use it too. `heartbeat` still updates only rows with a socket. The inspected actual 0.1.112 getter has the same socket guard. The probes observe the same down-since heartbeat after stop and step-down, and a real restart keeps `dropped` unchanged. Retained identity neither makes a stale socket live nor suppresses spawning through ensure.

Both committed CLI bundles are byte-identical and contain the incarnation, poll check, predecessor/adoption and retained-identity paths. Key marks and `moves-keys.ts` are absent from production sources and the CLI. Version is 0.1.116; `KEY_FORMAT_VERSION` remains 5 and only its unreleased pin changes, with shipped pins 1 through 4 unchanged. This is source/bundle inspection, not a rebuild. Schema V1, the additive wire fields, transactional moves, legacy hook attribution and the absence of holds/forget transport remain intact.

## Notes outside B1

- **Proven, pre-existing, unchanged:** wave-13ad S1 still reproduces at both candidate and actual base `6864b726`. A same answering daemon can add A's captured-revision move after a B-only window was installed; the window remains B-only and returns quiet with A queued. The record itself kept the move, so this does not reopen writer-continuity B1. The separate 001-267 row owns membership refresh.
- **Plausible identity limit, not a blocker:** as the worker notes acknowledge, `<version>@<startedAt>` assumes distinct start milliseconds for successive daemons of one version. Exact wall-clock rollback or an injected repeated start time can alias that token. No real-process alias was observed or OS clock altered here. The review's succession conclusion is conditional on distinct incarnation IDs, not a proof that a wall-clock timestamp is collision-free.

## Should-fix and nits

None in this bounded third round. N1 was already closed by wave-13ad and is not reopened.

## What fits and inputs for the next wave

B1 needs no further repair. Keep incarnation propagation from registration through the scheduler and sync answer, the ownership check before refinement and at every poll, and predecessor capture before registration. Preserve the human's fast-wait exception for a fresh worktree or a record-writing predecessor; a legacy clear must remain unknown and adopt. Preserve schema V1, one-transaction moves/refinement writes, start-view sequence capture, resolved move history, retention/drop fallback and legacy hook attribution. Do not restore key marks or per-request holds.

Keep the independently recorded gate result distinct from the coordinator's gate and Squeal's concurrent baseline. Address 001-267 separately. Build reproducibility, macOS behavior and clock rollback remain outside this verification. Only this review file is committed.
