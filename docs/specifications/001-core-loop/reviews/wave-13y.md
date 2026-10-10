# Wave 13y: second review of the Parcel recheck

## Verdict and verification

**FAIL** at `dcff0cf9`: **1 proven blocker, 0 should-fix, 0 nits**.
Range: `1705edbd^..dcff0cf9`. Bounded second round on `reviews/wave-13x.md` B1 and S1, covering 001-245, its regressions, the 0.1.106 bundles and the unreleased key-format 3 re-pin. The previous B1 is closed. S1 is repaired for stable-size files, but its budget can still be exceeded by a file growing between stat and read.

The assigned worker initially had `ce713d1d`, one documentation-only commit after the candidate. All product verification and probes below ran detached at **exactly `dcff0cf9`**, with no tracked changes. The worker branch was restored before writing and committing this report. No product, board or spec edits were made.

```text
env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npm ci
added 56 packages, and audited 57 packages in 2s
found 0 vulnerabilities
exit 0

env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npm run lint
> squeal@0.1.106 lint
> biome check .
Checked 770 files in 290ms. No fixes applied.
exit 0

env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npm run typecheck
> squeal@0.1.106 typecheck
> tsc --noEmit
exit 0

env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --maxWorkers=4
Test Files  5 failed | 347 passed | 1 skipped (353)
      Tests  5 failed | 2537 passed | 10 skipped (2552)
   Start at  22:52:43
   Duration  613.77s (tests 98%, import 1%, transform 1%)
exit 1
```

`npm ci` warned about unapproved install scripts for `@parcel/watcher` and `esbuild`. `npm run build` was deliberately not run, as the task requires. Independent bundle regeneration and macOS execution are **unverified**. Inspection of both CLI bundle diffs confirms the same `racy` state, 4 MiB constant, budget and comparison changes as the source. The human's unreleased-version decision permits re-pinning key-format 3 in place.

The independent full suite is **red**. Four failures were 5 s timeouts:

- `test/harness/hooks.test.ts:123`: registering an unregistered PostToolBatch consumer.
- `test/harness/codex/turns.test.ts:68`: denying apply_patch once per regression.
- `test/harness/bundles.test.ts:44`: serving every bundled event end to end.
- `test/status/header.test.ts:11`: agreement between delivery header and status.

The fifth was `test/daemon/handover.test.ts:72`, which expected `["spawned"]` and received `["alive"]`. Load was about 14.7 before the run and peaked at a sampled `97.67 51.15 34.44`; a separate Squeal background baseline was also running and reporting failures. None targets the changed Parcel recheck. Candidate attribution is **unverified**; load contention is **plausible**, not a proven cause. These failures are not additional blockers against this bounded repair.

The failed files and the relevant Parcel/key-format files then passed together with one worker at the same clean candidate:

```text
env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run test/harness/hooks.test.ts test/harness/codex/turns.test.ts test/harness/bundles.test.ts test/daemon/handover.test.ts test/status/header.test.ts test/watcher/parcel-racy.test.ts test/watcher/parcel-links.test.ts test/keys/key-format.test.ts --maxWorkers=1
Test Files  8 passed (8)
      Tests  117 passed (117)
   Start at  23:03:03
   Duration  18.91s (tests 93%, transform 4%, import 3%)
exit 0
```

The retry is recorded separately and does not make the independent full suite green. The supplied coordinator gate (2,532 passed, 10 failed, all ten files then passing on one worker) likewise is not substituted for this run.

## Blockers

### B1. Proven: S1's byte cap is checked against a stale size, then an unlimited read exceeds it

Location: `src/core/watcher/parcel-backend.ts:191`, `:195`, `:223`, `:225`, `:226`.

001-245 requires that "content work has a budget" and that "a file over the budget is hinted, not read in full". `signature()` obtains a size from stat. `contentHash()` compares that size with the remaining 4 MiB budget, then calls `readFileSync(path)` without a length limit. The budget is charged only after that whole-file allocation and read have completed. A separate build process can enlarge or replace the output between these operations; the configured budget puts no upper bound on that read.

Deterministic reproducer through `createParcelBackend().watch()` and the registered parent callback:

1. Seed a real, recent 1 KiB extra behind `dist -> real-build`.
2. Deliver an update naming only `other.js`, the erased-event route.
3. Let the recheck stat the extra normally at 1 KiB. Immediately before its real content read, rewrite it to 12 MiB, representing a builder's write between stat and read.
4. The backend reads **12,582,912 bytes in one call**, although `READ_BUDGET` is **4,194,304**. It emits a change hint afterward, but the synchronous read, allocation and hash have already exceeded the cap.

