# Wave 13af: independent review (001-271)

## Verification output

Candidate and actual initial HEAD: `d72438e90b6c5d19b9a5b306e475e2fc125e8d5f`, package 0.1.120. Range: `d9fe66ba..d72438e90b6c5d19b9a5b306e475e2fc125e8d5f`. Linux, Node 24.21.0, Vitest 5.0.3. The tree was clean during the full gate and final probes. Spec 006 changes interleaved in this range are outside the assigned wave; their tests are included in the independent suite. The parent's later `1819ee6c` test-only git-GC fix was not included or reviewed.

No product, test, board, spec, status or distribution file was edited. No eval runner or repository script was run to check evals. The explicitly forbidden `npm run build` was not run. Build reproducibility and macOS are **unverified**, not findings or blockers. Daemon test helpers compile private source fixtures as the required suite normally does; they do not rebuild committed plugin bundles. Both committed CLI bundles compare byte-identical.

```text
$ npm ci
added 56 packages, and audited 57 packages in 1s
found 0 vulnerabilities
(exit 0; unapproved @parcel/watcher and esbuild install-script warnings)

$ npm run lint
> squeal@0.1.120 lint
> biome check .
Checked 860 files in 297ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.120 typecheck
> tsc --noEmit
(exit 0)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --maxWorkers=4
Test Files  397 passed | 1 skipped (398)
     Tests  3164 passed | 9 skipped (3173)
Duration 528.60s
(exit 0)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --config /tmp/squeal-001-271-probe/final.config.mts --reporter=verbose
Test Files  3 passed (3)
     Tests  35 passed (35)
Duration 58.89s
(exit 0)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --config /tmp/squeal-001-271-probe/legacy-token.config.mts --reporter=verbose
Test Files  1 passed (1)
     Tests  2 passed (2)
Duration 3.95s
(exit 0)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --config /tmp/squeal-001-271-probe/key-delta.config.mts --reporter=verbose
Test Files  1 passed (1)
     Tests  3 passed (3)
Duration 871ms
(exit 0)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --config /tmp/squeal-001-271-probe/death.config.mts --reporter=verbose
Test Files  1 passed (1)
     Tests  1 passed | 1 skipped (2)
Duration 9.68s
(exit 0; characterization reproduces B1, with a no-note positive)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --config /tmp/squeal-001-271-probe/virtual.config.mts --reporter=verbose
Test Files  1 failed (1)
     Tests  1 failed | 2 passed | 4 skipped (7)
Duration 8.78s
(exit 1; required rejection assertion fails at B2, both controls pass)

$ cmp plugins/claude-code/dist/cli/squeal.mjs plugins/codex/dist/cli/squeal.mjs
(no output, exit 0)
```

The independent full suite is **green**; no retry was required. The coordinator's earlier status-wait timeout does not recur in this run. The suite printed two fixture gitdir-repair notices and one earlier-run process cleanup; neither produced an error. Concurrent Squeal baseline timing failures recovered under identical inputs and its checkpoint completed, but neither the baseline nor the coordinator gate replaces this independent run. Sampled host load ranged from about 28 down to 7 during probes. The two required new behavior probes below establish blockers despite the full suite passing.

The 35-probe replay adapts 001-269's saved external probes to token-bearing candidate registrations and handlers; the after-window control now expects a joined window and timeout. It retains actual 0.1.112 ledger/handler/CLI sources from `cf7e8a2c`, the base wait from `6864b726`, and the actual 0.1.115 CLI from `2ec0efa1`. Two added probes use the actual 0.1.116 registration/handler and CLI from `d9fe66ba`. All legacy sources remain unchanged. The probes control runner closures and mutation scheduling, use production keys/ledgers/store/sockets/waits, and include actual candidate daemon stop, step-down and restart. They do not claim to launch complete older daemon processes.

