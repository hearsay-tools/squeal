# Wave 13j review: 001-187 and 001-188 (001-189)

## Verification output

Candidate: `fd0fe7eb7412f0e2f564ed38a5d88d6531f99b47`, `origin/main`, package version 0.1.78. Clean tree before verification. Node 24.21.0, Linux. Range `f725736..fd0fe7e`; second round bounded by `reviews/wave-13i.md`. Rows 001-184 and 001-185 are examined only at these repairs' seams. Other lanes' interleaved changes are outside this review.

```text
$ git rev-parse HEAD origin/main
fd0fe7eb7412f0e2f564ed38a5d88d6531f99b47
fd0fe7eb7412f0e2f564ed38a5d88d6531f99b47

$ npm ci
added 56 packages, and audited 57 packages in 1s
found 0 vulnerabilities
(exit 0)

$ npm run lint
> squeal@0.1.78 lint
> biome check .
Checked 705 files in 165ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.78 typecheck
> tsc --noEmit
(exit 0)

$ npm run build
> squeal@0.1.78 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.78 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0)

$ git status --short
(no output after build)

$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist
(no output, exit 0)

$ npx vitest run --maxWorkers=4
FAIL test/scheduler/backlog-tiers.test.ts:89
AssertionError: expected 10278 to be less than 7418
001-124: direct vitest run 3709 ms; baseline 4929 ms in 1 tiers;
         backlog after a config edit 10278 ms in 1 tiers
Test Files 1 failed | 311 passed | 1 skipped (313)
     Tests 1 failed | 2299 passed | 11 skipped (2311)
Start at 20:48:03 (Europe/Warsaw)
Duration 450.02s
(exit 1)

$ npx vitest run test/scheduler/backlog-tiers.test.ts -t 'runs a 200-file backlog' --maxWorkers=1
Test Files 1 passed (1)
     Tests 1 passed | 3 skipped (4)
Duration 18.20s
(exit 0)
```

`npm ci` warned that @parcel/watcher and esbuild install scripts are not covered by the allowlist; the build completed without drift. This is the repository-required independent Vitest gate, not a Squeal checkpoint. Background Squeal separately reported the Codex CLI scratch-HOME test timing out after 5 seconds at load 21.52. That is not this review's independent evidence or a proven defect attributable to these rows.

### Discriminating probes

External copies of the repair tests import the candidate sources. Their scheduler fixture copies, dependency links and markers live outside the checkout. All first-round reproductions were rerun: the mixed-flip heal and checkpoint, the gated two-worktree preload ordering with **two** node:test files, observed-growth re-run, real K0 -> K1 -> K0 revert, console-prefix collision, node:test logs and held name fragments. Restart tests also reran. These checks passed:

```text
$ npx vitest run --config <external>/vitest.config.mts
Test Files 6 passed (6)
     Tests 15 passed (15)
Duration 12.91s
(exit 0)

$ npx vitest run --config <external>/vitest.config.mts <external>/preload-refresh.test.ts <external>/extra.test.ts
Test Files 2 passed (2)
     Tests 3 passed (3)
Duration 2.94s
(exit 0; these tests assert the remaining bad behavior, not a fix)

$ npx vitest run --config <external>/vitest.config.mts <external>/extra.test.ts
Test Files 1 passed (1)
     Tests 2 passed (2)
Duration 3.15s
(exit 0; registered-worktree producer replacement and metadata prune)
```

The additional tests discriminate an incomplete-key refresh, a real same-key producer replacement, and pruning of new metadata. The producer test also reran with both worktrees registered, so the formatter names their actual roots. Initial external setup attempts used an invalid Vitest config import and a dependency link that git tracked. Those were fixed before the successful runs. Two exploratory assertions passed a boolean to `requestFullSuite`, whose interface takes `{ force: true }`; they requested no forced run and support no finding. All probe sources, repositories and logs are removed before committing this report. No product code or board was edited.

## Verdict

**FAIL fd0fe7e**. Two proven blockers remain, B2 and B4 below, and one proven should-fix note. No nits. B1 and B3 close; S1 to S3 and N1 are addressed. B2's immediate automatic heal is suppressed and B4's wrong-key revert is repaired, but the same failure classes still have concrete paths through the repaired boundaries. This is the second round. The brief says blockers go to the human; this review does not authorize another round or accept a deviation.

## Blockers

### B2. The preload stopgap still publishes a false recovery through an ordinary state refresh

**Proven.** `src/core/scheduler/store-results.ts:33` writes the shared row before its unresolved-preload return. Its consumer is `src/core/state/sink.ts:117` (`refresh`), reached when `queueFullSuite` enqueues a forced run and commits the ledger (`src/core/scheduler/tiers.ts:398`, `src/core/scheduler/ledger.ts:343`).

