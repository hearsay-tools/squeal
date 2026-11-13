# Row 011-330: one rule per report field in the report merge

Worker e645ac81, 2026-11-13, brief `tasks/wave-84.md` W1.

## Step 1: the table pins today's rules

`test/daemon/report-merge.test.ts` holds one table, typed over every `RunReport` field (`{ [K in keyof RunReport]-?: Case<K>[] }`), so a field without rows fails the typecheck in the test too. Each cell sets one field on one, two or three parts over an empty report and compares the whole merged report with `toStrictEqual`, so a key present or absent is part of the cell. The table calls `merge` from `composite-runner.ts`; it holds no copy of the rules.

`test/daemon/report-merge-whole.test.ts` holds three whole-report cases: no part; two parts that each failed to start (the first's setup failure, both failures named); three parts that set every field, with the merged keys in today's order (a report written as JSON keeps its bytes).

Both passed against today's `merge` before any refactor (Squeal, revision 8). The builders are in `test/daemon/report-merge-fixture.ts`, so each file stays under 300 lines.

### Merge cases the table replaced

From `test/daemon/composite-runner.test.ts`:

| Deleted case | Table rows that replace it |
| --- | --- |
| "keeps the other adapter's results when one adapter's run crashed" | `end`: "the worst of three, an earlier one"; `durationMs`: "summed over two"; `completedFiles`: "over three, one empty"; `results`: "over three, one empty"; `fileDurations`: "a later part's", "over three, one without"; `failure`: "only the failing part named" |
| "is timed-out when one part timed out and none crashed" | `end`: "a later part's worse end"; `failure`: "only the failing part named" |
| "carries a part's skipped files, and none when no part skipped one (task 007-23)" | `skippedFiles`: "a later part's", "absent when no part has them", "absent when every list is empty" |
| "carries a part's focused counts, a zero match included, and none when no part focused (row 011-145)" | `focused`: "a later part's, a zero match included", "absent when no part has them" |

Kept in the composite's test: "dispatches a run spanning both adapters by project and merges the reports" (dispatch by project and the members' order; it is the only case that shows `run` merges at all) and "turns an adapter whose run rejects into a crashed part of the run" (`Flights` turns a rejection into a crashed report; not a merge rule).

From `test/runner-host/remote/`: none deleted. The cases there test the lane's own paths. "keeps the local part's results and the remote part's setup failure when only the remote fails" (`lane-setup.test.ts`) asserts a merged report, but it is the only case of the lane's branch that merges after a local part that started; the table's `startupFailure` row "a later part's when the first started" covers the rule, not that branch.

### Unrelated failures seen during step 1

At revision 8 (test files only changed), Squeal reported `test/commit/boundary-daemon.test.ts` ("carries the commit line in the same delivery…") and `test/daemon/vacant-wait.test.ts` (timed out in 5000 ms, load average 78.70), both "no baseline result, may predate your edits". The changes at revision 8 were test files those tests do not import. Both passed at revision 15, with the rule record in place (FAIL -> PASS).

## Step 2: the rule record

`src/core/daemon/report-merge.ts` holds `MERGE_RULES`, typed `MergeRules = { readonly [K in keyof RunReport]-?: (parts: readonly Part[]) => RunReport[K] }`: one rule per field, and a rule answers `undefined` to leave an optional field absent. `Part` and `SEVERITY` moved there with the rules. `merge` stays defined and exported in `composite-runner.ts`: it applies each rule in the record's order and keeps the fields that are not `undefined`. `remote/lane.ts` is unchanged.

Presence is in the helper each list field uses:

| Helper | Present | Fields |
| --- | --- | --- |
| `listed` | always | `completedFiles`, `results`, `fileErrors` |
| `listedWhenAny` | when a part has the field, even empty | `fileDurations`, `observed`, `reads` |
| `listedWhenFound` | only when the joined list is not empty | `environmentObserved`, `skippedFiles`, `withheld`, `focused` |