Replayable [probe source snapshot](/p/squeal/tasks/3c042f05-1624-48d0-9fb7-5921f982ee82/files?artifact=13e5ba6c-1bdc-4873-bd0c-a90a0d4d78f9). The [verification output snapshot](/p/squeal/tasks/3c042f05-1624-48d0-9fb7-5921f982ee82/files?artifact=2f448572-0477-47c2-9cd5-08332540bdd6) preserves the complete independent gate and final external probe outputs.

Two preliminary probe mistakes were corrected externally: the death control called `MetaRepo.remove` instead of `delete`, and disabling outer virtual-fixture tests also disabled the generated inner test. Those runs are not product evidence. The final virtual reproduction executes the inner test, reaches its marker and produces the old-byte assertion failure below. No test or product source in the checkout was changed.

## Verdict

**FAIL d72438e9: 2 proven blockers, 1 should-fix, 0 nits.**

001-263 suppresses a real death after an ordinary note. 001-264 repairs file-module stamps but leaves virtual modules' declared-input stamps behind when invalidation drops their transform. Both violate the assigned behavior, and B2 also violates the vision's current-state honesty rule. The blockers were reported to the parent during review; the human decides the next repair/review round.

## Blockers

### B1. An ordinary diagnostic note suppresses death and in-flight run attribution

**Proven by real mid-tier SIGKILL, public snapshot/formatter and next session-start hook.** Location: `src/core/status/died.ts:28`; consumers: `src/core/status/snapshot.ts:103`, `src/core/delivery/liveness.ts:72`.

001-263 requires: "When the daemon is gone and its last heartbeat is stale with no stop note, status and the next hook say it died, and name the run and test files that were in flight". `withDeath` instead returns without checking the lock or runs whenever **any** persisted note has `at >= heartbeatAt`. These notes also hold watcher errors, runner failures, policy reloads and process cleanup, none of which proves shutdown (`Daemon.#note`, `src/core/daemon/daemon.ts:512`).

Reproduction uses the new real-daemon death test's fixture. While the held test is running, append one ordinary note, `watcher dropped events (probe); a full reconciliation follows`, at the real current time. SIGKILL the daemon, await its actual signal exit, then read at the same stale-heartbeat offset as the landed test. The lock is released, the registration remains and the open run still names the held test. No shutdown note exists. Nevertheless:

```text
snapshot.daemon = { state: "down", since: <last heartbeat> }
next hook = "No daemon has validated since <time>; results are as of revision 0."
(no died field, death sentence or in-flight run attribution)
```

Delete only the ordinary note, leaving registration, heartbeat, lock and runs unchanged. The same snapshot and hook then name the death and held test's run. This rules out timing and missing run evidence. The landed no-note SIGKILL control and SIGSTOP lock control are otherwise the right tests.

One worker's fix: distinguish actual shutdown evidence from arbitrary diagnostics, preferably an explicit additive stop marker bound to this daemon's identity, rather than classifying every note as a stop. Keep stale-heartbeat plus released-lock confirmation, normal clean exits, the held-lock SIGSTOP case and the prior down sentence. Add this ordinary-note-before-SIGKILL regression for both status and the hook.

### B2. A dropped virtual transform loses its declared input's run stamp

**Proven by a real Vitest adapter run and two discriminating controls.** Locations: `src/runners/vitest/sources.ts:125` to `:133` (new `hold`), `:185` (virtual input checks), `:198` (held checks); caller: `src/runners/vitest/adapter.ts:286`.

001-264 requires that invalidation keep the stamps of modules it drops for the run's end check; D4/001-146 rejects a result when the run read bytes its key does not name. The existing stamp tracker deliberately handles virtual modules whose plugin declares project inputs with `addWatchFile`. Their read stamps live in `reads.virtual.get(id).inputs`, not `reads.stamps`. The new `hold` walks only `cachedModules` and `reads.stamps`; `cachedModules` excludes an ID that names no project file. The invalidate's `stale` can establish the virtual input's stamp, but that stamp is not retained in `#held`, and the end check enumerates only transforms still cached.

