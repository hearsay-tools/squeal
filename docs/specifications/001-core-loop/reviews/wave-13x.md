# Wave 13x: review of 001-243

## Verdict and verification

**FAIL** at `87d3eecc`: **1 proven blocker, 1 proven should-fix, 0 nits**.
Range: `10b4c5c0^..87d3eecc`. Scope: 001-243's racy-signature fix, its test, the 0.1.105 bundles and the unreleased key-format 3 re-pin. Row 001-235 supplies the erased-event contract; it is not re-reviewed here. Row 001-236's root-watch recovery remains outside this change.

The worker initially had `cb6406fe`, whose delta from the candidate is only `docs/board.md` and `reviews/wave-13w.md`. Verification below ran after detaching at **exactly `87d3eecc`**, with no tracked changes. The worker branch was restored before this report was committed. No product, board or specification changes were made.

Commands used the coordinator's environment isolation:

```text
env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npm ci
added 56 packages, and audited 57 packages in 2s
found 0 vulnerabilities
exit 0

env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npm run lint
> squeal@0.1.105 lint
> biome check .
Checked 770 files in 310ms. No fixes applied.
exit 0

env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npm run typecheck
> squeal@0.1.105 typecheck
> tsc --noEmit
exit 0

env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run
Test Files  14 failed | 338 passed | 1 skipped (353)
      Tests  14 failed | 2524 passed | 10 skipped (2548)
   Start at  21:18:39
   Duration  319.44s (tests 97%, import 1%, transform 1%)
exit 1
```

`npm ci` also warned that the install scripts of `@parcel/watcher` and `esbuild` were not covered by `allowScripts`. `npm run build` was deliberately not run, as the brief requires. Independent bundle regeneration and macOS execution are therefore **unverified**. The CLI bundle diffs contain the same new signature, hash and comparison code in both harnesses. The independent suite includes the key-format guard. The human's explicit unreleased-version instruction authorizes re-pinning version 3 in place.

The full suite had 13 test/teardown timeouts and one daemon-departure assertion (`test/daemon/departure.test.ts:138`, expected a live child with `exitCode === null`, got 0). Load sampled during the run was `87.07 39.85 17.32`; the background Squeal baseline was also running and reported timing failures. None of the failing tests targets the changed Parcel recheck. Attribution to this candidate is **unverified**; the failures are recorded rather than promoted to additional blockers. This run does not reproduce the coordinator's green full-suite result.

Failed files:

- `test/daemon/departure.test.ts`
- `test/harness/primer-slow.test.ts`
- `test/harness/session-start.test.ts`
- `test/keys/ignored-inputs.test.ts`
- `test/keys/require-helper.test.ts`
- `test/integration/touched-caches.test.ts`
- `test/scheduler/claims-expiry.test.ts`
- `test/scheduler/ordering.test.ts`
- `test/scheduler/rekeyed-delivery.test.ts`
- `test/status/builder.test.ts`
- `test/status/checkpoint.test.ts`
- `test/status/why-revert.test.ts`
- `test/watcher/links.test.ts`
- `test/harness/codex/review.test.ts`

The focused recheck/real-Parcel/key-format verification then ran at the same clean candidate:

```text
env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run test/watcher/parcel-racy.test.ts test/watcher/parcel-links.test.ts test/keys/key-format.test.ts --maxWorkers=1
Test Files  3 passed (3)
      Tests  36 passed (36)
   Start at  21:24:11
   Duration  2.30s (tests 74%, transform 18%, import 7%, worker 1%)
exit 0
```

The 14 failed files were then re-run once at the same clean candidate with one Vitest worker:

```text
env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run test/daemon/departure.test.ts test/harness/primer-slow.test.ts test/harness/session-start.test.ts test/keys/ignored-inputs.test.ts test/keys/require-helper.test.ts test/integration/touched-caches.test.ts test/scheduler/claims-expiry.test.ts test/scheduler/ordering.test.ts test/scheduler/rekeyed-delivery.test.ts test/status/builder.test.ts test/status/checkpoint.test.ts test/status/why-revert.test.ts test/watcher/links.test.ts test/harness/codex/review.test.ts --maxWorkers=1
Test Files  14 passed (14)
      Tests  84 passed (84)
   Start at  21:24:34
   Duration  110.66s (tests 98%, import 1%, transform 1%)
exit 0
```