The other rules are written out: `end` (the worst by `SEVERITY`), `durationMs` (the sum), `failure` (each failing part's, prefixed with its adapter's name, joined with `; `, else `null`), `startupFailure` (the first part's, task 001-382), `startedProjects` (each project once, sorted, absent when none).

### A scratch field fails the typecheck

In a private copy under `/tmp` (not committed; the daemon did not see it), `RunReport` got `readonly scratch?: readonly string[];` after `focused`. `node_modules/.bin/tsrs --fast --noEmit` exited 2:

```
src/core/daemon/report-merge.ts(51,14): error TS2741: Property 'scratch' is missing in type '{ end: (parts: readonly Part[]) => RunEnd; durationMs: (parts: readonly Part[]) => number; completedFiles: (parts: readonly Part[]) => readonly TestFileRef[]; results: (parts: readonly Part[]) => ...; ... 10 more ...; startedProjects: ...; }' but required in type 'MergeRules'.
test/daemon/report-merge.test.ts(35,7): error TS2741: Property 'scratch' is missing in type '{ end: ({ name: string; parts: ({} | { end: "timed-out"; })[]; merged: { end: "timed-out"; }; } | { name: string; parts: ({ end: "crashed"; } | { end: "timed-out"; } | {})[]; merged: { end: "crashed"; }; })[]; durationMs: { name: string; parts: ...; merged: ...; }[]; ... 12 more ...; startedProjects: ...; }' but required in type '{ readonly end: readonly Case<"end">[]; readonly durationMs: readonly Case<"durationMs">[]; readonly completedFiles: readonly Case<"completedFiles">[]; readonly results: readonly Case<"results">[]; ... 11 more ...; readonly scratch: ...; }'.
```

So a new field needs a rule and table rows before the typecheck passes.

### The table catches a wrong rule

In the same private copy, `node_modules/.bin/vitest run` of the two merge test files (59 tests):

- `fileDurations` on `listedWhenFound` and `startupFailure` as the last part's (`findLast`): 5 failed: `fileDurations: present when a part has them, even empty`; `startupFailure: the first of two parts that each failed to start (task 001-382)`; `startupFailure: the first among three`; and both whole-report cases with a setup failure.
- the `withheld` rule moved to the end of the record: 1 failed, "merges three parts that set every field, in today's key order".

## Decisions the brief did not settle

- **`merge` applies the record with one cast.** `Object.fromEntries` over the rules' answers, then `as unknown as RunReport`, with the reason beside it: `MergeRules` has a rule for every field, each answers its field's type, and `undefined` only for an optional field. Rejected: spreading each rule by name in `merge`; a forgotten optional field would then pass the typecheck.
- **The record's order is today's key order**, not `RunReport`'s declaration order (`withheld` and `focused` come before `startupFailure` and `startedProjects`), so a merged report written as JSON keeps its bytes. The whole-report case pins it.
- **The helpers take a getter** (`listed((report) => report.results)`), not the field's name. A getter that names another field of the same element type passes the typecheck, but the table fails it, because each row sets only its own field.
- **`Part` moved to `report-merge.ts`.** Only the new test fixture imported it from `composite-runner.ts`; re-exporting it from there would be a barrel (row 015-110).
- **No remote lane case deleted**; see step 1.
- **Three test files**, for the 300-line guideline: the table (`report-merge.test.ts`, 293 lines), the whole-report cases (`report-merge-whole.test.ts`) and their builders (`report-merge-fixture.ts`).

## Type changes

- New: `MergeRules` and `MERGE_RULES` in `src/core/daemon/report-merge.ts`.
- Moved, same shape: `Part`, from `src/core/daemon/composite-runner.ts` to `src/core/daemon/report-merge.ts`. `composite-runner.ts` no longer exports it.
- `RunReport` and `merge`'s signature are unchanged.

## For whoever continues

- A new `RunReport` field needs a rule in `MERGE_RULES` (at the place its key should take in the merged report) and rows in the table's `TABLE`; the typecheck names both.
- The remote lane's own second-setup-failure handling (`deferredTo` in `remote/lane.ts`) stays outside the rules; the `startupFailure` rule is the first part's.

## Checks

- `pnpm run lint`: "Checked 3370 files in 10s. No fixes applied."
- `pnpm run typecheck` (`tsrs --fast --noEmit`): exit 0.
- Squeal, `squeal status --wait 60000 <paths>` at revision 13 (both commits, no other change): pass for `test/daemon/report-merge.test.ts`, `test/daemon/report-merge-whole.test.ts`, `test/daemon/composite-runner.test.ts`, `test/daemon/composite-reconcile.test.ts`, every `test/runner-host/remote/*.test.ts` but one, `test/keys/key-format.test.ts` and `test/version-sensitive.test.ts`. `test/runner-host/remote/admission.test.ts` was unknown ("never run at its inputs, nothing queued it"; the baseline is lookup-only), and it reads `composite-runner.ts`. `squeal retry` on it answered "has a run asked at its inputs already, pending, so nothing more is queued", while `squeal status --wait` kept "never run, nothing queued it" and returned at once. With that result doubtful, `env -u PLUGIN_ROOT -u PLUGIN_DATA pnpm exec vitest run test/runner-host/remote/admission.test.ts`: 1 file, 7 tests passed.
- `src/core/daemon/composite-runner.ts` selects 469 test files that read it, most through the daemon. At the end of this session most were still queued, waiting for CPU on a busy host; no failure among them was known.
- No full suite, no `squeal run --all`, no `pnpm run build` (brief).
