# Wave 13w review (001-241)

## Verification output

Clean tested HEAD: `3c94e5a9f19c51fbf4e06babeaa26705c23c16c6`, package 0.1.104. Reviewed range: `160bb5c9..97e05822`, third round on `reviews/wave-13v.md` **B1 and S1 only**. HEAD follows the product candidate `97e05822` by two documentation commits. `git diff 97e05822..HEAD --name-only` reports only `docs/board.md`, as the dispatch permits; product, test and bundle sources equal the candidate. Linux, Node 24.21.0. All execution evidence below was collected on the clean tree before writing this report. No product, test, bundle or board file was edited.

```text
$ git rev-parse HEAD
3c94e5a9f19c51fbf4e06babeaa26705c23c16c6
$ git status --short
(no output)

$ npm ci
added 56 packages, and audited 57 packages in 2s
found 0 vulnerabilities
(exit 0; npm warned about @parcel/watcher and esbuild install scripts)

$ npm run lint
> squeal@0.1.104 lint
> biome check .
Checked 769 files in 291ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.104 typecheck
> tsc --noEmit
(exit 0)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --maxWorkers=4
Test Files  3 failed | 348 passed | 1 skipped (352)
     Tests  3 failed | 2532 passed | 10 skipped (2545)
    Errors  1 error
Duration 651.76s
(exit 1)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run test/cli/codex.test.ts test/scheduler/environment-growth.test.ts test/harness/codex/bundles.test.ts --maxWorkers=1
Test Files  3 passed (3)
     Tests  43 passed (43)
Duration 8.97s
(exit 0; no unhandled error reported)

$ git diff --check
(no output; exit 0)
```

The independent full suite is **not green**. Its failed files passed in the isolated retry; that does not replace its full-run result. The changed confirmation and re-key-record tests, existing wait tests, `test/e2e/transitions.test.ts`, and the key-format guard passed in the full run.

| Full-run failure | Evidence | Classification |
| --- | --- | --- |
| `test/cli/codex.test.ts:103`, scratch HOME/CODEX_HOME CLI case | 5,000 ms timeout, reported duration 5,114 ms. | Passed isolated. A repair-caused regression is **unverified**. This test's init path does not exercise either changed predicate. |
| `test/scheduler/environment-growth.test.ts:170`, forced full suite in B | `expected 0 to be greater than 0`; `Matcher did not succeed in time` while polling A's closure count, before B starts. | Passed isolated. A repair-caused regression is **unverified**. The failed assertion precedes the result/discharge paths being reviewed. |
| `test/harness/codex/bundles.test.ts:71`, newer-schema user-prompt-submit case | 5,000 ms timeout, reported duration 5,708 ms. | Passed isolated. A repair-caused regression is **unverified**. The unusable-store fixture exits before edit delivery. |

Vitest also reported one unhandled rejection from the environment-growth file: `git check-attr ... failed ... spawn git ENOENT`, at `src/core/fs/git.ts:44`. It named that failed test's temporary fixture. The isolated run reported no such rejection. Cleanup while asynchronous startup was still active is **inferred**, not a proven cause. Host load reached 108.26 at one sample; load alone does not establish any failure's cause. These are verification notes outside the bounded findings, not new blockers.

The coordinator's supplied 2,535-pass/one-parcel-failure gate is separate evidence. Its parcel racy-stat gap is already row 001-243, outside this round. That file did not fail in this independent run.

`npm run build` was expressly forbidden and was not run. Build reproducibility and bundle drift remain **unverified**, not blockers. Inspection of the committed CLI and hook bundle deltas found the same discharge and pending predicates as the sources, and version 0.1.104. KEY_FORMAT_VERSION remains 3, re-pinned in place; the supplied unreleased history and `status.md`'s shipped version 2 in 0.1.99 support that choice. Its guard passed.

The separate background Squeal baseline reported four failures, then recovered all four. A final pull before writing this report said:

```text
$ node --disable-warning=ExperimentalWarning "/home/agent/.codex/plugins/cache/hearsay/squeal/0.1.99/dist/cli/squeal.mjs" status
Revision: 0
Known failures: 0
Affected checks: 2887 passed, 0 running, 0 queued, 10 skipped
Full-suite checkpoint: completed at revision 0
```

That checkpoint is not the independent gate above.

## Verdict

**PASS** `3c94e5a9f19c51fbf4e06babeaa26705c23c16c6` (product candidate `97e05822`): **0 blockers, 0 should-fix findings, 0 nits** in this bounded re-review.

Wave 13v B1 and S1 are repaired. This verdict concerns those findings; it does not claim a green independent full suite or verified build reproducibility.

## Blockers

None.

## Should-fix

None in scope.

## Nits

None.

## Brief answers and what fits

### Can the settled line still appear while an edited file is pending for any reason?