All failed files passed on that retry. Load contention is a **plausible** explanation, not a proven root cause. The retry does not turn the original full-suite run green, and its results are not combined with that run to claim a passing full suite.

## Blockers

### B1. Proven: an unreadable racy signature becomes trusted as if it were settled

Location: `src/core/watcher/parcel-backend.ts:177`, `:185`, `:191`; state replacement at `:149`.

`Signature.hash === null` has two meanings: the file is older than the racy window, or reading its bytes failed. `same()` accepts the old stat without comparing content whenever `before.hash === null`. A failed read of a recently written file therefore removes the protection 001-243 was meant to add, even when the next read succeeds.

Reproducer through `createParcelBackend().watch()` and its registered parent callback, using a real same-inode, same-size file and only the timestamp/read stubs:

1. Hold `mtimeNs` and `ctimeNs` at the current time, preserving the real inode and size, exactly as `parcel-racy.test.ts` does.
2. Make the seed's `readFileSync` throw `EMFILE` once. The file still exists, and its stat succeeds. This models transient descriptor exhaustion; it does not require removing or replacing the inode.
3. Restore successful reads, rewrite `aaa` to `bbb`, and deliver a batch naming `other.js` only.
4. **Observed: zero hints.** The racy signature now has a valid hash, but `before.hash === null` makes the comparison return true.

A second route begins with a valid seed. Just one failed recheck read is enough: `same()` may successfully re-read the unchanged `aaa` via its fallback, but `find()` already stored `now.hash === null` and never repairs it. The next same-tick rewrite is missed. If both the initial read and fallback fail, the recheck instead reports a conservative extra change hint and saves the same null hash. A following successful same-tick rewrite to `bbb` produces **zero hints** again. No `onError` or `onDropped` is emitted on either route.

This fails row 001-243's done-when, "the recheck otherwise sees the rewrite", and D12's "Watcher backend error or dropped-events signal: full reconciliation pass; a note in status." It also violates the styleguide's rule against silently swallowing errors. A later ordinary timestamp-moving write may recover detection, but the erased event under review remains missed. Do not rely on the periodic reconciliation to stand in for this row's same-tick recovery.

One-worker fix: represent an unreadable racy hash separately from an intentionally unhashed settled signature. Preserve uncertainty on failed reads, conservatively report the path or route a contextual error through the existing lost-event/reconciliation path, and do not replace a usable comparison baseline with a trusted null hash. Catching a missing file must likewise avoid declaring equal content from an unknown read. Add public-backend regression cases for a failed seed and a failed later recheck followed by successful reads and an erased same-tick rewrite. Retain the existing unchanged-file and settled-file controls.

## Should-fix

### S1. Proven: the racy content work has no byte, file-count or per-batch bound

Location: `src/core/watcher/parcel-backend.ts:139`, `:146`, `:148`, `:150`, `:190`.

Every extra file in a parent's map is signed on every parent callback. Every racy signature reads and hashes the entire file synchronously, before checking whether the batch already names it or whether its stat differs. Seeding does the same. The two-second window limits age, not bytes, callbacks, files or callback duration; continuously rewritten outputs remain racy indefinitely.

Production-path probe with one unchanged 8 MiB extra, held recent timestamps and ten batches:

```text
busy sibling: 10 complete reads, 83886080 bytes, no hints
already-named file: 10 complete reads, 83886080 bytes
```

A busy sibling need not be a declared input. Only the declared extras are read, but there is no bound on their aggregate size or repeated work. A large file also allocates its entire buffer on the daemon thread for every hash. The settled-file test establishes a useful steady-state fast path; it does not establish a workload bound. The answer to the brief's "costs too little to matter" question is **no**.

This is a should-fix rather than a second blocker: the row sets no numeric read budget, and this probe establishes byte cost, not a measured violation of a particular latency contract. One-worker follow-up: define a byte/time budget and use conservative hints for files that exceed it, preserving downstream content verification, rather than treating skipped reads as equal. Avoid re-reading already-named files merely to suppress duplicates; keep an explicitly uncertain baseline if exact refresh would exceed the budget. Add a large-extra/busy-sibling control that counts bytes or demonstrates bounded callback work. Streaming alone bounds memory but not synchronous total work.

## Nits

None.

## Answers and what fits

