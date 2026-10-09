# Wave 13i: inherited failures, one re-run, and console logs

Candidate: `f7257366f963a4fa78c2df111cf1f6f796de052a`, exactly HEAD and origin/main when verification began, version 0.1.73. The tracked tree was clean throughout the gate and probes. Review row 001-183, against the 2026-10-09 inherited-failure and eight-per-tier decisions, spec 001 D5, D6 and D7, and spec 004's slow-file rules at their seams.

## Verification

Linux, Node 24.21.0, Vitest 5.0.3. The reviewer gate requires direct Vitest; background Squeal's 0.1.62 checkpoint was not substituted. One full suite, at most four outer workers. External probes used one outer worker per run and their fixture repositories lived outside this checkout. The brief's implementation-worker no-build rule does not waive the reviewer build. No product code or committed bundle changed. The full gate printed two fixture gitdir repair notices and a cleanup notice for one dead earlier test run, with no teardown error. The initial host load average was 69.35, and a later sample was 78.52.

```text
$ git rev-parse HEAD origin/main
f7257366f963a4fa78c2df111cf1f6f796de052a
f7257366f963a4fa78c2df111cf1f6f796de052a

$ npm ci
added 56 packages, and audited 57 packages in 2s
found 0 vulnerabilities
(exit 0)

$ npm run lint
> squeal@0.1.73 lint
> biome check .
Checked 688 files in 440ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.73 typecheck
> tsc --noEmit
(exit 0)

$ npm run build
> squeal@0.1.73 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.73 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0)

$ git status --short
(no output after build)

$ npx vitest run --maxWorkers=4
Test Files  301 passed | 1 skipped (302)
     Tests  2251 passed | 11 skipped (2262)
Start at 19:14:33 (Europe/Warsaw)
Duration 699.41s
(exit 0)

$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist
(no output, exit 0)
```

`npm ci` warned that @parcel/watcher and esbuild install scripts were not covered by the install-script allowlist; subsequent commands completed. Background Squeal separately reported a Codex CLI five-second timeout at load 57.89, then observed-growth poll failures and a file-level `spawn git ENOENT`. These are background evidence, not this review's independent gate or a proven cause attributable to these rows.

### Discriminating probes

The external tests assert the bad behavior, so their green results prove reproductions, not fixes. They import the candidate sources, use real schedulers, stores and Vitest/node:test adapters, and copy the repository helpers with fixture roots relocated outside the checkout. All temporary probe sources and repositories are removed before this report is committed. The reproductions below preserve the inputs and ordering needed for fix tests.

```text
$ npx vitest run --config <external>/vitest.config.ts -t "review:"
Test Files 4 passed (4)
     Tests 5 passed | 11 skipped (16)
Duration 30.22s
(exit 0; tests assert the reproductions described below)

$ REVIEW_NO_HEAL=1 npx vitest run --config <external>/vitest.config.ts <external>/observed.test.ts -t "review:"
Test Files 1 passed (1)
     Tests 1 passed | 4 skipped (5)
Duration 12.59s
(exit 0; B retains its own current FAIL when only healing is suppressed)

$ node <external>/log-collision.mjs
{"lines":["[stdout] test/a.test.ts: A OUTPUT","[stdout] test/a.test.ts: b.test.ts: B OUTPUT"],"total":2,"limit":200}
(exit 0; two files' output is returned for the first file)
```

The first external attempt had an incorrect fixture symlink setup. An initial preload attempt also rewrote fixture-relative strings while relocating imports; that attempt is unverified. Both were corrected before the evidence reported below. A later assertion that explicit observed refinement immediately repaired the false pass was disproved; the final probe makes no such claim and confirms the actual failure with a forced local run. No failed setup or cleanup attempt supports a finding.

## Verdict

**FAIL f725736**. Four proven blockers, three should-fix notes (two proven, one plausible), one proven nit. The full gate is green; the discriminating probes exercise paths omitted by the committed tests. Under the brief, the coordinator takes blockers to the human; this review makes no acceptance decision.

Reviewed row commits on main:

- 001-173: `604ae7e`, `c8cb5f6`, bundle `3395d8f` (0.1.70).
- 001-170: `3b5a4cf`, `1272746`, `8a0c406`, `8492b16`, `044a6f2`, bundle `aa6ebaa` (0.1.71).
- 001-171: `48c740d`, `dcbae53`, `e945810`, `213cabc`, `51ee9b2`, `0bd9e06`, `8167e1c`, bundle `f591810` (0.1.73).

Read the worker notes, the assigned wave brief, board, spec and amendment log. Other coordinators' interleaved commits are outside this review except where these rows call their interfaces. The already-recorded incomplete-preload-key problem is considered only to determine what the new healing step does to it, as the brief explicitly requests.

## Blockers

### B1. Healing a mixed-outcome file strands its new inherited failure and allows a completed checkpoint

**Proven.** `src/core/scheduler/store-results.ts:28`, `src/core/state/sink.ts:130`, `src/core/scheduler/ledger.ts:156`, `src/core/scheduler/tiers.ts:373` (`queueFullSuite`).

D6: an inherited fail is pending until a local run confirms it, and its file is queued. D5/D7: an unconfirmed file is work to do, and a full-suite checkpoint must not imply it has been validated.

Reproduce with two checks in one identical file and an external marker, which intentionally does not enter the key:

```ts
it("x", () => expect(existsSync(marker)).toBe(false));
it("y", () => expect(existsSync(marker)).toBe(true));
```

Start A with no marker: X passes, Y fails. Add the marker and start B. B holds Y's inherited fail, runs the file, and stores X FAIL / Y PASS under the same key. Use `rerunCap: 0` to isolate inheritance from re-runs. Y's flip triggers `storeResults` to refresh A's whole file. B's X failure is unconfirmed in A, so `heldFailure` makes refresh skip every result, including Y's recovery. A becomes X PASS/stale, Y FAIL/stale and file PASS/stale. A's ledger still has `resultKey === key`, no queue entry and no pending phase.

A nonforced `requestFullSuite()` runs nothing. The public header afterward is:

```json
{"counts":{"current":11,"pending":0,"stale":3,"unknown":0},"fullSuite":{"atCurrentRevision":true,"lastCompletedRevision":0}}
```

A still has only its original one run of this file. The new X failure is neither confirmed nor delivered in A, and Y is not healed there. This is ordinary shared-result behavior, independent of the incomplete-preload-key problem in B2.

Fix scope: one scheduler/state worker. Make held-result invalidation reach the receiving daemon's ledger as well as its sink, invalidate its equal-key `resultKey` shortcut, and queue confirmation at normal priority. A `run --all` must treat a held file as unfinished even when its in-memory ledger previously applied that key. Preserve the transaction boundary between persisted phase and known-state validity. Add this paired-flip test and assert pending, eventual local confirmation/delivery, and that no checkpoint completes over the stranded state.

### B2. The new heal turns the known preload-key window into a false current pass in the worktree that really failed

**Proven.** `src/core/scheduler/store-results.ts:36`; the changed skip at `test/scheduler/observed-growth.test.ts:300` names 003-43. The upstream environment-key omission is pre-existing; the false recovery written into B by this row is new.

Vision principle 2 and D5: a result must describe the bytes its key names. D6's healing assumes that equal keys cover the inputs on which the two runs differ.

Use the existing observed-growth preload fixture, with two node:test files. `scripts/setup.cjs` runs `require("../src/hidden" + ".cjs")`; both files assert `globalThis.hiddenValue === 1`. A's `hidden.cjs` sets 1 and B's sets 2. Hold A after its first `closure()` computed its answer, so its already-read environment lacks the computed preload path. Start and finish B while A is held. B's test is own/current FAIL. Release A. It confirms with a local PASS under the equal, incomplete key, and the new healing step writes B's state as inherited/current PASS from A, with the failure fingerprint cleared. Both worktrees' key in the probe was `30b520c893421ebe0827cb719a90caf33093cb9fb458c641cc0eaf48fb57d85a`.

A forced run in B immediately restores own/current FAIL without changing B's test or preload bytes. An explicit `refreshObserved()` between the false heal and that forced run did not restore the failure in this schedule. The control replaces only `store.testFileKeys.withKey` with an empty result, suppressing the new cross-worktree heal: B remains own/current FAIL while A passes. This isolates the new publication from the old key omission. No claim about a fixed window duration follows from this experiment.

