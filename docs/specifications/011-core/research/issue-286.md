# Issue 286: a named wait times out with the pre-edit pass

Recommendation: keep this as a proposed 011 diagnosis and progress-reporting question; the report does not prove a false pass, and the small live probe did not reproduce the delay.

Examined 2026-11-26: [issue #286](https://github.com/hearsay-tools/squeal/issues/286), which reports Squeal **0.1.636**; source at `846c3a8069d2941eb5e63f590fd11047442202eb` (**0.1.640**), compared with `squeal--v0.1.636`; installed launcher **0.1.640**, Node **26.13.0**, Linux, **16 CPUs**. This is documentation-only triage. It authorizes no implementation and changes no existing holds.

## Questions and verdicts

| Question | Answer and evidence |
| --- | --- |
| Does the incident prove a false current pass? | **Inferred, 0.1.636:** no. Its quoted final line says “Named test files have no verdict” and explicitly disclaims coverage of the edits. The issue gives no exit code or JSON. The historical `Current (1)` heading can still be confusing beside that warning. |
| Can a cheap live fixture reproduce the two-wait delay? | **Verified by experiment, 0.1.640:** no. One fresh node:test fixture returned the edited failure at revision 1 on the first wait in 1.378 s; the second returned the same failure in 0.377 s. This is a small synthetic project using a real daemon, not a reconstruction of the reported Squawk worktree. |
| Does a pending sync permit the old pass to become a named verdict? | **Read in source code, 0.1.636 and 0.1.640:** no. `passReached` rejects a pending sync; `selectionResult` gives `none/unsynced`, which maps to exit 3. Existing tests specify the reported warning. Those tests were read, not independently run. |
| Can the pending-sync response name the requested revision and progress? | **Read in source code, 0.1.640:** not from that response alone. Until reconciliation answers, the daemon stores `revision: null`; the CLI exposes only `{ state: "pending" }`. This response has no queue position, reconciliation stage, or progress count. |
| What caused the original minute-long wait? | **Not determined.** The incident provides no daemon/store trace, sync request state, startup timings, queue details, or runner configuration. Its warning does not establish that the edited test was already queued. |

## One bounded live probe

**Verified by experiment, 0.1.640.** [Probe](probes/issue-286/probe.py), [raw output](probes/issue-286/output.jsonl), [repeat instructions](probes/issue-286/README.md).

The probe started at 13:36:23 UTC. The one-minute load was **0.249**, below **16 CPUs**, so the local cheap run was allowed. It was **0.549** at the edit and cleanup. No load was manufactured, no dependencies were installed, and no repository suite ran. The fixture contained one node:test assertion with complexity and coverage disabled. Startup used `baseline.onStart: "lookup-then-run-missing"` to establish the initial result. The fixture had its own Git repository and daemon; it did not share the product repository's result store.

Command from the checkout root:

```sh
python3 docs/specifications/011-core/research/probes/issue-286/probe.py > docs/specifications/011-core/research/probes/issue-286/output.jsonl
```

The script used `~/.codex/plugins/data/squeal-hearsay/bin/squeal` from its fresh fixture directory. Exact CLI arguments and output are preserved in the raw file:

| Step | Command or edit | Actual result |
| --- | --- | --- |
| Startup | `squeal start`, then `squeal checks` | Both exit 0; the daemon initially says it is still starting. |
| Seed | `squeal status --wait 60000 probe.test.mjs` | Exit 0, revision 0 current pass, 0.378 s wall time. |
| Edit | `assert.equal(1, 1)` becomes `assert.equal(1, 2)` | Immediate file write; no hook simulation. |
| First wait | `squeal status --wait 60000 probe.test.mjs` | Exit 1, revision 1 current failure, 1.378 s wall time. |
| Second wait | Same command | Exit 1, revision 1 current failure, 0.377 s wall time. |
| Cleanup | `squeal stop` | Exit 0; only the fixture daemon stopped, fixture removed. |

The first post-edit verdict was:

```text
Named test files at revision 1: 1 known failure: 1 test; 1 test file, each with a current result, after 1.3 s. Worktree: known failures 1 (1 test); all 1 test file current
```

This does not disprove the incident on 0.1.636. The probe has one file, no existing backlog, no Claude Code/Squawk session, a newer runtime, and lower host load than the reported 4 to 6. There was one live attempt; no large project or artificial stall was constructed to force a similar message.

## What the source establishes

**Read in source code, 0.1.636 and 0.1.640.** `src/cli/status-wait-paths.ts` specifies a verdict at the current selected keys or the deadline. A deadline before the sync's revision is a timeout, not the older results' verdict. `src/cli/wait/synced.ts:passReached` returns false for pending sync. `src/cli/verdict.ts:selectionResult` and `resultCode` preserve that uncertainty as `none/unsynced`, exit 3. `test/cli/wait-again.test.ts` already asserts the same “passed at revision … has not stored its pass … may not cover” wording for a synthetic pending sync; `test/cli/status-wait-deadline.test.ts` covers re-keying and a later current failure. These are source evidence, not fresh test results.

**Read in source code, 0.1.640.** `src/core/daemon/handlers.ts` creates a sync request with a null revision, then fills it only when `context.requestSync` resolves. `src/core/types/daemon.ts:SyncResponse` and `src/cli/status-sync.ts:SyncState` expose the completed revision but no pending requested revision or progress. `src/cli/no-verdict-lines.ts:unsyncedText` therefore names the historical result and missing pass. `unlistedText` separately names a revision and running/queued counts when listing evidence exists. These are different states; neither a next revision number nor a queue blocker should be invented for the pending-sync case.

**Read in source code, 0.1.640.** `src/cli/wait/named.ts` sends promotion after the selection becomes ready. A sync that stays pending prevents that readiness. This is a useful seam to diagnose, not evidence that promotion caused the reported delay.

Comparison command:

```sh
git diff squeal--v0.1.636 squeal--v0.1.640 --stat -- src/cli/status-sync.ts src/cli/wait/synced.ts src/cli/wait/named.ts src/cli/no-verdict-lines.ts src/cli/verdict.ts src/core/daemon/handlers.ts test/cli/status-wait-deadline.test.ts test/cli/wait-again.test.ts
```

Only `no-verdict-lines.ts` differs among those files (remote-outage reporting); the sync guard and pending-sync wording remain. This narrow comparison is not evidence that all startup or scheduling behavior is unchanged.

## Recommendation and open evidence

**Inferred from the incident and source, 0.1.636/0.1.640.** Owner: 011 C2 (reconciliation), C4 (queued work), C6 (status), C9 (startup), C15 (named demand). The human can approve bounded diagnosis and clearer historical-result/progress reporting, fold that question into existing wait research, or defer. Keep the current-revision guard and bounded wait. A useful deadline should distinguish recorded progress from unavailable progress; the pending-sync protocol currently cannot supply every requested detail.

Before attributing the original delay, capture a recurrence's exit code/JSON, daemon version and start time, sync lifecycle, reconciliation/listing stage, and selected-file queue/run evidence. No automatic restart, capacity increase, shortened quiet, fairness change, or broader run is justified by this probe. The related #87, #139, #271 and #250 concern overlapping wait symptoms; this report establishes no shared cause or exact duplicate.

Sources: the linked GitHub issue; the paths above at `846c3a8069d2941eb5e63f590fd11047442202eb`; `docs/specifications/011-core/spec.md` C2/C4/C6/C9/C15 and its `status.md`; the preserved probe output. Product test suites, lint, typecheck and build were not run for this research-only change.
