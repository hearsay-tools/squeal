# Wave 13z: third review of the Parcel recheck

## Verdict and verification

**PASS** at `23bc7afb`: **0 blockers, 0 should-fix, 0 nits**.
Range: `100b8472^..23bc7afb`. Task 001-248, bounded third round on wave-13y's remaining S1 budget finding, labelled B1 in that report. The range contains 001-247, its test-typing follow-up, the 0.1.107 bundles and the unreleased key-format 3 re-pin. The remaining finding is closed.

The worker began at `59536044`, whose only difference from the candidate is `docs/board.md`. All product checks and probes ran detached at **exactly `23bc7afb`**, with no tracked changes. The worker branch was restored before writing this report. No product, board or spec edits were made.

```text
env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npm ci
added 56 packages, and audited 57 packages in 1s
found 0 vulnerabilities
exit 0

env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npm run lint
> squeal@0.1.107 lint
> biome check .
Checked 770 files in 220ms. No fixes applied.
exit 0

env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npm run typecheck
> squeal@0.1.107 typecheck
> tsc --noEmit
exit 0

env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --maxWorkers=4
Test Files  2 failed | 350 passed | 1 skipped (353)
     Tests  2 failed | 2543 passed | 10 skipped (2555)
  Start at  23:23:14
  Duration  466.03s (tests 98%, import 1%)
exit 1
```

The independent full suite is **red**. Its two failures were `Error: Test timed out in 5000ms`:

- `test/daemon/open.test.ts:35`: five concurrent starts run integrity_check once; losers never open the store.
- `test/scheduler/checkpoint-tracker.test.ts:142`: a checkpoint a killed daemon left open is abandoned by the next, never resumed.

Neither test is in the changed Parcel path. Load sampled from about 5.0 before the run to `52.21 27.41 21.57` during it, with a separate Squeal baseline also running. Load contention is **plausible**; attribution to this candidate is **unverified**, so these are not additional blockers against this bounded repair. Both failed files passed separately at the same clean candidate, without changing their timeout:

```text
env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run test/daemon/open.test.ts --maxWorkers=1
Test Files  1 passed (1)
     Tests  2 passed (2)
  Start at  23:31:33
  Duration  1.02s (tests 55%, transform 37%, import 8%)
exit 0

env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run test/scheduler/checkpoint-tracker.test.ts --maxWorkers=1
Test Files  1 passed (1)
     Tests  10 passed (10)
  Start at  23:31:42
  Duration  645ms (tests 55%, transform 36%, import 8%, worker 1%)
exit 0
```

The separate retries do not make the full-suite result green. The full suite passed `parcel-racy.test.ts`, `parcel-links.test.ts` and `key-format.test.ts`.

`npm ci` warned about unapproved install scripts for `@parcel/watcher` and `esbuild`. `npm run build` was deliberately not run, as instructed. Independent bundle regeneration and macOS execution are **unverified**. Inspection confirms the descriptor read, chunk constant and `finally` close in both committed CLI bundles; the two CLI bundles are byte-identical. The key-format 3 re-pin follows the supplied decision that this version is unreleased.

The supplied coordinator gate had 2,543 passing tests and two 5 s timeouts, in CLI `why` and register-race, with both files then passing alone three times; CI was supplied as green. These are context, not this review's independent result. A separate Squeal background baseline ran concurrently: it reported a lifecycle daemon-start timeout that later recovered and a replacement-hook latency failure. Those reports are not substituted for the independent run.

## Blockers

None. Wave-13y's remaining budget break is closed, proven by the growth discriminator and the production read path.

## Should-fix

None.

## Nits

None.

## Answers and what fits

### Can any read still exceed the budget?

**Verified: only the explicitly allowed one-byte sentinel.** The 001-247 outcome permits "at most the remaining budget plus one byte". At `src/core/watcher/parcel-backend.ts:230`, every content read uses a descriptor. The buffer is at most 64 KiB and each `readSync` asks for at most the smaller of that buffer and `budget.left + 1` (`:240`, `:242`). Every returned byte is debited immediately. A read that makes the balance negative returns null before hashing its last chunk (`:244`, `:245`). Subsequent files, including zero-length files, fail the pre-open size guard against the negative balance. The sum is therefore at most **4,194,305 bytes per parent's batch or seed**, independent of a stale stat, file growth, short syscall reads or the number of siblings. It cannot spend another sentinel per file.

