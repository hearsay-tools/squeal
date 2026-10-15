# Wave 15 review: 001-423

## Verification

Candidate: `5d4e00af41146915dcdf04e69b53359487a178f8` (`cand/0.1.197`). Base: `7af43f70`. Reviewed range: `7af43f70..5d4e00af`. HEAD matched the candidate. Product files were not edited. The following commands ran at that SHA on a clean tree; the build left every committed plugin bundle unchanged.

```text
$ git rev-parse HEAD
5d4e00af41146915dcdf04e69b53359487a178f8
$ npm ci
added 196 packages, and audited 197 packages in 9s
found 0 vulnerabilities
```

npm also reported the existing `node-domexception` deprecation and six install scripts not covered by `allowScripts` (`@google/genai`, `@parcel/watcher`, `esbuild`, `msgpackr-extract`, `opencode-ai`, `protobufjs`). Exit 0.

```text
$ npm run lint
> squeal@0.1.197 lint
> biome check .
Checked 1338 files in 772ms. No fixes applied.

$ npm run typecheck
> squeal@0.1.197 typecheck
> tsc --noEmit

$ npm run build
> squeal@0.1.197 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.197 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts

$ git status --short
<empty>
```

All three exited 0. Independent full run, including `test/e2e/`, rather than a Squeal checkpoint:

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run --maxWorkers=4
<queued on host lock; no test process started>
Terminated
<exit 143 after cancellation>
```

**Unverified: the independent full suite did not run.** At 19:40 UTC the coordinator explicitly instructed this reviewer to cancel its queued flock: two proven blockers already require FAIL, and the repaired candidate is being rebuilt on newer main, including spec 010's CI, with its own independent full run in the re-review. Only this review's flock PID `1443741` was terminated; it had no children. The current lock holder was not touched. The empty test log confirms that Vitest never started. No file can be classified as failing the loaded run but passing alone; neither run occurred. This omitted check is not itself a finding or a blocker.

## Verdict

**FAIL 5d4e00af**. Two proven blockers, one proven should-fix, one proven nonblocking note, no nits. The independent suite is unverified for the explicitly recorded reason above; it contributes no finding.

## Blockers

### B1. A renewed subagent can be expired by its previous SubagentStop's leaving mark

**Proven.** `src/core/delivery/delivery.ts:285`, `src/core/delivery/delivery.ts:192`, `src/core/delivery/expiry.ts:153`; callers `src/harness/shared/deny.ts:57` and `src/core/delivery/turn.ts:85`.

001-416's accepted design in `tasks/001-416/notes.md` requires: "any later boundary clears the mark", so "a subagent that kept working is never dropped". The brief expressly asks to check re-registration. Two live paths bypass the new clear in `deliver`:

1. `register` replaces the consumer row and seeds its view without clearing its leaving slot. The drop transaction rechecks the timestamp, but the timestamp still belongs to the previous registration.
2. PreToolUse for a Bash/read call, or any call with `interrupt.onRegression` disabled, calls `resumeTurn` instead of `delivery.peek`. `resumeTurn` never clears the mark, and returns immediately if already in a turn. A long-running tool therefore crosses the old grace before PostToolBatch can clear it.

**Proof.** A plain Node probe used the candidate's compiled `createDelivery`, `markLeaving`, `dropLeft` and `denyOnRegression`, with an isolated scratch store and a controllable clock. It registered both the main consumer and a child, then marked the child at 1000, simulating a SubagentStop killed after its mark. A new registration at 9000 was removed at 11001 despite being only 2001 ms old. The second case marked at 20000, ran the real non-edit Bash PreToolUse path at 22000, and was removed at 30001:

```text
after fresh registration: {"registeredAt":9000,"leaving":[["s\nchild",1000]]}
heartbeat: {"dropped":[{"worktreeId":"wt","sessionId":"s","agentId":"child"}],"subRegistered":false,"mainRegistered":true}
after Bash PreToolUse: {"leaving":[["s\nchild",20000]],"dropped":[{"worktreeId":"wt","sessionId":"s","agentId":"child"}]}
```

The main consumer is correctly isolated; the child loses its view and registration. If it is the worktree's sole consumer, the daemon can then leave at the departure grace while the tool still works.

**One-worker fix.** In the existing registration transaction, clear that consumer's leaving mark. Make every continuing PreToolUse path clear the mark atomically with resuming the turn, including an already-in-turn consumer, while retaining the cheap read-first path when no mark exists. Keep the stopping hook's own `stop: true` delivery marked. Add regressions through actual SubagentStart and non-edit PreToolUse, not just `delivery.onToolBoundary`, covering both turn states and a main consumer alongside the child. Advance past the original mark's grace and assert the renewed child remains registered; retain the killed-Stop expiry and blocking-Stop tests. Ownership: delivery registration/turn/leaving and the shared PreToolUse boundary, plus their tests.

### B2. The eval parser treats a real status with unchecked files as passing evidence

**Proven.** `evals/lib/squeal-text.mjs:281`, against the producer at `src/core/status/format-status.ts:78`.

The new regex `/Test files without checks: ([^.]*)\./` requires a terminal period. `formatStatus` emits `Test files without checks: 1 pending, 0 unknown` on its own line with no period. Without a later period in the output, the new parser drops those counts. With all counted checks current and a live daemon, it returns `verdict: "pass"`. The old parser reads the same text as unknown.

Spec 006 D4 defines `current-before-claim` as evidence "with nothing pending, stale or unknown, the slow tier included", and `no-overclaim` as a pass only when the evidence said pass. This is a concrete regression in 001-407's quoter update. Per this review's brief, it is also input to 006's separate parser gate. The deterministic parser is a cross-check, not the judge's grade of record; this finding concerns that cross-check and its parser expectations, not a claim that the judge changed its answer.

**Proof.** The probe imported the candidate's real `formatStatus` and `test/evals/status-snapshot.ts`'s settled fixture, changed only `testFilesWithoutChecks` and its breakdown to one pending (then one unknown), and fed the resulting text to `squealEvidence`, `currentBeforeClaim` and `claimedOnEvidence`. Timeline: edit, that status, pass claim. The baseline parser was imported from `git show 7af43f70:evals/lib/squeal-text.mjs` and given the identical text.

```text
baseline {"validity":"pending","pending":1,"unknown":0,"verdict":"unknown"}
candidate {"validity":"pending","line":"Test files without checks: 1 pending, 0 unknown","pending":0,"unknown":0,"verdict":"pass","clear":true,"currentBeforeClaim":true,"claimedOnEvidence":true}
baseline {"validity":"unknown","pending":0,"unknown":1,"verdict":"unknown"}
candidate {"validity":"unknown","line":"Test files without checks: 0 pending, 1 unknown","pending":0,"unknown":0,"verdict":"pass","clear":true,"currentBeforeClaim":true,"claimedOnEvidence":true}
```

**One-worker fix.** Parse the file-count sentence up to either its period or the end of its line. Bound the match to that line, preserving the news form with only one nonzero class. Extend the existing formatter-to-parser test matrix with pending and unknown files without checks, and reference-session assertions that a pass claim misses both expectations in both harnesses. Retain full/news header and tailed-status coverage, and run the committed atomic regrade check. Ownership: `evals/lib/squeal-text.mjs`, `test/evals/evidence-squeal.test.ts`, `test/evals/header-forms.test.ts`; coordinate with 006's parser owner.

## Should-fix

### S1. The spec and amendment log still describe the old consumer-expiry contract

**Proven, nonblocking documentation drift.** `docs/specifications/001-core-loop/spec.md:186` and `:194`; `docs/specifications/001-core-loop/status.md`'s amendment log. The new leaving rule is proposed in the task notes but never folded into D9/D10 or logged. D10 still sends a SubagentStop lost to its timeout to the unused-stop rule; it now first expires after 10 s plus a heartbeat. D9 still says the isolated-worktree cwd is unobserved, although 001-416's notes record the real Claude probe. The current board row also retains the original "already unregistered" done-when beside its running note describing the delayed leaving mark.

Coordinator-sized fix: fold the accepted 001-416 rule into D9/D10, record its amendment, update the cwd evidence and align the board's done-when with the accepted design. The news header and counted-artifact wording also need their dated amendment entries. This review changes none of those files.

## Notes

### N1. The test pause is shipped and callable outside tests

**Proven, nonblocking.** `src/core/daemon/test-pause.ts:13`, `src/core/daemon/daemon.ts:662`, `src/core/daemon/lock.ts:75`; the same check is present in `plugins/claude-code/dist/cli/squeal.mjs:6203` and the other built CLIs.

A plain Node child, with no test runner or test marker and only `SQUEAL_TEST_PAUSE=stop-gap`, imported the compiled helper and stopped itself:

```text
{"testRunner":false,"env":"SQUEAL_TEST_PAUSE=stop-gap","state":"T"}
{"exit":{"code":0,"signal":null},"output":"resumed\n"}
```

The probe resumed its own child with SIGCONT and it exited normally. With that environment value a real daemon reaches this after unlinking its socket but while retaining the singleton lock; `lock-wait` similarly freezes a waiter before its timeout can progress. The unset value and every other value do nothing. No default-path failure or accidental source of either exact value was found, so this is not a blocker. It is an opt-in runtime debug switch, rather than a hook confined to tests. Prefer a fixture-injected or test-build-only pause over keeping a self-SIGSTOP branch in every installed CLI; preserve the tests' stopped-process and lock-holder assertions if changing the mechanism.

## Nits

None.

## What fits

These conclusions come from source and test inspection unless a probe is explicitly named. They do not assert that the unrun suite passed.

- **001-414:** an idle turn owing nothing returns before any known-state/view/key listing, including after another connection commits. Owed reads select the owed `(project, path)` pairs through the checks index. While refinement still owes new files, the anti-join adds untold states; owed view rows still permit retirements. The precheck never writes a partial view: any delivery or trim re-reads the full state in the write transaction. Change-marker comparison preserves another connection's intervening commit for the next poll. The read-count tests cover quiet owed results, a first new failure and unrelated results. The task notes' 202 MB measurement reports 0.21% CPU idle and 0.56% for three owed files. Those are worker measurements, not measurements repeated by this review. Cost still scales with the number owed; the notes explicitly report 6.3% for 100 owed files.
- **001-416, apart from B1:** SubagentStop marks before ensure/wait; its own Stop delivery retains the mark; a policy block clears it. `dropLeft` checks the mark again inside the removing transaction, uses a strict older-than comparison, unregisters only that consumer and stamps departure. Normal unregister removes the leaving and slow-told slots. The timer and killed-hook tests exercise the intended 10 s grace and subsequent departure grace. The main consumer is not marked by a child's stop.
- **001-412:** the empty held-file read, empty reconciliation diff and adopted empty ledger commit avoid the write transaction. A changed diff, refinement, first adoption or changed re-key move still writes through the existing transaction. `movesWouldChange` only computes the next record; it does not persist it. A real HEAD move retains its existing single-row write. The busy-store test holds `BEGIN IMMEDIATE` on another connection, exercises an idle pass, then checks a real edit after release. Active-pass contention remains the separately planned 001-422.
- **001-413:** the optional topic is forwarded in the same second argument from adapter through project and daemon note storage. The real three-start test has two projects and expects one `node-test-closure:<project>` note each. Repeated exit notes fold by exact text and keep the latest timestamp, with each available under `--notes`; different exit texts remain distinct. Twenty-five artifact globs render as a count (the test's line is 122 characters), while JSON and `--notes` preserve the list. A single artifact intentionally retains its name.
- **001-407, apart from B2:** every changed-delivery formatter uses news by default; registration, Stop and status use the full form. The news form retains commit, liveness, install, unlisted and runner-refinement warnings, actionable counts with parts, edit evidence and result blocks. Slow-told state is per consumer, excludes activity by design, is recorded when a delivery carries it, and is removed on unregister/worktree cleanup. The three shipped skill/reference copies and primer are updated. Claude Code's SKILL.md remains under 5,000 at 4,998 characters. Codex and Pi were already over 5,000 at the base (5,257 and 5,278); this diff adds 69 to each (5,326 and 5,347). Those pre-existing budget violations are outside this review's finding scope. Primer wording is length-neutral and its folding/cap pins remain. The primer's human-owned `REVISION` sentence and judge-rubric example were deliberately not changed; they remain full-header examples. News replay carries previously seen slow state only for tagged news steps, preserving historical full-header semantics.
- **001-420:** a producer must match the named run/time, failure key, outcome/fingerprint/commit and origin; an own result must also match its observed revision. Missing/mismatched references read unknown. Tests simulate an older writer leaving the producer slot, both a new own failure and a later inherited failure, then a valid refresh. The receiver's revision-start bound is correctly not reapplied to a specifically named inherited producer.
- **001-355/001-421/007-53:** handover tests still assert `T`, socket absence, the original daemon's write lock, successor identity and the next hook's step-down. Self-pausing removes the signal-after-unlink race. The node-test deadline test keeps the original timeout/no-results/no-completed-files assertions and now proves the queued file was not spawned using `run.json` and missing stdout. The pytest change follows 007 D2's "Sync in progress ... that run stores nothing": inherited current states and no own stored result are the contract, rather than no completed attempted run. No product runner change hides these assertions. The 30-run load figures in task notes were not repeated; the independent full suite was waived as recorded above.

## Inputs for the fix wave

1. One delivery worker repairs B1. Clear the old mark in `register` and every continuing PreToolUse route, in the same transaction as the activity; never clear it from the stopping hook's own `stop: true` path. Preserve the 2 s hook timeout, the derived 10 s grace, read-first idle cost and main/child slot isolation. Test a long tool crossing the original deadline, both turn states, re-registration, killed Stop, policy block and normal unregister.
2. One eval worker repairs B2 with 006's parser owner. The status producer's no-period line is already shipped. The parser must accept it as well as full/news sentence forms without consuming later lines. A pending or unknown file must keep both pass-claim expectations missed. Retain the full/news/Claude JSON/tailed-status and committed regrade checks; do not edit historical scores to make them pass.
3. The coordinator folds S1 into the spec/status/board, and decides whether to replace the opt-in pause mechanism in N1. Neither is repaired by this reviewer. Rebuild committed bundles after product fixes and verify drift before the narrow re-review. Re-review B1/B2 and the repair delta; do not repeat the settled architecture review.

## Round 2

### Verification

Candidate: `ac19c1987c790defc3d9fe2054969c1b752a36c6` (`cand/0.1.198`), based on main `37591286`. HEAD matched exactly. This is the bounded re-review of round 1's B1, B2, N1 and the D9/D10 portion of S1, plus the requested repair delta. No product, board or version file was edited. All checks below ran on the clean candidate before this review was appended; the build left all four committed plugin `dist` trees unchanged.

```text
$ git rev-parse HEAD
ac19c1987c790defc3d9fe2054969c1b752a36c6
$ npm ci
added 196 packages, and audited 197 packages in 7s
found 0 vulnerabilities
$ npm run lint
> squeal@0.1.198 lint
> biome check .
Checked 1344 files in 481ms. No fixes applied.
$ npm run typecheck
> squeal@0.1.198 typecheck
> tsc --noEmit
$ npm run build
> squeal@0.1.198 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.198 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
$ git status --short
<empty>
```

All exited 0. npm also reported the existing `node-domexception` deprecation, funding notice and six install scripts outside `allowScripts` (`@google/genai`, `@parcel/watcher`, `esbuild`, `msgpackr-extract`, `opencode-ai`, `protobufjs`).

Independent full run, including `test/e2e/`, on Node `v24.21.0`, 24 CPUs. It acquired the host lock and finished; this is not a Squeal checkpoint. One-minute host load samples during the run ranged from about 10 to 64.

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run --maxWorkers=4
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/eba1e3f4-6dfd-471b-9d9d-166a9515e544

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/eba1e3f4-6dfd-471b-9d9d-166a9515e544/test/fixtures/scheduler/.tmp/3fb05efd-6f91-4370-9699-9c0f466066d1/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/eba1e3f4-6dfd-471b-9d9d-166a9515e544/test/fixtures/scheduler/.tmp/68a3276e-87ae-41eb-a9e8-a68b31c0cdea/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 1248072
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  661 passed | 1 skipped (662)
      Tests  5607 passed | 10 skipped (5617)
   Start at  22:52:30
   Duration  877.86s (tests 97%, import 2%, transform 1%)

    Isolate  662 workers spawned · ~144ms startup each (spawn + environment, per file)
             at least ~23.74s faster with isolate: false — reuses workers across files instead of one per file
<exit 0>
$ git status --short
<empty>
```

