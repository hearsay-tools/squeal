# 011-109: a regression notice groups checks with one error and location, worker notes (2026-10-22)

Brief W2 of `../wave-13.md`. Base main at `a5901f2bf` (0.1.261). Sources: board row 011-109, `../../../002-codex-adapter/research/issue-71.md`, `docs/triage/2026-10-22-digest.md` group D, spec 011 C5. Commits `cf933d7ef` (format and its tests) and `4f2cfe6c3` (evals parser and its tests); this file in the next commit.

## What a group reads like

91 checks that failed with `ReferenceError: ResizeObserver is not defined` at one location, in 7 test files:

```
FAIL  91 checks with one error and location (91 tests)
      PASS -> FAIL, seen by Squeal's run at revision 12
      ReferenceError: ResizeObserver is not defined
      at src/components/chart.tsx:12:5
      36 tests in tests/components/f6.test.tsx
      10 tests in tests/components/f0.test.tsx
      9 tests in tests/components/f1.test.tsx
      ...
      Full list: squeal failures tests/components --limit 91
```

Before, the same delivery held one block per check, about 5 lines each, cut at the 10,000-character cap with `Not shown: N more changed checks`. Up to five checks are named one per line; above five, `collapse`'s `nameLines` lists them by test file when that takes fewer lines (the ten largest files, then `and N more test files (…)`). The delivery still ends with `Full output: squeal why "<first failure>"`.

## Seam map

- `src/core/delivery/failure-groups.ts` (new): `failureGroups(failures, revision)` partitions the delta's failures in their order; a group stands where its first failure was. `groupLines(group, revision, command, quote)` gives the block's head and lines as a `Collapsed`. Kept out of `format.ts`, which was over 400 lines.
- `src/core/delivery/format.ts`: `failureBlocks` replaces the per-failure `entryBlock` map in `formatDelta`. A group of one is `entryBlock` as before; a larger group is a `collapsedBlock` that counts each of its checks as `fail`, so the overflow line counts a hidden group by its checks.
- Every harness's notice, Stop's text and the deny reason are `formatDelta`'s text (`src/harness/shared/deliver.ts`, `prompt.ts`, `waiter.ts`, `stop.ts`, `deny.ts`, `src/harness/pi/run.ts`), so none of them changed. `deny.ts` and the deny-once contract are unchanged.
- `formatRegistration` is not grouped: a registration lists known failures, not changes, and the row names `formatDelta`.
- `evals/lib/squeal-text.mjs`: `checksOf` reads a `FAIL  N checks with one error and location` block through `groupChecks`. It skips the change line and the error by position, then the fact lines by their prefixes (`at `, the closure line, `load average `, `Flaky: `, `Retry asked `), and reads the lines up to `Full list:`. A name is a named check with the group's provenance (`provenanceOf`, the provenance code moved out of `checksOf` unchanged). A test-file line is `{ to: "fail", count, file, from, observed, validity }`. The `and N more test files` line is a count with no file. A count the lines leave out becomes one more count with no file.
- `currentCheck` now asks for a `file` where it asked for a `check`. Named checks always have a file; overflow and collapsed counts have neither, so their grading is unchanged. A group's counted test file is current as its checks are, so `failing` and `files` hold it, and a `fail` claim after a grouped notice reads as current evidence.
- `failingAfter`'s status branch (a text with `Known failures:`, Stop's included) no longer adds `undefined` to `named` for a counted entry. The total was the same before; the list was not.

## Decisions the spec did not settle

1. **Which failures group.** Those whose blocks would print the same change line (transition, run, origin, baseline, validity), the same error text (`summary`), the same location, flaky note and retry fact. The entry carries no fingerprint, so the key is the printed summary, which is stricter than the fingerprint: two checks whose first line matches but whose diff or `(N more errors)` differs stay apart, as do messages that differ only in what normalization removes. Splitting by change line keeps every fact the block prints true for every check in it, and the parser needs one validity per block. Adding `fingerprint` to `TransitionEntry` (`delta.ts`, `types/delivery.ts`) would group by the C5 fingerprint; neither file was this row's.
2. **From two checks.** Any two failures with one key form a group. Recoveries collapse only above five (`LISTED_MAX`); the row's "failures sharing one error and source location form one group" sets no lower bound, and "mixed errors give one block each" reads as one block per error.
3. **A failure with no error text** (`summary` null) is never grouped: such checks share no error.
4. **Lines that differ by test file.** The test-file frame (`called from …`) and the closure line are printed when every check of the group has the same one, else left out. `squeal failures` lists each check with its fingerprint (error and location); `why` prints its location with the frame, and its closure line. The load of a group of timeouts is printed as one value or as a range (`load average 3.20 to 24.36 when they ran`).
5. **The command.** `squeal failures` with the group's test files when there are at most three, else their deepest common directory, else no path (the whole worktree). `--limit <count>` is added when the group has more than 20 checks, the default. The limit is the group's count, so a newer failure in the same files can push one of the group's out of the list; the listing's `newest N of M` line then says so. A path the shell would expand is quoted with `shellWord`. `LISTED_BY_DEFAULT` copies `FAILURES_LIMIT` because importing `status/failures.js` would loop back into this layer through `why.ts`; a test pins the two equal.
6. **Wording.** Head `FAIL  N checks with one error and location (<parts>)`; the command line `Full list: <command> failures …`, after `Full output:` and `Full reason:`.

## Proposed C5 sentence (spec text is the coordinator's)

"Failures whose blocks state the same change, run, first error text, location, flaky note and retry are delivered as one block: their count, the lines they all share, their names (up to five) or their test files with counts, and one `squeal failures` command whose selection and limit list each of them; a failure with no error text is never grouped. Each check's evidence stays in `squeal failures` and `why` (row 011-109)."

## Tests

- `test/delivery/failure-groups.test.ts` (new): 91 checks give one block with their count; mixed errors give one block each, in order; up to five names; shared and differing lines; what splits a group; loads; the command's selection, quoting and limit; the cap with many groups.
- `test/delivery/failure-group-evidence.test.ts` (new): with 91 stored failures and 25 older ones elsewhere, the command from the real `formatDelta` text, run through `main`, lists exactly the 91; `why` on each gives its check and error; `LISTED_BY_DEFAULT` equals `FAILURES_LIMIT`.
- `test/evals/grouped-failures.test.ts` (new): `squealEvidence` reads the real block as plain text, in a hook's context and in a deny's reason (with `denialSentence`): counts per test file, named checks with provenance, a pending group, the files past ten, Stop's count. End to end on both harnesses, a grouped notice at the last edit's revision meets `current-before-claim` for a `fail` claim, and one seen at an older revision misses it.
- Changed: `test/delivery/collapse.test.ts` gives each regression its own error, since those tests are about recoveries; `test/cli/round-trip.test.ts` gives the file-level check its own error and reads the two tests' names from their group, so both a head and a group's name lines round-trip into `why`.

## For whoever continues

- The bundles (`plugins/*/dist`, the Pi and OpenCode packages) are not rebuilt here; their three drift checks fail until the coordinator's build.
- The deny-once change the digest holds stays held until a report shows the retry still costs after this row ships.
- Grouping by the C5 fingerprint, not the printed summary, needs `fingerprint` on `TransitionEntry` (decision 1).