The previous 1 KiB-to-12 MiB reproducer now reads exactly 4,194,305 bytes, closes its descriptor and emits one `change` hint. An aggregate case first reads 1 MiB, then grows a second file to 12 MiB at the open boundary: total bytes still stop at 4,194,305, and both the second file and a following empty sibling are hinted. The shared `contentHash` is also used for seeding and the final racy-to-settled comparison. That final comparison passed the same growth discriminator. The budget is local to the supplemental recheck for one parent, as before; it does not cap downstream reconciliation.

### Is every descriptor closed?

**Verified: no acquired-descriptor exit bypasses closing.** A failed open owns no descriptor. Once open succeeds, hashing, allocation, all read iterations, EOF, budget exhaustion and caught exceptions are inside the `try` protected by `finally` (`src/core/watcher/parcel-backend.ts:238`, `:250`). The `finally` calls `closeSync(fd)` once. The public probes track actual successful opens and successful closes, recording no live descriptor after seeding or a callback. Normal EOF, an over-budget growth, final-settlement growth and an EIO after one successful chunk all have matching counts. The committed tests additionally assert an empty descriptor set after every case (`test/watcher/parcel-racy.test.ts:103`). The close-error catch is a deliberate callback containment path; it does not omit the close attempt.

### Is a truncated read ever trusted as unchanged?

**Verified for the bounded repair: no.** A short syscall result is not treated as EOF; the loop reads again. A digest is returned only after a zero-byte read. At exactly 4 MiB, a one-byte request returning zero establishes EOF and allows an unchanged file to remain quiet. If that request returns a byte, the function returns null instead of a prefix digest. An EIO after a successful chunk also returns null and preserves the bytes already spent. `same()` rejects an unknown old racy hash and cannot match an unknown current hash to a known one (`src/core/watcher/parcel-backend.ts:217`, `:218`), so incomplete reads emit conservative hints. The hint remains a reconciliation candidate, never evidence of a passing result.

The added committed tests exercise growth after stat, exact-budget EOF and a read failure after open. The growth test counts actual returned bytes and also intercepts the former whole-file API, so reverting to `readFileSync` cannot evade the assertion. Existing failed-open, over-budget and settled-file controls remain. Independent probes extend the cases to aggregate spending, partial syscall reads, EIO after a successful chunk and the final racy-to-settled comparison.

The previous settled-file fast path, alias reporting and original failed-read finding are not reopened. No runtime dependency or public protocol type changed. The test-typing follow-up gives the open fake `fs.OpenMode` without changing behavior.

Independent production-backend probe output:

```text
growth 1 KiB -> 12 MiB: 4194305 bytes, 1 opens/1 closes, 1 hints
aggregate growth spends remaining budget, then skips empty sibling: 4194305 bytes, 2 opens/2 closes, 2 hints
exact budget, EOF established: 4194304 bytes, 1 opens/1 closes, 0 hints
partial syscall reads, complete unchanged file: 4096 bytes, 1 opens/1 closes, 0 hints
EIO after first chunk, no partial digest accepted: 65536 bytes, 1 opens/1 closes, 1 hints
failed read retains spent bytes across siblings: 65536 bytes, 1 opens/1 closes, 2 hints
racy -> settled comparison still bounded after growth: 4194305 bytes, 1 opens/1 closes, 1 hints
open failure, uncertain signature: 0 bytes, 0 opens/0 closes, 1 hints
all public-backend discriminators passed
```

The throwaway Node/tsx probe imports the unchanged production module and calls `createParcelBackend().watch()` through the registered parent callback. It uses real symlinks, files, stats, descriptor reads and closes. Builtin wrappers insert growth after stat, count bytes and descriptors, limit individual reads for the partial-read case, or inject a specified failure. Only time is held steady for the racy cases. Builtins are restored and fixtures removed. No probe is committed. This review does not repeat the worker's 50-round Parcel gate.

## Inputs for the next wave

- No S1 fix row is needed. Preserve the one-byte aggregate bound, EOF-only digest, immediate debit and `finally` close when changing this loop.
- The report is bounded to 001-248. Previously closed findings and root-watch recovery remain outside scope.
- This is a PASS on the assigned S1 repair, not a green independent full-suite gate or release authorization. Carry the two recorded timing failures and their separate retries into the coordinator's gate decision.