001-187's brief: “no heal from a result whose project environment has unresolved observed growth ... the result is stored for its own worktree only.” Wave-13i B2 and vision principle 2 forbid an incomplete equal key from publishing a current recovery in the worktree whose bytes actually fail. Suppressing only the eager `storeResults` heal does not isolate the stored pass from other worktrees.

Use the first-round gated ordering, with `scripts/setup.cjs` requiring `../src/hidden` + `.cjs`, and two node:test files asserting `globalThis.hiddenValue === 1`. A has 1, B has 2. Hold A after its closure computed its answer; finish B, release A and finish it. The immediate stopgap behaves as its regression test expects: B retains own/current FAIL and there is no flaky note. Both files still have keys lacking the preload; the hidden file's key is `30b520c893421ebe0827cb719a90caf33093cb9fb458c641cc0eaf48fb57d85a`.

Register B's consumer while B fails. Before any observed refinement, request B's normal `requestFullSuite({ force: true })`, holding its next adapter run before it executes. Queueing the request commits the changed file phases and calls `sink.refresh`. It reads A's PASS from the shared incomplete key. B immediately becomes **inherited/current PASS**, clears its diagnostic fingerprint, and delivers **FAIL -> PASS for both files** while its own next run is held. The captured delta has four current checks, zero pending checks and no still-failing entries. Release B: its local run restores own/current FAIL with unchanged test and preload bytes.

The operation that makes this visible is a real scheduler request, not a direct sink mutation. The scheduled local confirmation cannot retract a recovery already delivered. The worker notes acknowledge that a later dirty refresh can read this row; the probe disproves relying on environment refinement always winning that ordering.

Fix scope: one scheduler/state worker, coordinated with 003-43. An unresolved-environment result must not become an inheritable shared result or replace another worktree's trusted row. Withhold it and re-key/re-run under the complete environment, or retain local-only evidence through a representation all lookup and refresh readers honor. Merely skipping `recordFlips` and `storeResults`' refresh loop is insufficient. Add the gated two-file case followed by a held forced request; assert B keeps its own fail and emits no recovery until a sound local result exists. If 003-43 lands first, test that every result stored and every refresh is under the complete key.

### B4. `why` still calls a replacement same-key run the producer of an earlier inherited result

**Proven.** `src/core/status/run-log.ts:38` to `:46`; the assertion is rendered by `src/core/status/format-why.ts:166`.

001-188's brief requires resolving the producing result “by its key and its run identity.” Wave-13i B4 specifically includes replaced same-key results: retain provenance or say the producer is no longer identifiable. The new current-key branch checks outcome, commit and producer worktree, but for an inherited state it has no run identity. A later run by the same producer at the same commit passes that predicate.

A real Vitest fixture's `test/plain.test.ts > plain` reads an external marker, prints it, and passes. With `FIRST OUTPUT`, A passes; B inherits that result without running. Change only the external marker to `SECOND OUTPUT`, and force A's full suite. The same test still passes under exactly the same key, commit and revision, now with a 50 ms delay. PASS -> PASS records no heal, so B's known state remains exactly its earlier inherited state.

The captured first run had duration `2.143139 ms`; the replacement had `52.951331 ms`. B's unchanged known state still has the first duration, yet `readWhy(B, ..., { includeLogs: true })` selects the replacement run and prints only `SECOND OUTPUT` under “produced the result shown.” The first and replacement run IDs were respectively `9ddcd494-61ac-4211-aabe-f1b9640a88cd` and `86e2a548-fddc-40a6-afdc-9ab7e2109a34`. The registered-worktree rerun reproduced the same mismatch. A seeded control replaces the row at the same commit but a different producer revision and also misidentifies it; no original run is available from the overwritten result row.

The original K0 -> K1 -> K0 probe now names K0 correctly, including beyond twenty displayed rows. That closes the wrong-key example, but matching the right key cannot prove that a replacement row produced an unchanged state. The “unknown” fallback exists and is appropriate for this case.

Fix scope: one state/status worker. Retain a producer run ID with the known state's provenance, with the coordinator's approval for any schema change, or use retained provenance that can prove identity. If there is no proof, render the unknown producer instead of selecting the latest matching same-key row. Equality of duration or fingerprint alone is not identity; two runs may share those too. Add the real inherited PASS -> PASS replacement and a same-commit different-revision replacement case. Preserve the sound current-key revert lookup, history display limit and exact console filter.

## Should-fix

### S4. The new per-worktree metadata survives worktree pruning and has no repository-wide bound

**Proven.** `src/core/scheduler/held.ts:22`, `src/core/scheduler/rerun-memory.ts:21` and `:48`; the removal boundary is `src/core/store/repos/worktrees.ts:73`, called by `src/core/store/prune.ts:79`.