Thus the skipped test is hiding a production consequence: a confirmed local failure can become an actionable false recovery. The existence of a planned upstream fix does not make the shipped heal safe.

Fix scope: coordinate a node:test/environment worker with the 001 state worker. Close 003-43 before allowing these incomplete-key runs to replace/heal shared results: include every newly observed preload in the environment key before storing, or withhold the result and re-run under the complete environment. Re-enable the skipped case and add the deterministic gated ordering above. Until then, withhold healing for a result whose project environment has unresolved observed growth. Do not remove healing for sound equal keys.

### B3. A new failure whose run grows its observed closure is never re-run

**Proven.** `src/core/scheduler/tiers.ts:330`.

D6 and 001-171: a new fast failure is reported and re-run once, except forced, red-phase, inherited-confirmation, slow or over-cap failures. A first run with ordinary observed growth is none of these exceptions.

Start an observing scheduler on the existing basic fixture plus a new failing file. The file dynamically reads the tracked `src/math.ts` before its assertion:

```ts
readFileSync(new URL("../src/" + "math.ts", import.meta.url));
expect(existsSync(externalMarker)).toBe(false);
```

The external marker exists throughout. Bootstrap hashed the tracked source before the run, so this is safe growth, not a first-seen discard. The run report observes `src/math.ts` (plus its snapshot probe), the result is stored under the grown key, and the check becomes own/current FAIL. There is exactly one run of this file. It is a new check, not forced, not slow, with one failing file below the cap.

Only `growth === undefined && file.key === key` calls `holdsNewFailure`. The grown-file path stores the row and applies it through `settle`, bypassing `failedAnew` and `queueReruns` entirely.

Fix scope: one scheduler worker. Evaluate newness against the pre-apply known state and the prior rows at the final stored key, and include safely stored grown-key failures in the same per-tier cap calculation before the sink applies them. Keep first-seen/discarded and unstable runs out. Add a test that sees FAIL, holds the next tier, removes the marker, and sees exactly one forced re-run followed by FAIL -> PASS with a flaky note.

### B4. `why` selects a different-key run as the producer of the current result

**Proven.** `src/core/status/run-log.ts:31`, `src/core/status/why.ts:104`.

001-173's chosen contract: name the run holding the output of the shown own or inherited result. D7 and vision principle 7 require truthful provenance, not merely a log from the same worktree with the same outcome.

A real scheduler runs `test/plain.test.ts` at K0 and passes. Append a comment, apply its watch batch and let K1 pass. Restore the exact original file and apply the batch. The scheduler looks up its own old K0 PASS, runs nothing, and its current state's `observedAt` again identifies the original run's revision. `readWhy(..., { includeLogs: true })` selects the newer K1 run instead, and `formatWhy` asserts that it “produced the result shown”. The real probe selected run `f1ce387d-c91e-4a20-83b4-5b3978ed6e3f` instead of K0's `a53245e1-cf00-4ab8-8834-ce5184b8c3b1`. A seeded control with explicit old/new commits also prints the newer key's `NEW KEY OUTPUT` beside the older current state.

`shownResult` filters only the producer and outcome; for an own result `sameCommit` is always true. Even inherited matches permit a different-key fallback, and twenty unrelated newer rows can push the actual result out of the search altogether.

Fix scope: one status worker, with an additive store/state change if needed. Resolve the actual result by its key and producer/run identity, outside the twenty-row display limit. For current states the test-file key supplies the key; stale states and replaced same-key results need retained result provenance or an honest “producer no longer available” answer. Never call a nearby run the producer. Add the real K0 -> K1 -> K0 test and an inherited case with multiple keys at the same commit; print only the selected result's log.

## Should-fix

### S1. Re-run intent and the once-per-key memory disappear on daemon restart

**Plausible**, from `src/core/scheduler/files.ts:49`, `src/core/scheduler/rerun.ts:81` and `src/core/scheduler/bootstrap.ts:99`; no real-daemon restart probe was run. `rerunKey` and the forced queue are in memory. A daemon that exits after recording the first failure but before the queued re-run leaves the successor a current own failure, which baseline lookup takes without the promised confirmation run. The worker notes confirm this limit. A worker can persist re-run intent/key and restore it at bootstrap, with one restart-between-tiers test. Also ensure a forced confirmation queued for K0 does not silently become a forced run for a newly edited K1 and suppress K1's new checks' confirmation.

