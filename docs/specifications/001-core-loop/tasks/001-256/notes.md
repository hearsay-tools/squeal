# 001-256 notes: `status --wait` from the store's re-key record

Survey, no code change. The full findings, the lines and tests a switch removes, the store change and the one-worker row text are in `research/wait-from-store.md`. Probes: `research/probes/wait-from-store/` (5 files, 13 tests, all passing at 8e5e5462; each case has a control that fails as the review found).

## Per probe

| Review case | Store-read answer | Control that fails as the review found |
| --- | --- | --- |
| 13k B1, regrown sibling at its result's revision | passes | a resolved revision not reopened: both waits `quiet`, 0 files, a's re-run held |
| 13k S1, result before the answer | passes: `news`, 1 own | open entries only (today's record): `quiet`, 1 other |
| 13l S1, later cached discharge | passes: `news`, 3 files | one entry per file: `quiet`, 2 files, 1 other |
| 13q S1 count | passes with 10,050 later entries, no cap | (no cap to evict) |
| 13q S1 age, 13t S1 | passes: no prune while a runner part is held; a prune runs in a commit, at its time, in one pass | age-only prune: fallback, never quiet |
| 13r B2, abandoned requests | passes: nothing per request; 40 syncs answered at once, 40 abandoned waits write nothing | (no hold exists) |
| 13s B2, the hour with no operation | passes: complete after 2 simulated hours | today fails at `HOLD_MS` |

## 001-228 and the backstop

Yes, a path remains, verified by experiment (`d5-backstop.probe.ts`). The setup: the runner is broken, `environment` hangs, and a `run --all` retry is queued before a held answer's `refined()` task. The retry is unbounded under the lock. The answer is still pending 10 simulated minutes after the retry starts, and ends only at `HOLD_MS` with `INCOMPLETE_ANSWER`. The store covered the capture as soon as the bounded runner part was abandoned. The baseline after an install has the same shape (read in source). Both designs share one limit: a hang that holds the lock before the capture pends the wait to its own timeout.

## Store change

A second meta row `rekeyed-moves.<worktreeId>`, written in `Ledger.commit`'s transaction. It holds a commit `seq`, `caughtUpAt`, a `dropped` watermark, and per file each open and resolved revision. Resolved entries are pruned after an hour, only once refinement has been caught up for 60 s. `rekeyed.<id>` stays as is for older hooks. No schema migration.

## Recommendation for the human

**Switch.** No probed case needs the socket answer. The store read passes every case, two of them better than today (13s B2 and the D5 retry path, which today end at the hour). It also removes about 470 source lines and about 720 test lines.