**No path found for a file in the consumer's current edit set. B1 closed.** `src/core/delivery/edits.ts:152` now withholds settlement whenever a selected keyed row has non-null `pending`, regardless of its persisted `open` value. This covers queued and running confirmation runs, forced runs, and other causes of pending. It does not advance the consumer's edit floor or prune its resolved record while settlement is withheld. The selection, row read and note acknowledgement remain in delivery's synchronous store transaction (`src/core/delivery/delivery.ts:163`), so the predicate and rendered header describe one committed state.

`test/delivery/edits-confirmation.test.ts:129` uses the real ledger, `queueReruns`, store, sink and delivery in the tier's order. It proves that the first FAIL discharges the edit but queues its confirmation, neither queued nor running delivery says settled, a same-failure confirmation produces silence, and later news carries the settled line exactly once. The forced same-key case at line 158 also holds the line back until its result. Both passed in the independent full run. Wave 13v contains the pre-repair failing probe; no fresh red run of the old candidate is claimed here.

The merged first-edit/settled wording consumes the same `editsSettled` field, so the changed predicate protects it too. Stop delivery policy and formatting are unchanged. Previously settled edits and unrelated backlog files are outside the current selected edit set; the repair does not broaden that set.

### Is status --wait unchanged?

**Yes, for the reviewed change.** No wait, live attribution, discharge-history, sync-answer or rerun logic changed. The ledger still calls `discharges.note` before `clearKeyedAt`, at exactly the same result/unknown sites. `Discharges.note` still records nothing for a fresh file with null attribution. Only the persisted delivery-record mark is now scheduled in that case.

`test/delivery/edits-confirmation.test.ts:175` proves the deliberate distinction: after the edited file's new failure queues a same-key confirmation, the wait's real discharge history names the edit as resolved, its edit window includes that file for news, and `heldPending` returns zero. Delivery waits to call the file current; `status --wait` still excludes that confirmation as required by D7. This regression passed in the independent suite. The restart probe below also proved that reconciling the delivery record creates no live wait attribution or discharge history.

### Is the open mark cleared on every path that resolves it?

**Yes in the ledger's resolving paths. S1 closed.** `src/core/scheduler/ledger.ts:463` schedules the persisted mark even when the fresh ledger has no `keyedAt`. The mark is committed with the file's row and sink changes. `recordRekeyed` preserves the latest recorded move; a baseline file with no existing record still creates none.

| Resolving path | Source route |
| --- | --- |
| Current-key local result, including an empty result set | `applyResults` at `ledger.ts:298` calls `#discharge`. |
| Accepted cache hit at bootstrap, settlement, claim or tier start | Callers use the same `applyResults` route. |
| Already-current result or unknown shortcut during settlement | `settle` at `ledger.ts:200` calls `#discharge`. |
| Current-key unknown from crash, timeout, exhausted discards, observed-growth exhaustion or runner failure | Callers use `markUnknown`, which calls `#discharge` at `ledger.ts:345`; runner blocking also uses that route. |
| Test-file removal | `commit` removes the record via `recordRekeyed`'s removed IDs. |

The committed restart test at `test/scheduler/rekeyed-record.test.ts:99` creates an open record through the old ledger, creates a fresh ledger, accepts a current-key result, preserves `last`, leaves live attribution null, and then prunes the resolved record. Its companion test proves an ordinary baseline result creates no record. Both passed in the independent suite.

An additional throwaway TypeScript probe used the actual store, state sink and ledger with a fresh file and persisted `{ open: 1, last: 2 }`. It independently checked the paths missing from that restart regression. Output:

```text
current-result: {"open":null,"last":2}; live attribution null, discharge history 0; pruned
cached-hit: {"open":null,"last":2}; live attribution null, discharge history 0; pruned
result-shortcut: {"open":null,"last":2}; live attribution null, discharge history 0; pruned
unknown: {"open":null,"last":2}; live attribution null, discharge history 0; pruned
unknown-shortcut: {"open":null,"last":2}; live attribution null, discharge history 0; pruned
removed: null; live attribution null, discharge history 0; pruned
older-result: {"open":1,"last":2}; live attribution null, discharge history 0; open preserved
older-unknown: {"open":1,"last":2}; live attribution null, discharge history 0; open preserved
```

The probe ran with `node_modules/.bin/tsx`, exited 0, closed and removed its scratch stores, and was deleted before writing this report. Older-key completions intentionally resolve nothing. The resolved record remains available to consumers until their existing edit-floor/departure pruning permits deletion; worktree ownership and cardinality bounds are unchanged.

## Inputs for the next wave

1. No further B1/S1 repair is required by this review. Keep the real confirmation, forced-run, wait-discharge and restart regressions.
2. Keep delivery's current-row pending requirement separate from `status --wait`'s discharged-edit semantics. Restoring persisted attribution into the live ledger would change that contract.
3. The independent full-suite gate remains failed despite the isolated successes. Handle its timing and cleanup evidence separately from this bounded repair; this review did not change those tests or prove their causes.
4. A build/release gate still owns reproducibility of the already committed 0.1.104 bundles. The reviewer did not build or amend the unreleased key-format pin.
