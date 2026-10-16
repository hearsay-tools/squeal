# Research: issue 15, `why` omits the invoking worktree's current failure

Brief: `tasks/issue-15.md`, for https://github.com/hearsay-tools/squeal/issues/15 (reported 2026-10-16 on Squeal 0.1.199, cezarion PR 1170). Examined at commit 426d7268 (0.1.200, committed bundle `plugins/claude-code/dist/cli/squeal.mjs`) and the released 0.1.199 bundle (tag `squeal--v0.1.199`, e36fea56). Since that tag, `src/core/status`, `src/core/state`, `src/core/store` and `src/cli` changed only in 0dd072ca (001-367, `squeal stop`). Node 24.21.0, Vitest 5.0.3. Probe: `probes/issue-15/` (throwaway). It ran real daemons and the real CLI in a `/tmp` repository with a scratch `HOME`, then stopped them. No product code, test, board or spec was touched.

**Verdict: reproduced, deterministically, on 0.1.199 and 0.1.200 (5 runs, 5 of 5).** The mechanism: the `results` table keeps one row per check and key (D8). Another worktree with the same file content, so the same key, runs later and replaces the invoking worktree's row. The invoking worktree's known state is unchanged: an own, current FAIL whose fingerprint equals the replacement's. So `why` lists only foreign rows, and `runLog` is `null`. The 20-result cap is a second, separate way to drop the row from `results`, but it keeps `runLog` and cannot produce the issue's six-result shape.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Can `why --json` omit the invoking worktree's current failing result while returning other worktrees' results? | Yes, two ways. (a) Same-key replacement: A's row is gone from the store, `results` holds only foreign rows, `runLog: null`. This matches every observation in the issue, the six-result count included. (b) Cap: more than 20 newer rows of the check under other keys push A's row out of `results`, but `runLog` still names A's run. | verified by experiment (0.1.199, 0.1.200) |
| 2 | Repeatable reproduction path | `probes/issue-15/run.sh` (21 foreign keys, then same key) and `EDITS=5 … run.sh` (exactly the issue's six results). About 25 s each. | verified by experiment |
| 3 | Verified mechanism against the report's unconfirmed cause | The report claims no cause, and says explicitly that it is not a history limit. Our probe shows the cap cannot explain its shape: six results under 20, and `runLog: null`, which the cap never causes. Same-key replacement reproduces it exactly. That the cezarion worktrees shared the key is inferred: their temp paths differ only inside the error, and the fingerprint normalizes them to `<tmp>`. | verified by experiment (mechanism); inferred (that it was this mechanism in cezarion) |
| 4 | Log-pointer behaviour | Separate from the errors. After replacement, `runLog` is `null` in JSON with no reason. The human text gives a generic one: "Run log: unknown, no stored result is identifiably the one behind the known state (replaced, pruned, or several fit)". Yet A's `vitest.log` is still on disk, its `runs` row still names its `log_dir`, and `meta failure-producers:<A>` still names A's run id and recorded time. | verified by experiment; read in source code |
| 5 | Duplicates | Not a duplicate. 001-173, 001-188 and 001-190 made `why` name the right run or none. 001-190 chose none for exactly this same-key replacement, to avoid naming a wrong producer. Issue 15 is new information: in the multi-worktree case, none is what an agent gets, while the store still holds a producer reference (001-417 B3, 0.1.196) that `why` does not read. No other board row covers it. | read in source code; read in board |

## 1. Same-key replacement: the issue's shape

What the run did (`out-six/summary.txt`, `EDITS=5`, 0.1.200):

```
== 1-why-a-own.json
knownState: fail current observedAt=0 origin={"kind":"own"}
results: 1 (1 keys); own: 1; by worktree: wt-a
errors carry A's marker /tmp/squeal-1001/tmp/aa8a5cb5a96868a4/cez-cursor-package-baT9jo: true
runLog: present run=3249059a-… worktree=3f25407f5798340d
== 2-why-a-after-foreign-keys.json
results: 6 (6 keys); own: 1; by worktree: wt-c,wt-c,wt-c,wt-c,wt-c,wt-a
runLog: present run=3249059a-…
== 3-why-a-after-same-key.json
knownState: fail current observedAt=0 origin={"kind":"own"}
results: 6 (6 keys); own: 0; by worktree: wt-b,wt-c,wt-c,wt-c,wt-c,wt-c
first listed key 3ac8e05d33b1… (A's key)
errors carry A's marker …/cez-cursor-package-baT9jo: false
runLog: null
A's first run log …/runs/3249059a-…/vitest.log on disk at the end: true
```

The store after step 3 (`out-six/3-rows.txt`): `3ac8e05d33b1 wt-b run=28a4663a`. Key K's single row now belongs to B. *verified by experiment*

Why, in source at 426d7268:
- `results` has `PRIMARY KEY (check_id, key)`, and `putMany` is `INSERT OR REPLACE` (`src/core/store/schema.ts:99-117`, `src/core/store/repos/results.ts:94`). D8: "the newest run from any worktree replaces the stored outcome". *read in source code*
- B's run is held as inherited, then confirmed by B's own run (001-170). Its fail replaces the row. A's daemon does not re-derive A's state. A's state is own and current, fingerprint `AssertionError: expected '. <tmp>' to be 'present' … @ test/cursor.test.ts:9:37`, the same for every run. So no transition fires, and status still lists it as A's current failure. *verified by experiment (`3-status-a.json`)*
- `shownResult` (`src/core/state/shown-result.ts:51-53`): for a current state it takes the row at the current key and accepts it only when `provenance.worktreeId` is A's and the revision matches. B's row fails that test, so the result is `null` and `runLog: null`. *read in source code*
- The error text is not normalized. B's row shows B's temp path (`Received: ". /tmp/squeal-1001/tmp/068214ee…/cez-cursor-package-GKHhiI"`) as the first listed failure, under A's key, in A's `why`. An agent reading it attributes B's error to A, which is the risk the issue names. *verified by experiment (`out/3-why-a-after-same-key.txt`)*
- `status --json` in A also loses the failure's age and load: `recorded` holds A's revision, time and load per CPU at step 1, and is `null` with `recordedUnknown: true` at step 3 (`producingResult`, `src/core/state/producers.ts:105-127`). *verified by experiment*

## 2. The 20-result cap

`out/summary.txt` (21 foreign keys), both bundles: after step 2, `results: 20 (20 keys); own: 0`, while `durations.results` is 22, so A's row is stored but unlisted, and `runLog: present` still names A's run. `why.ts:138-149` lists `all.slice(0, WHY_RESULT_LIMIT)` and resolves the shown row from all of them (001-188). So the cap hides A's errors but not its log. *verified by experiment; read in source code*

## 3. What survives the replacement

At step 3 the store still holds: A's run row with its `log_dir`, `meta failure-producers:<A>` = `{"runId":"3249059a-…","recordedAt":…}`, and A's failure text (`failure_texts` row carrying A's marker: 1). The text is now unreferenced. `dropOrphanFailureTexts` deletes it at the next prune (`src/core/store/prune.ts:198-202`), which the daemon runs hourly (`lifecycle.ts:180`, `pruneMs` default 60 min). A run with no result is deleted with its log after the retention cutoff, 7 days by default (`prune.ts:89-99`). So A's full errors are recoverable from the store for at most an hour, and its log for up to 7 days. *verified by experiment (presence); read in source code (lifetimes)*

## Recommendation for Squeal

Treat the issue as confirmed, mechanism (a). Any fix has to keep A's own errors once a same-key run elsewhere replaces the shared row. Today they are lost by design, one row per check and key. Inheritance still has to work. That is a D8 decision for the human:
1. keep the producing row per worktree,
2. keep the producer's errors beside `failure-producers`, or
3. say in `why` that the shown errors are another worktree's.

The log pointer can already be resolved from stored facts (the producer's run id, then `runs.log_dir`). The JSON should then say why it is unavailable, not just give `null`. Vision fit: §7 "Full logs stay retrievable", and the filter's "Does it preserve provenance and uncertainty?" Both fail here, because the payload shows B's evidence under A's key with no warning. The issue's third acceptance criterion, tests over concurrent same-check results across worktrees, maps directly onto this probe's three steps.

## Open questions

- Whether cezarion's six results included one at the invoking worktree's key. Not determined, because the issue's captured JSON is not attached. That one field would confirm mechanism (a) for that session.
- The issue's `observedAt: 3` against the probe's 0. Not tested beyond revision 0. The source path does not depend on the revision (`shownResult` compares `provenance.worktreeId` first).
- Not part of this issue: A's human `why` prints "Revision: none recorded" at revision 0, while its known state says "observed at revision 0".

## Sources

- https://github.com/hearsay-tools/squeal/issues/15 (read with `gh issue view 15 --json`, 2026-10-16)
- `src/core/status/why.ts`, `src/core/status/run-log.ts`, `src/core/state/shown-result.ts`, `src/core/state/inherited.ts`, `src/core/state/producers.ts`, `src/core/store/repos/results.ts`, `src/core/store/schema.ts`, `src/core/store/prune.ts`, `src/core/daemon/lifecycle.ts`, `src/core/types/status.ts` at 426d7268
- spec D7, D8, `status.md` 2026-10-09 (001-170) and 2026-10-15 (wave 14); board rows 001-173, 001-188, 001-190, 001-417; `reviews/wave-13i.md` B4, `reviews/wave-13j.md` B4
- Probe outputs: `probes/issue-15/out/` (0.1.200, 21 edits), `out-0.1.199/` (0.1.199, 21 edits), `out-six/` (0.1.200, 5 edits)
