# 020-04 notes: the join repair

Worker 03f55796, 2026-11-10. Code: `src/core/code/crap/match.ts` (new: which V8 function is each counted function's) and `src/core/code/crap/join.ts` (coverage from the joined functions). Tests: `test/code/crap/join.test.ts` (the three shapes of `cases.mts`), `join-own-function.test.ts` (the cases that must stay unjoined or that the old join got wrong), `join-records.test.ts` with `test/fixtures/code/crap/join-records.json` (26 sources of this repository).

## The cause

Spec D4 says the cast shape fails because V8 sees the cast in the end column. That is not the cause. `src/core/code/coverage/map.ts` (`mapScript`, lines 41 to 45) maps a V8 function's last character through the source map, and a source-map lookup gives the start of the segment that holds the position. So a record's end column is the **start of the function's last token**. With the 2-column `END_SLACK`, every arrow whose last token is longer than 3 characters missed the join: `r => r.consumer`, `files.map(() => "(?, ?)")`, a template literal's tail, `(x as Box).field`. The cast is one case of it: `(x as Box).field` ends at `field` in the record.

The start moves too: an arrow's start maps to the segment before it, which is the name (`const pick = ` gives `pick`), the method (`xs.map(` gives `map`), or, for a nested arrow, the parent's last parameter. So a curried inner arrow's V8 function starts just inside its parent, and the old "nearest start" tie-break gave the parent the inner's V8 function.

## The rules (`match.ts`)

1. End join, as before: same end line, end column within 2, start on the same line or the one before; nearest end first. New tie-break after the end: a V8 function that does not start after the counted start wins, then the nearest start.
2. `foreign`: a V8 function is not the candidate's when it holds a counted function outside the candidate (as before: a class's field initializer), or when it starts before a counted function that holds the candidate and does not hold that function. The second part is new: it is the parent's own V8 function, cut short by a removed type (`zero = ... => Object.fromEntries(keys.map((k) => [k, 0])) as Seconds<K>` gave `zero.<map>` the V8 function of `zero`).
3. Start join, for functions the end left unjoined: the one V8 function left (by span; duplicates at one span with other hits count once) that starts on the function's line or the one before, not after its start, ends inside it, is not `foreign`, and does not end inside an unjoined function nested in it; only when no other unjoined function fits that span. Repeated until a round joins none, so an outer arrow cut short joins after its inner arrow (`refuse` in `test/watcher/parcel-racy.test.ts`).

Anything else stays unjoined, so `ranIn` reads it as before: not ran when its enclosing V8 function never ran, else by its own body lines, else `null`.

## The survey

The scripts here read this repository's code store (`<git-common-dir>/squeal/code.sqlite`, read only) and compare the join before the row with the worktree's. The join before the row is `join-old.ts`, made beside the scripts with:

```sh
git show 746c7ad93:src/core/code/crap/join.ts \
  | sed 's/^function matchEntries/export function matchEntries/; s#"../coverage/types.js"#"<worktree>/src/core/code/coverage/types.ts"#' \
  > join-old.ts
```

Run each with `node_modules/.bin/tsx <script> <args>` from a worktree. `extract.mts <store> <repo> <out>` writes each source blob's distinct V8 function lists; `extract-full.mts` the whole source entries (with line bitsets). `compare.mts`, `consistent.mts` and `gains.mts` read the first; `ran.mts`, `time.mts`, `fixture.mts` and `states.mts` the second.

Results on 2026-11-10 (store of 2026-11-09 23:37 UTC; 5,966 source blobs with their text in git, 37,948 distinct V8 function lists, 48,794 distinct source entries):

| Measure | Result |
|---|---|
| Function joins, old and new equal | 1,410,120 joined, 279,773 unjoined |
| Joins gained | 168,646 (by the last token between the record's end and the counted end: identifier or number 116k, string 15k, template tail or `as const` 34k, a removed type 60) |
| Joins moved | 980: every one a curried outer arrow that took its inner's V8 function, or a nested function that took its parent's |
| Joins lost | 10: `zero.<map>` and `parseCommitReport.pick.<map>` whose parent never ran; the result stays not ran (from the parent) |
| One V8 span joined to two functions across records of one blob | old 0, new 0 (24 functions join two spans across records, old 50) |
| `joinCoverage` `ran`, each record alone and all together, with and without `bound` | 4.19 M equal; unknown to ran 273,954; unknown to not ran 149,900; still unknown 860; not ran to ran 772 and ran to not ran 8, all corrections; no coverage change where `ran` is equal |
| Join time over all 48,794 entries | old 6.2 s, new 5.9 s |

The flips by function: `policy.ts` `orNull` and `oneOf`, `desk.ts` `guarded.safe` and `guarded.asked`, `policy-checks.ts` `object` and `must`, `work.ts` `orNull`, `step-down-lanes.test.ts` `fail` (curried outers that ran and read never ran), and `parcel-racy.test.ts` `refuse` and its inner arrow.

## How the join change reaches the daemon's users

The coordinator asked whether, after an upgrade, the unknown results that become known are delivered one per function (015 D6 allows one summary line for a policy or counter change). They are not:

1. No file is judged again because of the upgrade. `walk.ts` keeps a judged file's states while its signature is unchanged, and `signatureOf` (`cache.ts`) hashes the blob, the counter version, `crap.threshold` and each loader's key with its record's time. Nothing of the join is in it. Only a new `COVERAGE_RECORD_VERSION` reseeds every file (`step.ts`, `start`). So the new join reaches a file at its next judgement: an edit to it, or a new record of one of its loaders.
2. At that judgement, a state that leaves `unknown` records no transition: `kindOf` (`judge.ts`) gives none into or out of `pending` or `unknown`. `toldKind` (`delivery/code-delta.ts`) tells a FAIL only when the last transition is `first-seen-fail` or `pass-to-fail`, so a function that goes from `unknown` to `fail` is written to the consumer's view by count, silently.
3. Only a state that goes from `pass` to `fail` or back records a transition, one per function. `states.mts` judges every source at this tree's HEAD blob (2,687 files) from all of its stored records, with the old and the new join: in `src`, 1,561 `crap` and 1,473 `uncovered` states go from unknown to pass, 88 `uncovered` from unknown to fail, and none goes between pass and fail. In test files, 3 flip (`refuse`, its inner arrow, `step-down-lanes.test.ts` `fail`); the daemon does not count test files (015 D1), and this repository's `coverage.exclude` holds `test/**`.

So no fix is needed for a burst. The cost is lag: a file nobody edits keeps the old join's `unknown` states until one of its loaders runs again. A join version in `signatureOf`, read as a recount (quiet), would judge every file again at once; it is not in this row.

## For the next worker

- The fixture's expected values are the old join's. To rebuild it, run `fixture.mts` with `join-old.ts` and paste the corrections the test prints into `CORRECTIONS`, each read against its source.
- The daemon's `squeal code` uses this join: many one-line callbacks that read unknown now read a measure. Most have CC 1, so their CRAP is at most 2.
- `plugins/*/dist` is not rebuilt here (the row does not own it): the two bundle tests fail until the coordinator rebuilds.