### S2. Console filtering has an ambiguous file-label prefix

**Proven**, `src/core/run-log.ts:17`, `src/core/status/run-log.ts:80`. Two legal POSIX paths, `test/a.test.ts` and `test/a.test.ts: b.test.ts`, produce prefixes where the second starts with the first. A direct writer/reader probe for the first file returned both lines:

```text
[stdout] test/a.test.ts: A OUTPUT
[stdout] test/a.test.ts: b.test.ts: B OUTPUT
```

An untagged console payload beginning with the same label is ambiguous too. The common-path tests work, but prefix matching cannot distinguish metadata from path/content text. Fix in one run-log/reporter/status worker: serialize file identity separately, or use an unambiguous escaped record format; filter the decoded identity exactly. Keep the readable renderer and 200-line cap. This is a low-frequency attribution bug, not the ordinary wrong-run failure in B4.

### S3. `--include-logs` has no node:test console output

**Proven limitation**, `src/core/status/run-log.ts:56`, `src/core/status/format-why.ts:142`, and task 001-173's notes. A node:test result returns `not-vitest` and a directory pointer, and the flag prints no console lines even when its per-file stdout/stderr logs exist. The board's delivered scope names `vitest.log`, so this is a follow-up rather than a blocker of that scope. One status worker can use `run.json` to locate the requested file's node:test stdout/stderr logs and apply the same explicit cap and pruning behavior.

## Nits

### N1. A held check is discoverable by its full name, but not by a name fragment

**Proven by source**, `src/core/status/why.ts:66`. Exact parsing consults stored results; fragment resolution consults only local known states. A newly held check deliberately has no known state, so the normal short-name route cannot find it. No separate probe was needed for this direct branch behavior. Extend fragment candidates to current held results, without surfacing unrelated worktrees' historical checks; keep exact matching and ambiguity handling.

## What fits

- D6's ordinary two-worktree inheritance path holds a failure without a transition or delivery, confirms it with one local run, and accepts inherited passes without running. Single-check sound-key healing records a flaky note and a recovery. The committed real-run tests cover these paths and slow confirmation.
- The slow tier remains the authority for confirming inherited slow failures. New slow failures are excluded from fast re-runs, as the dated decision requires; this review does not reopen that cost decision.
- The normal new-failure path reports before the held second run finishes, re-runs once, reports recovery with the flaky note, and keeps repeat FAIL quiet. The tests distinguish red-phase, forced-run and confirmed inherited failures.
- `queueReruns` implements the cap in **test files due for re-run**: eight are queued, nine are all skipped with one note. Forced and slow entries do not spend that cap. The human's cap decision is not treated as a new policy key.
- Console output has a shared writer/reader format, tags each multiline output line, separates ordinary project/file labels, caps included lines at 200, and reports absent/pruned Vitest logs. No wrong-file leak was found for ordinary labels; S2 covers an ambiguous legal label.
- No schema migration or runtime dependency was introduced. The extra state and log fields are additive. Rebuilding both committed plugin distributions left them unchanged.

## Inputs for the fix wave

1. Dispatch the shared-result/ledger repair for B1 independently of the status repair for B4. Both need tests that distinguish persisted known state from in-memory scheduler state; a header alone is not sufficient.
2. Sequence the observed-preload key fix in 003-43 before accepting B2's healing. The result must be keyed with the environment actually observed before `storeResults` replaces rows or refreshes another worktree. A later timer cannot retract a recovery already told to an agent.
3. B3 shares `recordTier` and ledger ownership with B1. Preserve the order: collect prior rows/known state, store a stable result under its final complete key, account for all tier-level re-run candidates, apply state and phases together. Count all eligible fast files before testing the cap. Keep forced/red/slow/confirmed exclusions.
4. B4 must look up provenance independently of the twenty-row display list. Coordinate any additive state field with the sink worker, and ask before a schema change. S2 can share this worker's run-log ownership.
5. Preserve the human decisions and the genuine slow-file exception. Take blockers to the human as the brief directs. This reviewer edited neither the board nor product code and did not accept a deviation.