The probe uses the production named builtin imports, real stat and read operations, a real symlink and the public callback boundary. Its read wrapper inserts the real write at the race boundary and counts the actual returned buffer. It does not fake the file size or returned content. Only timestamps are held recent, as in the existing discriminator. No concurrent timing luck is needed; this is a deterministic schedule that another process can produce. The same unbounded function is used for seeding and the final racy-to-settled comparison.

This remains within the prior S1's bounded-work question. It is now **blocking** because the repair brief makes the cap an explicit outcome and done-when, whereas the previous row set no numeric budget. It is not a proven missed event or stale-result acceptance: the post-read hint is correct.

One-worker repair: bound the actual bytes read and allocated, not only the size observed beforehand. For example, use a descriptor and a length-limited read within the remaining budget; hash only when a complete, suitably checked file fits, and return an unknown signature with a conservative hint when it grows or cannot be fully established within the budget. Debit attempted reads consistently. A post-read size check alone cannot undo the unlimited work. Add a public-backend regression that grows or replaces the file between stat and read and asserts both the actual byte bound and a hint. Retain the existing failed-read and settled-file controls. Rebuild both plugin bundles after the repair.

## Should-fix

None.

## Nits

None.

## Answers and what fits

- **Can any failed or skipped read still be trusted as unchanged?** **Verified for the bounded B1 reproductions: no.** `Signature.racy` separates an intentionally unhashed settled signature from an unknown racy hash. A failed seed and a failed subsequent recheck each cause the next erased same-tick rewrite to emit a change hint. `same()` rejects an unknown old racy hash before comparison, and rejects an unknown current hash against a known one. Failed and over-budget racy observations therefore do not become equal merely because their hash is null. A successful read restores a usable baseline. The shared catch handles EMFILE, ENOENT and other content-read exceptions the same way; disappearance detected by stat emits an unlink hint against a previously present signature.
- **Is the budget bounded?** **Only when file sizes remain stable between stat and read.** A stationary file of 4 MiB plus one byte is never read and is hinted on each batch. Two racy 3 MiB extras under one parent consume 3 MiB total in a batch, and the skipped second file receives a hint. Each file is read at most once in the batch, including the final comparison when it settles. Already-named files may still consume the shared budget but receive no duplicate hint. B1 above disproves the actual byte cap when an output grows during observation.
- **Is the conservative hint safe?** **Verified by the public probes and source path:** yes for result correctness. `ChangeFeed.onHints()` passes paths through debounce and candidates to reconciliation; `diffCandidates()` re-hashes racy cache entries, compares hashes, and adds a revision change only when content differs. The Parcel hint itself never records a result or a content hash. Unchanged over-budget or unreadable inputs can therefore add reconciliation work, but are not evidence of a new revision or a passing result. The 4 MiB cap covers the backend's supplemental content reads, not the downstream hasher's work.

The previous review's settled-file fast path still reads nothing. Ordinary successful same-tick detection, alias reporting and the existing two-second rationale are not reopened by this delta. Native Parcel/macOS delivery remains unverified here. The change adds no runtime dependency or public protocol type; `READ_BUDGET` is an exported internal constant for tests.

Independent production-backend probe output at the candidate:

```text
failed seed, then erased rewrite: 1 change hint
failed recheck, then erased rewrite: 1 change hint
steady over-budget file, two batches: 0 reads, 2 change hints
aggregate 3 MiB + 3 MiB: 1 read, 3,145,728 bytes, skipped file hinted
already named 3 MiB + 3 MiB: 1 read, 3,145,728 bytes, named hints only
settled inputs: 0 reads, 0 hints
file grows after stat before read: 1 read, 12,582,912 bytes, 1 change hint
```

The throwaway Node/tsx probe replaced the named builtin functions via `syncBuiltinESMExports()`, imported the unchanged production module, restored the builtins and removed every fixture. The probe is not part of the commit.

## Inputs for the next wave

- Send the proven remaining S1 budget break to the human before releasing 0.1.106. Original wave-13x B1 is closed; preserve its uncertainty behavior.
- The repair must cap bytes during the read, including growth or replacement between stat and read, and preserve a conservative hint when a complete file cannot fit. A size check after a whole-file read does not satisfy the bound.
- Keep this slice inside the Parcel recheck. Root-watch recovery and previously settled findings remain outside scope.
- Run the added growth discriminator, retain the failed-seed/failed-recheck/over-budget/settled controls, and meet the worker brief's Parcel repetition and validation gates. Rebuild both plugins and apply the coordinator's unreleased key-format decision.
- This review neither authorizes a hub release nor establishes a green independent full-suite gate.