- **Can the recheck invent or miss a change?** A successful unchanged racy hash comparison reports no extra hint. A failed current read can produce a hint with unchanged bytes; that is permitted because D2 treats events as hints and downstream hashing drops no-op changes. B1 is the proven missed-change case, and it is not safe. Stat-only differences also remain hints, as before this change.
- **Is two seconds sound on Linux and macOS?** **Inferred, conditional on ordinary filesystem clocks:** yes for timestamp ticks no larger than two seconds. `max(mtimeNs, ctimeNs)` protects either recent timestamp, and the inclusive lower boundary keeps the exact two-second case racy. Nanosecond-valued fields do not imply nanosecond update resolution; Linux's coarse kernel clock and common macOS filesystem resolutions fit within this conservative window. It agrees with the existing `RACY_WINDOW_MS = 2000` rationale in `src/core/hash/stat-cache.ts:18`. Actual macOS behavior, unusual filesystem clocks and large wall-clock steps were not experimentally verified here. A two-second constant is not an unlimited-filesystem guarantee.
- **Is content work bounded?** S1 answers no. After successful settling, the ordinary unchanged-file path stops reading, but freshness alone cannot bound a busy parent's total reads.
- **Does dropping the hash reopen the normal race?** With successful reads and ordinary clock/timestamp progression, **no**. On the first settled observation with unchanged stat, `same()` hashes once more via its fallback before dropping the baseline hash. A future write outside the old tick moves the stat and is detected. Probe: one final read on the racy-to-settled transition, zero on its next unchanged batch, and a hint for a later timestamp-moving rewrite. B1 is specifically an unsuccessful read being mistaken for this settled state.
- **Does the test stub exercise production?** **Verified:** yes. `vi.mock("node:fs")` replaces the named imports the production module uses. The stub delegates the real stat and read, overrides only `mtimeNs`/`ctimeNs`, retains real inode and size, and calls the public backend with a fake Parcel that records the actual parent callback. The declaration through a symlink reaches the real-parent extra subscription and `ErasedEvents`. Independently replaying this held-stat rewrite through the pre-fix backend produced zero hints; the candidate produced one change hint. The tests do not emulate Parcel's native lock race or prove macOS delivery, and that is appropriate for this row's deterministic same-tick discriminator.

The implementation stays inside the backend boundary and changes no public type or dependency. SHA-1 here is a transient content comparison, not a persisted key; it need not be a git blob hash. Successful same-tick detection, unchanged-content silence, alias reporting, and the settled fast path fit the intended design.

Probe output at the candidate:

```text
same-tick rewrite: 1 change hint
settling: 1 final content read, then 0; later timestamp-moving rewrite: 1 hint
busy sibling: 10 complete reads, 83886080 bytes, no hints
already-named file: 10 complete reads, 83886080 bytes
seed read EMFILE + same-tick rewrite: 0 hints (miss)
recheck read EMFILE, fallback succeeds, next same-tick rewrite: 0 hints (miss)
unchanged file + recheck read EMFILE: 1 change hint (conservative false positive)
next same-tick rewrite after failed read: 0 hints (miss)
```

The throwaway Node/tsx probe replaced `fs.statSync` and `fs.readFileSync`, synchronized named builtin exports with `syncBuiltinESMExports()`, then imported the unchanged production module. It used real file writes and the public watch/callback boundary, restored the builtins, and removed its fixture. The predecessor control loaded `git show 10b4c5c0^:src/core/watcher/parcel-backend.ts` outside the tree with the unchanged `Exclusions` helper. No probe is included in the commit.

## Inputs for the next wave

- Route B1 to the human before releasing 0.1.105. A fix must keep read failure distinct from a settled signature and connect unknown observations to conservative hints or the existing D12 error/reconciliation path.
- Set a workload budget before asserting S1 is cheap. Exceeding it must preserve uncertainty and correctness, never silently skip a comparison as equal.
- Keep the final racy-to-settled comparison and deterministic real-stat stub. Add the two failed-read regressions and a bounded-work control; do not expand this fix into 001-236's root-watch work.
- Rebuild both plugins after any product fix, raise the plugin patch version, and run the key-format guard. Follow the coordinator's current unreleased/released decision when choosing whether to re-pin or bump key-format 3.
- Re-review B1 against the repair. This report does not authorize the hub release or establish native macOS verification.