The 001-189 brief explicitly asks whether `held-files:` and `reruns:` are pruned or bounded. They replace an entry for the same file rather than growing per run. Held entries are consumed at a batch/start/request, and `restoreReruns` prunes removed files at bootstrap. Those are useful local bounds. However, `Ledger.removeFile` does not prune re-run memory during a long-lived daemon, and removing a worktree removes neither metadata row. The generic store size cap evicts result rows only, not metadata.

External store probe: register a worktree, write both rows through `addHeldFile` and `writeReruns`, remove its root, and run `store.prune({ retentionDays: 7, maxSizeMb: 0, ... })`. `worktreesRemoved` is 1, its worktree row is gone, and both JSON metadata rows remain. Repeated short-lived worktrees therefore accumulate these new records without a bound. This extends the pre-existing metadata retention issue already on the board; it does not make the reviewed confirmation/re-run behavior incorrect.

Fix scope: extend the planned per-worktree metadata-prefix registry to `held-files:` and `reruns:`, removing only registered prefixes in short batches with the worktree. Preserve shared node:test observation keys. Prune a removed file's re-run entry at the live listing/removal boundary as well as bootstrap. Add a public store prune test with both rows and a shared-observation control. Do not evict pending re-runs of live files just to cap storage.

## Nits

None. Wave-13i N1 is addressed: exact and fragment lookup both find a held current-key check; historical checks from another key do not enter fragment candidates.

## What fits

| Prior finding | Evidence at 0.1.78 | Result |
| --- | --- | --- |
| B1, mixed-flip healing strands a held file | External mixed X/Y fixture: pending immediately; `run --all` runs the file, delivers both flips and completes only afterward; an interval pass also confirms without a request. | Closed. |
| B2, unresolved-preload automatic healing | Gated two-file ordering: B remains own/current FAIL immediately after A stores PASS, no flaky note. Forced-request refresh later exposes the same shared pass. | Partial; blocker B2 remains. |
| B3, observed-growth new failure skips its re-run | Real observed read of tracked `src/math.ts`: the grown-key FAIL is visible before the held second tier; exactly one forced re-run passes under that key and delivers recovery with a flaky note. | Closed. |
| B4, wrong-key result log after revert | Real K0 -> K1 -> K0 lookup: no third run, K0 run and console selected; seeded older producer outside the display limit and inherited multi-key cases pass. Same-key replacement still guesses. | Partial; blocker B4 remains. |
| S1, restart loses re-run intent/key | Close after first failure before next tier; second scheduler runs once, third runs nothing. A key edited before restart takes an ordinary run. | Addressed. |
| S2, file-label prefix collision | Exact parsed labels separate `test/a.test.ts`, `test/a.test.ts: b.test.ts`, and an untagged payload starting with the former. Escaped labels round-trip. | Addressed. |
| S3, node:test console absent | File index in `run.json` selects its stdout/stderr; other files' output is excluded; missing capture is stated. | Addressed. |
| N1, held-name fragment missing | Fragment finds the held current-key failure and names its log; an older-key fragment does not match. | Addressed. |

The repair introduces no runtime dependency or schema migration. Its additive fields are `FileState.rerunPending`, `WhyRunLog.state = node-test` and optional `stderrPath`; new persisted metadata has the two prefixes above. Both committed plugin bundles match the build. The duration-sharing change in 001-184 does not prevent the grown-key failure or the restored re-run from receiving its next tier. 001-185's wait-sync changes do not intercept the forced-request refresh used by B2. Slow-file and mass-break exceptions settled in the first review are not reopened.

## Inputs for the coordinator

1. Take remaining B2 and B4 to the human as this second-round brief requires. The repairs do not need a general architecture pass: one unsafe shared-result publication boundary and one insufficient producer-identity predicate remain.
2. Sequence B2 with 003-43. Until the environment is complete, every reader of that result, including the forced-request phase refresh, must respect its local-only/withheld status. A timer that later re-keys cannot undo an already-delivered false recovery.
3. B4 can be isolated from the scheduler repair. Agree on retained result identity before changing state storage, and keep unknown as the honest fallback. The same-key and same-commit case is required, in addition to the now-green wrong-key revert.
4. Add the two metadata prefixes to the existing prune follow-up; preserve shared observation keys and pending intent for live files. This note is not a reason to discard the successful S1 persistence repair.
5. The independent full gate is not green: its one timing comparison failed, then passed on the single isolated retry. No full suite was repeated. The structural backlog assertions (all 200 files, completed reports, at most three tiers) passed in the failing run. The cause of the timing difference is unverified; do not treat the isolated pass as a retroactive green full gate or a proven product regression in these rows.