Reproduction is the landed mid-run probe with a virtual import instead of the direct file import:

1. A real Vite plugin resolves `virtual:which` to `\0virtual:which`. Its `load` calls `addWatchFile(src/mod.ts)` and returns that file's source.
2. The test temporarily writes `which = "old"`, waits 2.5 s to make that source older than the stamp's racy window, then dynamically imports the virtual module. It signals `loaded` and waits.
3. The review calls `adapter.invalidate([{path:"src/mod.ts",kind:"change"}])` while the old bytes remain. The virtual module is dropped, with no moved-input report because those bytes still match.
4. Release the test. It restores `which = "new"`, then fails its assertion against the already loaded old value.
5. The candidate accepts the file and its failure as completed:

```text
end: "completed"
completedFiles: [{ project: "", path: "test/held.test.ts" }]
results: [{ outcome: "fail", errors: ["expected 'old' to be 'new'"] }]
failure: null
```

The required-rejection probe fails on `completedFiles == []`. With **no invalidate**, the same restore causes `completedFiles: []`, `results: []` and the expected "src/mod.ts changed on disk after this run loaded it" reason. With **no restore**, the invalidate run keeps the legitimate old-byte failure with `failure: null`, because disk and loaded bytes agree. This is lost stamp coverage, not a reason to discard every mid-run invalidate.

This is an uncovered variant of the in-scope repair, not a newly invented plugin contract: virtual declared inputs are already part of `SourceStamps` and the retained variant tests. The underlying erase mechanism predates the range, but the assigned stamp-preservation repair does not close it.

One worker's fix: retain every declared virtual input's stamp, or its unknown-read evidence, before invalidation erases the virtual transform, including inputs first stamped by that invalidate's `stale` call. Keep their actual virtual load time and compare them at run completion. Preserve per-project/per-variant separation, multiple invalidations and the unchanged-byte completion control. Add this real virtual-module regression and its two controls.

## Should-fix

### S1. The specification and amendment log still describe the previous contracts

**Proven by source/document comparison.** `docs/specifications/001-core-loop/spec.md:116` explicitly says baseline and retry calls "are not bounded", although 001-259 now bounds both. D7 at `spec.md:142` names only version/start-time incarnation and does not name the new token or refreshed window membership. `status.md` has no amendment for these changes in the reviewed range; 001-270's notes explicitly leave those amendments to the coordinator.

One coordinator documentation row: amend D5 for the per-call baseline/retry bound; D7 for token-bearing identity, tokenless predecessor fallback and sequence-triggered window refresh; D3 for the intended display/reporter exclusions, and add dated status entries. Preserve the human's first-commit adoption exception and schema V1. No documentation was repaired by the reviewer.

## Answers to the brief and what fits

