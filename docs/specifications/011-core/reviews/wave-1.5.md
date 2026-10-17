# Wave 1.5 re-review: 011-01 B1 and S1

PASS `6e1f965bacaa1588fdb6d0b3394f7d5a29fda0cf`: 0 blockers, 0 should-fix findings, 0 additional notes. B1 and S1 are closed.

## Verification

Reviewed the exact `cand/0.1.204` candidate, HEAD `6e1f965bacaa1588fdb6d0b3394f7d5a29fda0cf`. The worktree was clean before and after verification. Scope is only `3c9949a8..6e1f965b`: diagnostic repair `97ea3e21`, bundles `3f50fb72`, retry-budget repair `d700f79b`, bundles `6e1f965b`. The prior review was read with `git show origin/main:docs/specifications/011-core/reviews/wave-1.md`; the accepted wording deviation was read from `origin/main:docs/specifications/011-core/status.md`. No product files were edited.

Independent checks in this worktree:

```text
$ npm ci
added 196 packages, and audited 197 packages in 7s
found 0 vulnerabilities
exit 0

$ npm run lint
> squeal@0.1.204 lint
> biome check .
Checked 1365 files in 562ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.204 typecheck
> tsc --noEmit
exit 0

$ npm run build
> squeal@0.1.204 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.204 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
exit 0

$ git status --short
(no output)

$ git diff --check 3c9949a8..6e1f965b
(no output)
exit 0

$ npx vitest run --maxWorkers=4 test/status/read-beside-writer.test.ts test/status/status.test.ts test/store/repos.test.ts test/cli/failures.test.ts test/cli/status-wait.test.ts test/cli/status-wait-paths.test.ts test/cli/status-wait-paths-overlap.test.ts test/harness/stop.test.ts test/keys/key-format.test.ts
 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/b82d0b12-a13e-4f3d-a38b-f599fd343204

 Test Files  9 passed (9)
      Tests  137 passed (137)
   Start at  09:38:48
   Duration  13.93s (tests 89%, transform 8%, import 3%)
exit 0
```

`npm ci` also printed the existing `node-domexception` deprecation and six install-script coverage warnings. Installation succeeded. These tests were run directly because this review explicitly requests independent row tests; they are not a Squeal checkpoint. Per the narrow re-review brief, no independent full suite was run: neither finding requires one. The coordinator reports 5,722 passed, 0 failed under the full-run lock at this SHA and CI run `39014295904`; those are supplied evidence, not checks independently rerun here.

### Independent contention probe

A throwaway Node probe created a disposable Git repository using `research/probes/issue-8-contention/seed.mjs`, added its current `testFileKeys` row, and used its own second Node process to hold `PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE` with an uncommitted `meta` insert. It ran the committed Claude Code CLI bundle as separate processes. The lock remained held throughout each command, so each unavailable result reflects actual contention. No live repository store was locked. The probe and disposable repositories were removed before committing.

Observed bundle output, with elapsed time measured around each child process:

| Command | Exit | Elapsed ms | Message's waited ms |
| --- | --- | --- | --- |
| `status` | 1 | 6110 | 5002 |
| `status --json` | 1 | 5111 | 5002 |
| `why 'auth > log'` | 1 | 5113 | 5002 |
| `why 'auth > log' --json` | 1 | 5145 | 5002 |
| `failures` | 1 | 5109 | 5002 |
| `failures --json` | 1 | 5108 | 5002 |
| `status --wait 60000 --json` | 1 | 1114 | 1003 |
| `status --wait 60000 src/auth.test.ts --json` | 3 | 1130 | 1003 |

Every output had the same factual suffix, with initial capitalization changed only by the text formatter:

```text
status unavailable, store busy, waited 5002 ms: another process holds the store's lock; run the command again once it is released
```

Every JSON result asserted `available: false`. No output named `status --wait`. The named wait's exit 3 is its existing no-verdict contract (`src/cli/status-wait-paths.ts:240`); the probe initially expected 1 there, corrected that probe assertion after reading the unchanged contract, then completed the named-wait and source checks. This was a probe expectation error, not a candidate failure.

The continuation independently called the built source API `readStatus` against the same kind of held lock:

```text
busyTimeoutMs=3000, busyRetryMs=300: elapsed 303 ms, message waited 302 ms
busyTimeoutMs=180,  busyRetryMs=400: elapsed 401 ms, message waited 401 ms
busyTimeoutMs=350,  busyRetryMs=0:   elapsed 352 ms, message waited 352 ms
busyTimeoutMs=350,  retry omitted:  elapsed 352 ms, message waited 351 ms
hook openContext, default timeout: elapsed 1003 ms, busy exception
PASS: named wait, first/final timeout cap, retryMs 0/default and hook context; unlocked status recovers
exit 0
```

The explicit-zero and omitted-retry cases both retained their full single attempt. After releasing the lock, the probe asserted that `readStatus` was available again. Timing includes ordinary execution overhead; the configured retry window bounds lock waiting, not process startup or all computation in a status read.

## Prior findings

### B1: closed, proven by source and the bundle probe

`src/core/status/open.ts:90` now reports measured elapsed waiting, identifies the held store lock and advises running the command again once it is released. It promises no behavior from `status --wait`. This matches the dated deviation on main dropping the row's requirement to name that command.

The common unavailable payload reaches all six ordinary CLI surfaces unchanged through `readStatus`, `readWhy`, `readFailures`, their text formatters and JSON serialization. The probe exercised all six. Both broad and named waits still omit `busyRetryMs`, and their first unavailable read still terminates the wait (`src/cli/status-wait.ts:319`, `src/cli/status-wait-paths.ts:221`). The probe confirmed one approximately one-second attempt despite a 60-second requested wait.

Hooks still open their context with the existing busy timeout and no retry loop (`src/harness/shared/context.ts:80`). No hook caller or hook budget changed. The independent hook-context probe kept one approximately one-second attempt; `test/harness/stop.test.ts` also passed its configured-budget accounting and actual locked-store Stop regression. Goal 6 is preserved.

### S1: closed, proven by source, regression and probe

`src/core/status/open.ts:82-84` computes the remaining retry window before every attempt, including the first, and caps that attempt's SQLite busy timeout to the remainder. This prevents an initial 3,000 ms timeout from consuming a 300 ms retry window and prevents a later attempt from retaining the full original timeout. The new regression passed; the independent probe measured 303 ms for the first-attempt case and 401 ms for a 400 ms multi-attempt window. The one-millisecond minimum and normal scheduling overhead do not recreate the previous full-timeout overrun.

With `busyRetryMs: 0` or no retry option, the original busy timeout is passed unchanged, and the first busy result returns unavailable. The independent explicit-zero and omitted-option probes both consumed one 350 ms attempt. Hook and wait reads keep this path.

## Delta, blockers, should-fix and nits

No blockers, should-fix findings or nits remain in this scope. The seven changed files contain only the diagnostic, timeout cap, corresponding regressions and their four bundled CLI copies. No caller, wait, hook, selection rule, schema, key pin or version changed in this range. Rebuilding produced no tracked drift. All four committed CLI bundles are byte-identical, SHA-256 `156916b40bf5ee85a8629eda8cedd04d33c239325d5c567614bfb8704dc795bf`.

## What fits and inputs for the next wave

Retain the ordinary CLI callers' `CLI_READ_RETRY_MS = 5000`, the factual unavailable payload, and the remaining-budget cap on every attempt. Keep hooks and both waits at one attempt per read. B1 and S1 need no further repair. The rest of wave 1 remains settled by `wave-1.md`; this re-review does not reopen it. Finding the production exclusive-lock holder remains outside this slice.
