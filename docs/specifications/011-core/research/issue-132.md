# Issue 132: inherited passes and an unsynced named snapshot

Keep the sync guard; treat this as a snapshot timing and explanation question, not a ban on inherited results at revision zero.

Examined 2026-11-01: Squeal **0.1.389**, source commit `6e573c80bbad0c295e35b7a50d912ff151ffa3d1`, installed launcher and daemon **0.1.389**, Node **v24.22.1**, pnpm **12.15.0**. Research only. No product change, build, test-suite run, daemon restart, or change to existing holds.

## Questions and verdict

| Question from the brief | Answer and tag, version 0.1.389 |
| --- | --- |
| 1. Can the reported shape be reproduced? | **Verified by experiment: reproduced live.** One inherited selected test file was current/pass at revision 0, while selection returned code 3, `none`, `unsynced`. |
| 2. Does absence of a local revision prevent a verdict? | **Verified by experiment: no.** An isolated store with no revision row and one inherited pass gives code 0/pass when its sync answers revision 0. The same store gives code 3/unsynced with pending sync or a sync ahead at revision 1. |
| 3. What boundary accounts for the difference? | **Read in source code:** `readNamedSnapshot` waits at most 750 ms for sync, then reads the selection. `readOnce` requires sync and stored revision coverage before deciding a result. `selectionResult` returns `unsynced` before considering the current file counts. |
| 4. Is the original incident's exact cause established? | **Inferred:** its shape fits a sync that missed the snapshot window. **Not determined:** that incident's sync response and stderr were not recorded in the issue, so its exact sync state and delay cannot be proved. |

## 1. Original incident and local evidence

The [issue](https://github.com/hearsay-tools/squeal/issues/132) reports six Cezar parity test files, Codex, Squeal 0.1.389, revision 0, each current/pass, and `selection.code: 3`, `result: "none"`, `reason: "unsynced"`. Its JSON excerpt includes `no revision recorded for this worktree yet`. This is the reporter's evidence, not a run of that Cezar checkout here.

**Verified by experiment, 0.1.389.** Before any research-file edits, this Squeal worktree had revision 0 and 11,902 inherited current checks. Initial `uptime` gave one-minute load **15.67**; `getconf _NPROCESSORS_ONLN` gave **24**. The load gate permitted a live read. Command:

```sh
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status test/cli/selection-result.test.ts --json
```

Actual exit: **3**. Selected output, preserved in [live.json](probes/issue-132/live.json):

```text
revision: 0
notes: ["no revision recorded for this worktree yet"]
selection: outcome=snapshot waitedMs=1292 code=3 result=none reason=unsynced
testFiles: test/cli/selection-result.test.ts state=current verdict=pass
verdict: current=1 pending=0 stale=0 unknown=0 unlisted=false failures=0
```

[Captured stderr](probes/issue-132/live.stderr.txt) explains: `the daemon has not stored its pass over the latest edits, so this result may not cover them`. It ends with `status --wait 60000` for the same file. The snapshot also reports `fullSuite.atCurrentRevision: true`, `lastCompletedRevision: 0`; that field did not override the selection's sync gate and is not evidence of a suite run by this research.

**Verified by experiment, 0.1.389.** A subsequent, separate direct `sync` request answered `revision: null, error: null` initially and at 250 ms, then **revision 0** at 1,253 ms and 4,255 ms. See [live-sync.jsonl](probes/issue-132/live-sync.jsonl). This proves a live sync can complete at zero. It does not measure the earlier snapshot request or prove that request's completion time. At the end, load was **24.07 / 24 CPUs**, so no further live reproduction was attempted. No test was requested by either probe.

## 2. Isolated status-boundary probe

**Verified by experiment, source 0.1.389.** [boundary.ts](probes/issue-132/boundary.ts) creates a temporary store with one inherited current/pass check, a file key at zero, a fresh daemon record, and **no local revision row**. It calls the real `namedSnapshotCommand` and injects only the sync boundary. `settleMs: 0` makes the three cases deterministic without waiting or starting a daemon.

```sh
pnpm exec tsx docs/specifications/011-core/research/probes/issue-132/boundary.ts
```

Exit **0**; all assertions passed. [Full output](probes/issue-132/boundary-output.txt):

| Injected sync | Selected file | Selection result |
| --- | --- | --- |
| `pending` | current/pass, inherited, revision 0 | code 3, none, unsynced |
| `synced`, revision 0 | same | code 0, pass |
| `synced`, revision 1 | same | code 3, none, unsynced |

The probe verifies that the revision row is absent both before and after. It tests the status boundary, not cache-key correctness, daemon scheduling, or inheritance acquisition. No Vitest suite was run; the probe is outside Squeal's covered test files and was run directly.

## 3. Source boundary and recommendation

**Read in source code, 0.1.389.** `src/cli/status-paths.ts:60` starts the named snapshot timer before its initial store read. It uses `STATUS_WAIT_SETTLE_MS = 750` (`src/cli/status-wait.ts:69`) and stops waiting when sync completes or that budget expires. The final store read and rendering can make `waitedMs` exceed 750. `readOnce` requires a live daemon, a synced response, stored revision at or beyond sync, and a listed revision (`status-paths.ts:130`). `src/cli/verdict.ts:212` and `:236` map pending sync or an ahead-of-store sync to `none/unsynced`. Neither excludes revision zero or inherited origins.

**Read in source code, 0.1.389.** The daemon awaits reconciliation before answering (`src/core/daemon/daemon.ts:953`); the scheduler returns revision zero when it has no ledger (`src/core/scheduler/scheduler.ts:709`). `src/cli/status-sync.ts` accepts a sync revision whenever it is non-null, including zero. The note about no revision is produced independently in `src/core/status/snapshot.ts:137`.

**Read in official docs, repository contract at the examined commit.** C6 separates stored status from evidence that includes edits before a wait. C15 and `status.md`'s 011-206 amendment require gating on `selection.code` or `selection.result`, never the file's `state`. The 011-243 amendment adds the stderr explanation and repeat-wait command; 011-286 keeps the sync requirement even when a lapsed heartbeat can be accepted. Existing `test/cli/selection-result.test.ts:206` explicitly covers all-current passes with an unstored sync returning 3. These tests were read, not rerun.

**Inferred, 0.1.389.** The deciding tradeoff is latest-edit evidence versus an immediate answer from stored passes. Removing the gate based only on current file counts would discard its protection against unseen edits. Preserve it. If the human wants a change, investigate how JSON alone can explain the pending sync and its short snapshot window; the coordinator owns any design or authorization. The observed result already follows the C15 result rule.

Open questions: the original incident's exact sync state and duration; what consumed the live sync's time (not profiled); whether a longer named wait in the original checkout resolves without other changes (not run). No evidence here establishes a revision-zero defect or a need to rerun inherited tests.

## Sources

- [Issue 132](https://github.com/hearsay-tools/squeal/issues/132), fetched with `gh issue view 132 --repo hearsay-tools/squeal --json number,title,body,comments,url`.
- [Source tree at the examined commit](https://github.com/hearsay-tools/squeal/tree/6e573c80bbad0c295e35b7a50d912ff151ffa3d1); exact source paths and functions above.
- [Spec C6/C15](../spec.md), [amendments](../status.md), read at the same commit.
- [Probe README and exact commands](probes/issue-132/README.md); captures and executable probe in that directory.