| Row/question | Independent result |
| --- | --- |
| 001-259: retry and baseline wedges release waits | Landed wedge regressions cover each path; every relevant environment/listing/closure call uses a fresh per-part bound. No total-time timer is imposed across successful calls. |
| Can the bound cut off a call that would have finished? | Yes, a finite reply after its bound is dropped; an accelerated external probe demonstrates this and also accepts cumulative successful calls longer than one bound. This is the existing specified timeout policy, now applied to these paths. Default is 666 s for a 600 s run timeout, or 666 s for unbounded runs; per-call overhead can exceed the allowance. No ordinary default-budget call was observed falsely abandoned. It is not a guarantee that all eventually finite work finishes. |
| 001-260: only harness-derived key inputs change? | Canonicalization removes exactly `disableColors` and `isAgent`; package collection removes exactly built-in reporter names. External comparison against actual base code keeps all remaining config/environment/package inputs, including custom reporters, jsdom and custom runner modules. `allowOnly`, `browser.headless`, explicit env, include patterns and testTimeout still produce distinct hashes. The landed process-separated adapter test covers no harness, Claude, Codex, named agent, CI and GitHub Actions. |
| Do actual old and new key strings stay equal otherwise? | No: required `VITEST_ADAPTER_VERSION` 2 -> 3 re-keys all Vitest checks, and wave-wide `KEY_FORMAT_VERSION` 5 -> 6 re-keys all runner checks once. These were explicitly requested. Even without an agent, removing a false `disableColors` field or a phantom builtin package changes its old hash. The verified claim is absence of unrelated input normalization, not preservation of pre-upgrade key strings. |
| 001-261: eval/print entry arguments stop growing observed sets | Tests exercise -e, --eval, --eval=, -p, --print and -pe, retain the script entry and actual reads, and compare two cezar-style child runs across scratch roots. Recorder leaves actual read/write tracking active. |
| 001-262: .git kind, cross-worktree reuse | `.git` file bytes no longer key; file/directory/absent remain distinct, tracking is still required, and children/nested .git paths remain outside this special rule. Scheduler regression compares linked-worktree keys. Main-directory versus linked-file kinds intentionally differ. |
| 001-263: real death names the in-flight run in status and hook | No-note SIGKILL and held-lock SIGSTOP tests fit; ordinary-note case fails, B1. `RunRepo.inFlight` and `DaemonLiveness.died` are additive. |
| 001-264: direct-file probe and unchanged-byte completion | Landed direct-file repair and completion control fit. The virtual declared-input variant is incomplete, B2. Nothing in the held-stamp comparison intentionally rejects matching hashes; an unchanged stat/hash retains the result. |
| 001-267: after-window moves | Original after-window probe now times out with two edit files and A pending, including a same-revision round trip. Window reconstruction and trust checks share the decision's read transaction. The writer/drop tests precede refinement; refreshing cannot authorize another incarnation. |
| 001-270: token and succession | New incarnation is `<version>@<startedAt>#<token>`; randomUUID is drawn once per daemon and passed through registration, scheduler and sync. Released tokenless daemons return null identity; first commit adopts an unverifiable predecessor. A legacy registration leaves the meta row but its different version prevents claiming it, even at the same start time. Actual 0.1.116 CLI falls back against a token-bearing answer. |

The succession replay holds all twelve older/newer/unverifiable combinations before refinement or after installation, at one or across revisions. It retains original real-socket succession, same-revision ABA, old-then-new adoption after crash/clean/actual legacy clear/unreadable predecessor, fresh newer-writer controls, new-to-new backlog exclusion, no-incarnation sync, actual older CLI controls and real daemon exit/restart identity retention. Older writers never certify a narrow candidate window. Two same-version starts at one millisecond are separated by the new token in the landed equal-start test; neither legacy metadata nor a changed moves sequence restores the previous reader's authority. No tested succession trusts a record its answering incarnation did not keep.

`KEY_FORMAT_VERSION = 6`, `VITEST_ADAPTER_VERSION = "3"`, package/plugin version 0.1.120 and both CLI bundles agree by inspection. Shipped key-format pins 1 through 5 are unchanged; only new unreleased pin 6 is added and re-pinned. The full-suite guard verifies the candidate pin. No schema migration, holds/forget transport or additional runtime dependency is introduced. Rebuild equivalence remains unverified because building was forbidden.

## Inputs for the next wave

Route B1 and B2 to the human, as instructed. If a repair wave is authorized, keep file ownership separate: death evidence and status/delivery regressions for B1; `SourceStamps`, its invalidate ordering and real Vitest regressions for B2. Both fixes require the concrete reproductions above, their positive controls and the independent gate. Preserve random incarnation propagation, predecessor capture before registration, tokenless adoption, transactional move recording/refinement, permanent broad fallback on unverifiable ownership, refresh on moves sequence change and unrelated-backlog exclusion. The coordinator owns S1. Commit only this review file; do not reinterpret a targeted retry as a green full gate.