The result cache confirms that the end-to-end files were selected, including `stop-gap`, shipped-plugin, node-test, pytest, Pi and OpenCode. `test/e2e/torn-status.test.ts` is the skipped file. The targeted renewed/leaving/timer, formatter/parser, pause/handover, unused-stop, repeated-notes, version-list and key-format files all have non-failing results. No file failed the loaded run, so there is no loaded-fail/alone-pass file to name and no individual rerun was needed.

### Verdict

**PASS ac19c198**. Zero blockers, zero new should-fix findings, zero new notes, zero nits. B1, B2 and N1 are closed; the requested S1 fold is present on main. All required checks passed at the candidate SHA on a clean tree.

### Previously reported findings

- **B1 closed, proven by source and hook regressions.** `src/core/delivery/delivery.ts:294` clears the consumer's old leaving slot inside its registration transaction. `src/core/delivery/turn.ts:88` retains the read-first fast path only when already in a turn and unmarked; otherwise it checks registration, resumes an idle turn and clears the mark in the same transaction. Non-edit Bash/Read and edits with regression interrupts off reach this path through `src/harness/shared/deny.ts:57`; the edit peek still clears through delivery. `test/harness/subagent-renewed.test.ts` exercises re-registration in both turn states, Bash/Read in both states, edits with interrupts on/off, main/child isolation, expiration after the old grace and the no-transaction fast path. The stopping hook's own delivery, killed-Stop expiry and blocking-Stop tests remain intact.
- **B2 closed, proven by formatter-to-parser evidence.** `evals/lib/squeal-text.mjs:282` stops reading unchecked-file counts at the first period or newline. It accepts the shipped status line without a period, full headers and one-class news sentences. The 54-case matrix in `test/evals/evidence-squeal.test.ts` crosses nine snapshots, three real formatters and plain/Claude-JSON wrapping. It checks exact pending/stale/unknown counts, non-pass when anything is owed, and conservatism against the frozen parser. The fixture is byte-for-byte `c6320866:evals/lib/squeal-text.mjs` after its four-line provenance prefix. News is correctly compared with the same snapshot's full header, which the old parser understands. `test/evals/header-forms.test.ts` checks that pending and unknown unchecked files miss both pass-claim expectations in both harnesses. A separate read-only probe through the three real formatters returned `unknown` for `(pending, unknown)` `(1,0)`, `(0,1)` and `(1,1)`; an appended later `99 unknown` line left the parsed counts `(1,0)`, proving the line bound. The notes' 251-cell regrade is worker evidence, not repeated here; the committed regrade tests are part of the independent run.
- **N1 closed.** `src/core/daemon/test-pause.ts:23` now only publishes to a diagnostics channel with a subscriber. `test/daemon/pause-preload.mjs:9` owns SIGSTOP, loaded explicitly by `testPause` in `test/e2e/restart-evidence.ts:62`. The subscriber runs synchronously, retaining the precise stop-gap/lock-wait boundary. Overrides are added after child-environment scrubbing, so the intended daemon gets the preload. A scan of all 42 shipped `plugins/*/dist/**/*.mjs` files found no `SIGSTOP`, `SQUEAL_TEST_PAUSE`, `SQUEAL_TEST_STOP_GAP` or `pause-preload`. The plain-child regression verifies that the environment value alone cannot stop a process; its paired preload case verifies `T`, resume and normal exit. Handover and shipped-plugin stop-gap tests retain socket absence, lock-holder and replacement-validation assertions.
- **S1's requested D9/D10/status fold closed.** Commit `69415c20` is already an ancestor of baseline main `37591286`. Reading those files at that baseline confirms D9 includes registration and every PreToolUse clearing the mark, and the observed Claude 2.1.300 isolated-worktree cwd; D10 includes the 10-second grace plus heartbeat, departure stamp and unused-stop backstop. The status amendment records the same rule. No documentation drift was repaired by this reviewer.

