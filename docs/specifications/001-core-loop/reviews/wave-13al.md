# Wave 13al review

Candidate: `88abeaa44469cd2844b2d078a3f7d4369a12d75a`.
Range: `cd1cdeb4..88abeaa4`.
Row: 001-287; review 001-288, the second round on `reviews/wave-13ak.md` B1, B2 and S1. Contracts: 001 goal 3, D7, D9 and D10; 004 D2, D3 and D9; `research/slow-claims.md` sections 2 and 4.

## Verification output

The assigned checkout initially contained `d029c85b`, whose only change after the candidate was `docs/board.md`. I detached at the exact candidate before installing or checking it. The tracked tree was clean throughout verification and the probes. Node v24.21.0. The brief excludes `npm run build`, so regeneration and build drift are **unverified** by this reviewer. No eval runner, agent session or repository verification script was invoked. The full suite includes its existing eval unit tests; it does not repeat retained calibration sessions.

```text
$ git rev-parse HEAD
88abeaa44469cd2844b2d078a3f7d4369a12d75a

$ npm ci
added 56 packages, and audited 57 packages in 2s
found 0 vulnerabilities
[exit 0]

$ npm run lint
> squeal@0.1.127 lint
> biome check .
Checked 882 files in 501ms. No fixes applied.
[exit 0]

$ npm run typecheck
> squeal@0.1.127 typecheck
> tsc --noEmit
[exit 0]

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --maxWorkers=4
Test Files  414 passed | 1 skipped (415)
     Tests  3282 passed | 10 skipped (3292)
  Start at  01:39:41
  Duration  637.02s (tests 98%, import 2%)
[exit 0; 0 failed]
```

`npm ci` warned that the installed parcel and esbuild packages have install scripts outside `allowScripts`; it exited 0. The suite printed two scratch-fixture `git worktree repair` notices and cleanup of one process left by an earlier run. It exited 0, with no failed tests or cleanup errors.

The probes were standalone scratch programs bundled through the installed esbuild API. They used product source modules, private scratch stores/repositories and the committed worker bundles, with `GIT_CONFIG_GLOBAL=/dev/null` and `CODEX_SESSION_ID` unset. Servers, workers and stores were closed and fixture directories removed. The before comparison loaded source files and the committed front-desk bundle from `cd1cdeb4` without changing this checkout. No product code was edited.

## Verdict

**PASS. B1 and B2 closed; S1 closed. No new blocking or should-fix finding, and no nits within the bounded re-review.**

## Blockers

None.

### B1 closed: startup nudges and front-desk callback failures

**Proven by experiment and source.** `src/core/scheduler/scheduler.ts:297` rejects a nudge until `#context` exists, which startup sets only after scan and baseline complete. `src/core/scheduler/slow-tier.ts:134` also checks readiness before calling `started()`. The normal post-start pump remains, and a closed scheduler still ignores a nudge.

I held the real scheduler inside its first `runner.environment()` call, after ledger initialization and before context publication, then invoked the direct entry and the shipped Claude Code socket worker wired to it:

```text
Before, cd1cdeb4:
B1 startup nudge: squeal scheduler: not started
B1 worker nudge uncaught: ["Error: squeal scheduler: not started"]
B1 ready nudge: returned

Candidate, 88abeaa4:
B1 startup nudge: returned
B1 worker nudge uncaught: none; ping: true
B1 ready nudge: returned
```

The before probe intercepted the uncaught exception only to record it and clean up; the ordinary daemon would terminate. The candidate probe observed no uncaught exception or desk error.

I also injected synchronous failures into activity, nudge, all three request callbacks, stop, step-down and failure reporting. Both the main-thread desk and the committed Codex worker desk survived. Every asynchronous request status reported the injected request error; subsequent ping still answered. An `onError` reporter that itself throws did not escape. This covers the routes beyond the first-round nudge counter test. `guarded()` is installed on both desk paths (`desk.ts:63`, `:81`, `:106`); the daemon connects caught event errors to its log (`daemon.ts:476`). The socket worker catches its receive listener and handles close rejection (`front-desk.ts:79`, `:118`).

The startup scheduler test now holds the baseline, proves a pre-start nudge is harmless, then proves it did not force a slow run while the consumer remained in a turn. Once the consumer goes idle, the post-start nudge still starts the slow file without waiting for the recheck timer. The gate exercises this ready-state regression as well as the new guard and daemon-log tests.

### B2 closed: policy changes cannot discharge a still-pending owned file

**Proven by experiment and source.** The first read captures `pendingSlow` once (`status-wait.ts:259`). Every later read calls `heldSlowLeft` with the captured IDs, today's known states and key rows, without filtering through today's policy (`status-wait-slow.ts:48`). Either a pending check or a queued/running row keeps an existing held file pending.

The original discriminator removes the slow glob 100 ms after the first read while its row and check remain running:

```text
Before, cd1cdeb4:
B2 glob: quiet; held pending []; stored phase running
B2 node: quiet; held pending []; stored phase running

Candidate, 88abeaa4:
B2 glob: timeout; held running file remains pending
B2 node: timeout; held running file remains pending
```

The node case removes a node:test project's slow flag. Both new tests encode these cases. Independent nearby probes also timed out with the owned path still named when the key changed, when the row had a null key but a pending check, when only the check remained pending, and when only the row remained running. Once the held row and check settled after the policy changed, the wait returned quiet. A moved key followed by its new result returned quiet after 243 ms, so it did not keep waiting on the old key.

Retirement is distinct: removing a held row and retiring its checks together, as `Ledger.commit` does, releases the logical file. It does not leave an ID that waits forever. The footer's existing "has its result" wording also covers retired files; that wording and the retirement discharge existed before this range. This probe establishes discharge, not completion of an obsolete physical runner. No inconsistent row/check deletion by the product writer was found: retirement is in one transaction with the row removal (`ledger.ts:426`, `:440`).

### S1 closed: slow-only and mixed news have truthful attribution

**Proven by experiment and source.** `status-wait.ts:273` counts the held slow files' transitions outside the edit window separately. `status-wait-lines.ts:69` names that count as the held slow files', leaving edit-owned news attributed to its actual files. `heldSlowNews` excludes IDs already counted in the edit window, so the sets do not double-count.

The original empty-window failure probe now prints:

```text
Before, cd1cdeb4:
Returned on news: 1 transition in the 0 test files the edits since revision 1 re-keyed, at revision 1 after 0.1 s; the 1 slow file run --slow queued has its result

Candidate, 88abeaa4:
Returned on news: 1 transition in the 1 slow file run --slow queued, at revision 1 after 0.1 s; the 1 slow file run --slow queued has its result
```

The independent mixed case prints:

```text
Returned on news: 1 transition in the 1 test file the edits since revision 1 re-keyed and 1 in the 1 slow file run --slow queued, at revision 1 after 0.1 s; the 1 slow file run --slow queued has its result
```

A slow file present in both sets contributed one transition, attributed to the two-file edit window that actually included it. The new tests assert the complete slow-only and mixed first lines, and the CLI command test now asserts slow attribution with another owned file still pending.

## Should-fix and nits

None within this re-review.

## Brief answers and what fits

- **Can any front-desk message still throw out?** No supported callback route escaped in the independent injections, on either desk path. Synchronous request errors become request-status errors; caught event errors reach the daemon log. The original startup seam is closed. This is evidence for the typed protocol and product callbacks, not a claim about arbitrary invalid values or process-level failures.
- **Can a change to policy, a key or a row return quiet while the owned file is pending?** Policy removal, project-flag removal, a moved key and a pending row or check no longer do so. Capture is by file ID, not original key or live classification. Row retirement intentionally releases a removed logical file, as described above. News can still return while another held file runs, with that file named in the pending suffix; it is not quiet.
- **Can a wait never return?** No new unbounded path was found. The monotonic deadline remains in force even when sync never answers; that probe returned timeout in 152 ms against a 150 ms budget. A continuing run returned timeout with its held path; a settling file returned quiet. The final store read still has the existing bounded busy timeout, so the CLI's wall time can exceed its requested polling budget by that read. Plain `status --wait` still excludes slow files as designed.
- **Is slow news named correctly?** Yes for slow-only and mixed windows; overlap is counted once, and fallback news still says "since the wait started" without false edit ownership.
- **Can a nudge force forbidden slow work or starve the fast lane?** The repair changes readiness and error containment, not triggers, explicit-request state, priority, load budget, claims or slot selection. Startup still pumps once ready, and the ready-state regression confirms idle is still required without an explicit trigger. The first review's settled fast-lane and policy checks are not reopened.
- **Does Stop stay within 2 s under load?** I repeated the extra first-round timing probe: a continuously pending fast file, a slow file pending, and a socket accepting the nudge but never replying. It returned silently in **1,609 ms**, sent exactly one nudge, at host load **59.35**. The 100 ms nudge remains inside the prior budget. A universal whole-hook bound including process startup and repeated store contention remains **unverified**, as in the first review; the repair does not change that path.

The release version is consistently 0.1.127. `KEY_FORMAT_VERSION` remains 8, re-pinned under the brief's explicit unreleased-version exception; the key-format guard is part of the independent suite. No wire or schema change was introduced. Types are additive: `DeskEvents.onError`, `SlowHost.ready` and `StatusWaitSlow.transitions`.

## Inputs for the next wave

No fix wave is required for B1, B2 or S1. Preserve the ordering: ignore nudges before scheduler readiness; catch callbacks on both desk paths; capture the slow IDs once; consult each held ID's row and checks; count overlapping news once. The planned primer/skill and one-shot Stop rows remain outside this review, including any 004 D9 amendment. This review does not validate a release or replace the excluded build-drift check.
