# Issue #250: named status cost and wait deadline overrun

2026-11-19. Recommendation: keep this as an unreproduced performance report for 011, and profile the terminal worktree snapshot before choosing an index or changing heartbeat handling.

## Questions and verdict

| Question | Answer | Evidence |
| --- | --- | --- |
| Does no-wait named status take 13 s here? | Not determined. Live reproduction was skipped because the one-minute host load was 25.40 on 24 CPUs. | `verified by experiment`, host prerequisite only |
| Does `--wait 60000` overrun by 14 to 17 s here? | Not determined for the same reason. The reported workspace and its store were not reproduced or copied. | `inferred`, reproduction limit |
| Can a two-file status do work beyond those files? | Yes. Both named snapshot and terminal named-wait reads build a whole-worktree snapshot. | `read in source code`, 0.1.567 and 0.1.569 |
| Does the stale-heartbeat message prove a 15 s deadline extension? | No. It reports observed heartbeat age. The inspected wait retains its original elapsed-time limit. | `read in source code`, 0.1.567 and 0.1.569 |

## Report and examined versions

**`read in official docs` (issue report, not independent timing evidence), reported version 0.1.567.** [Issue #250](https://github.com/hearsay-tools/squeal/issues/250) reports host load 43 to 46 on 24 CPUs in a Squawk task. The exact no-wait command was:

```sh
time squeal status --json packages/cezar/src/core/runner-skill-trigger-omp-parity.test.ts packages/cezar/src/core/runner-skill-trigger-pi-parity.test.ts
```

The reporter recorded exit 3, `real 0m12.983s user 0m10.462s`, with both files current/pass. A 10 s external gate killed two calls. Two waits with `--wait 60000` reportedly took 74.3 s and about 77 s; the quoted output says the heartbeat went 15 s stale while its socket showed it alive. No restart was tried. These remain the reporter's measurements.

**`verified by experiment`, inspection identity and host prerequisite only.** Commands run:

```sh
gh issue view 250 --repo hearsay-tools/squeal --json title,body,comments,url,createdAt
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
git rev-parse HEAD
node -p 'require("./package.json").version'
git rev-parse 'squeal--v0.1.567^{commit}'
git diff squeal--v0.1.567 HEAD -- src/cli/wait src/cli/named-selection.ts src/cli/stored-walks.ts src/cli/listing-hold.ts src/cli/wait-liveness.ts src/core/status/snapshot.ts
```

Results: load `25.40 23.49 20.79`, 24 CPUs; HEAD `d0c6c2eb70a550bc200eba1141916ee0186caa93`, package 0.1.569; released 0.1.567 commit `407052a896ac643b655e239e30357ba11579ab5c`. The scoped diff was empty. The brief explicitly required skipping reproduction above CPU count and prohibited a VM bypass; this takes precedence over the repository's newer VM fallback. No synthetic load, live status call, store clone, test, full suite, or VM probe was run.

## Findings

1. **`read in source code`, 0.1.567 and 0.1.569: the final answer is broader than the named verdict.** `src/cli/wait/snapshot.ts` starts a sync bounded by its default 750 ms settle period, then synchronously performs `readOnce`. That function calls `buildSnapshot` even for named files. `src/cli/wait/named.ts` also calls it once a poll decides to end. In `src/core/status/snapshot.ts:129`, the snapshot reads `knownStates.list(worktreeId)` and `testFileKeys.list(worktreeId)`, then derives the worktree header, failures and other status fields. The named selection also lists the worktree's key rows in `src/cli/named-selection.ts`. Two selected files therefore do not imply two-file-only work. This establishes a profiling target, not the amount of CPU it took in the incident.

2. **`read in source code`, 0.1.567 and 0.1.569: stored-walk decoding is conditional.** Row 011-403's `StoredWalks.readers` queries and synchronously inflates/parses each available walk at the worktree rows' keys. However, `selectNamedFiles` chooses `own` directly for a listed test-file path; only another path reaches `readersOf` and the stored-closure/walk fallback. For the issue's two paths, if they were listed under those exact resolved paths, this fallback was bypassed. The report alone does not supply the selection's full JSON. Do not assign this regression to 011-403 without confirming which branch ran. Row 011-398's `listingMayChangeClosures` checks pending revisions and named key rows; its existence does not demonstrate the reported cost either.

3. **`read in source code`, 0.1.567 and 0.1.569: the elapsed deadline bounds polling, not all synchronous terminal work.** `pollStatus` in `src/cli/wait/wait.ts` starts one `performance.now()` clock. Before each store read, `readBound` captures whether the limit has passed. The read executes synchronously, including its final snapshot; only afterwards does the loop return its measured `waitedMs`. The deadline's store read deliberately receives the full 1,000 ms busy timeout (`src/cli/wait/presence.ts`, `src/core/status/open.ts`). A read begun just before the deadline can cross it and still require the following final read. No cancellation or CPU budget interrupts a synchronous snapshot. This permits elapsed overruns in principle; it does not prove the observed 14 to 17 s came from this work.

4. **`read in source code`, 0.1.567 and 0.1.569: heartbeat age is not an added wait allowance.** `watchDaemon` in `src/cli/wait-liveness.ts` records the maximum observed lapse in `staleMs`; `src/cli/status-wait-lines.ts` prints that age as “went N s stale ... so the wait went on”. The named decision table in `src/cli/wait/status-table.ts` still ends on `late` when no earlier verdict applies. The watcher does not change the poll's start or timeout and is stopped when the wait ends. A lapsed heartbeat can prevent an earlier verdict, subject to the synced/current-files exception in `named.ts`, but no explicit 15 s extension was found.

## Ownership, recommendation and remaining evidence

**`read in official docs`, repository contract at inspected HEAD.** 011 C6 owns snapshot reads and their consistency; its 011-42 amendment already requires narrow intermediate polls and records the historical cost of decoding all worktree states. C15 owns named demand and says the deadline bounds the wait. C7 inherits 001 D8's shared-store contract; C9 inherits 001 D10's daemon lifecycle. The store's busy bound and the daemon's liveness are distinct from total CLI CPU and rendering time. Preserve the current distinction between current results, completed sync and an available verdict.

**`inferred`, recommendation from the inspected source.** Approve a bounded follow-up that measures store-open/sync, named selection, verdict, whole-worktree snapshot and rendering separately on the reporting data shape, including user CPU and wall time. Decide the no-wait latency target and allowable `--wait` completion overhead with that evidence. A narrow named reply or cheaper worktree aggregates may help, but selecting an index now would assume the unmeasured hotspot. Changing the heartbeat clause alone would not address expensive terminal reads.

Still unknown: the report's store size and row counts; the exact resolved selection kinds; where its 10.462 s CPU went; how much the sync, SQLite, snapshot and rendering contributed; and whether the same timings occur under a safe reproduction load. This research proves neither a 0.1.567 regression nor a successful reproduction.

Sources: issue #250 linked above; `docs/specifications/011-core/spec.md` C6/C7/C9/C15 and crosswalk; its `status.md` amendments for 011-42 and wave 122; source paths named in findings. No product changes.