### Repair delta

- **Unused-stop premise accepted.** The original repair `246680b5` is integrated as `f2f7594f`. `src/core/daemon/daemon.ts:214` awaits opening the front desk before calling `#register`; the worker binds its socket and answers ping from its own identity while the main thread can be blocked on the store write transaction (`front-desk.ts:36`, `desk.ts:244`). A successful ping therefore cannot prove that registration has committed. `test/daemon/unused-stop.test.ts:100` now polls for the non-null record and a ping on its recorded socket together, then checks the computed socket. It preserves the restart and silent-rest assertions. The task's blocked-write probe agrees with this source path; it was inspected, not rerun.
- **Pause repair accepted.** Original `28a24ef1` is integrated as `0cf679e8`. No pause environment switch or self-stop remains in shipped bundles. No new runtime dependency was introduced. The unreleased key-format-10 pin was refreshed, and the build is reproducible.
- **Version-sensitive listing accepted.** Original `dd4173af` is integrated as `d8b88e49`. `test/version-sensitive.txt:109` includes `test/daemon/repeated-notes`, whose real daemon runs two node:test projects across three starts. CI's Node 24 step consumes this substring list; the existing list guard checks its coverage. No unrelated CI design is reopened.

### Blockers, should-fix and nits

None. No newly proven or plausible defect was found in the bounded repair delta. No required verification remains unverified.

### What fits

The repair closes the concrete old-mark expiry and false-pass parser scenarios without changing their contracts. Registration/turn activity clears the mark atomically; Stop retains its own mark until block or unregister. The parser preserves uncertainty across real formatter output and remains conservative against the fixed pre-wave parser. The pause moved to an explicitly injected test preload while the shipped plugin tests still prove the socket/lock gap. Round 1's settled architecture conclusions remain in force.

### Inputs for the next wave

No fix worker is required for B1, B2 or N1. Keep clearing the leaving slot in the same transaction as registration/turn resumption; keep the 2-second hook budget, 10-second leaving grace and main/child isolation. Preserve the frozen parser and the full/news/status matrix when wording changes. Tests that need the stop gap must inject `testPause`, never restore an environment-only self-stop in shipped code. Future real node:test callers must join the Node 24 list. The coordinator retains ownership of landing and its previously scheduled news-header/counted-artifact amendment entries.
