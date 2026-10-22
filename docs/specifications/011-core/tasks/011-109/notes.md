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
      Full list: squeal failures tests/components --error "ReferenceError: ResizeObserver is not defined" --per-check --limit all
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
5. **The command.** `squeal failures` with the group's test files when there are at most three, else their deepest common directory, else no path (the whole worktree). A path the shell would expand is quoted with `shellWord`. Replaced in the repair below: the `--limit <count>` this decision added let other failures take members' places (review 0.1.262 B1).
6. **Wording.** Head `FAIL  N checks with one error and location (<parts>)`; the command line `Full list: <command> failures …`, after `Full output:` and `Full reason:`.

## Proposed C5 sentence (spec text is the coordinator's)

"Failures whose blocks state the same change, run, first error text, location, flaky note and retry are delivered as one block: their count, the lines they all share, their names (up to five) or their test files with counts, and one `squeal failures` command whose selection and limit list each of them; a failure with no error text is never grouped. Each check's evidence stays in `squeal failures` and `why` (row 011-109)."

## Tests

- `test/delivery/failure-groups.test.ts` (new): 91 checks give one block with their count; mixed errors give one block each, in order; up to five names; shared and differing lines; what splits a group; loads; the command's selection, quoting and limit; the cap with many groups.
- `test/delivery/failure-group-evidence.test.ts` (new): with 91 stored failures and 25 older ones elsewhere, the command from the real `formatDelta` text, run through `main`, lists exactly the 91; `why` on each gives its check and error. Replaced in the repair below.
- `test/evals/grouped-failures.test.ts` (new): `squealEvidence` reads the real block as plain text, in a hook's context and in a deny's reason (with `denialSentence`): counts per test file, named checks with provenance, a pending group, the files past ten, Stop's count. End to end on both harnesses, a grouped notice at the last edit's revision meets `current-before-claim` for a `fail` claim, and one seen at an older revision misses it.
- Changed: `test/delivery/collapse.test.ts` gives each regression its own error, since those tests are about recoveries; `test/harness/uncovered-edit.test.ts` gives each of its 200 failures its own error, so they still fill the cap the uncovered-edit line counts against (found by the full checkpoint); `test/cli/round-trip.test.ts` gives the file-level check its own error and reads the two tests' names from their group, so both a head and a group's name lines round-trip into `why`.

## For whoever continues

- The bundles (`plugins/*/dist`, the Pi and OpenCode packages) are not rebuilt here; their three drift checks fail until the coordinator's build.
- The deny-once change the digest holds stays held until a report shows the retry still costs after this row ships.
- Grouping by the C5 fingerprint, not the printed summary, needs `fingerprint` on `TransitionEntry` (decision 1).

## Repair of review 0.1.262 B1 (brief W4 of `../wave-13.md`, 2026-10-22)

Base `8e28e960e` (cand/0.1.262 and the review). Commit `842ee2b81`; this section in the next commit.

**The defect.** The command selected the group's files or directory with the group's size as its limit. `squeal failures` lists every failing row the selection holds, newest first: other checks' newer failures in those files, and the older rows each edit stores for a check that keeps failing. These took members' places. The reviewer's probe listed 66 of 91.

**Why no path and limit can do it.** A limit equal to the group's size is too small whenever the selection holds anything else. Another check in those files can fail with the same error and not be in the delta: it failed that way before, so it is FAIL -> FAIL and not told again. With no limit, a path selection lists every stored row: 91 checks after 50 edits is 4,550 rows.

**The fix (the parent chose it, 2026-10-22).** Three additions to `squeal failures`, applied in the store query (`src/core/store/repos/failures.ts`):

- `--error <text>`, repeatable: the failures whose summary holds one of the texts, case kept, as `--check` matches a name. `instr` on `failure_texts.summary`, through `EXISTS`, so `results_by_failure` stays the outer loop (the plan test now covers both new selections).
- `--per-check`: each check once, at its newest failure among those the rest selects. A `NOT EXISTS` over a newer row of the same check under the same row conditions (`rowWhere`, the conditions on a row and not on its check). The count then counts checks; the header reads `(30 checks, newest failure of each, newest first)` or `(newest 20 of 30 checks, newest failure of each, newest first)`.
- `--limit all`: the whole selection. The count runs first in the same read, and `limit` in `--json` is that count.

The group's command is now `squeal failures <files or directory> --error "<first line of the summary>" --per-check --limit all`, with `--all-worktrees` when the group was inherited: its stored rows are another worktree's, which the default selection leaves out (this was a second hole beside B1). The error text is the summary's first line, at most 120 characters: a part of it selects every check the whole does, and a diff or `(N more errors)` on later lines stays out of the notice. The listing also holds any other check in those files whose failure holds that text; that is more than the group, never less. The notice cap and the one command are unchanged; `LISTED_BY_DEFAULT` and its test are gone, since the command no longer depends on the default.

`--json` gains `selection.errors` and `selection.perCheck` (additive). `FailureSelection` gains optional `errors` and `perCheck` (additive). `FailuresOptions.limit` widens to `number | "all"`.

**Tests.** `test/delivery/failure-group-evidence.test.ts` now stores, in the group's seven files, 25 newer failures with another error, two older rows of each member with the group's error and one with another, and an older failure of a check outside the group with the group's error. The command from the real `formatDelta`, run through `main`, lists each of the 91 once and that one more. `test/cli/failures-per-check.test.ts` (new) covers the three flags through the CLI, their header, `--json` and usage errors. `test/store/failure-repo.test.ts` covers both selections and their plans. `test/delivery/failure-groups.test.ts` covers the command's form: files, directory, root, an inherited group, and a long multi-line error with shell characters. The evals test reads the new line; the parser stops at `Full list:` and did not change.

**Docs.** `--help` and the skill's `commands.md` (new `## squeal failures` section, in `plugins/claude-code/skills/squeal/references/`) name the three flags. The Codex and Pi copies of `commands.md` are bundles; they follow at the coordinator's build.

**Proposed C6 sentence (spec text is the coordinator's).** After "`--check` selects the checks whose printed name holds the text.": "`--error` selects the failures whose summary holds the text; given several of `--check` or of `--error`, a failure matching any one matches. `--per-check` lists each selected check once, at its newest selected failure, and the total counts checks. `--limit all` lists every selected failure. `--json` adds `selection.errors` and `selection.perCheck`." And in C5, the group's sentence could end: "…and one `squeal failures` command that selects the group's first error line in its test files, each check once, without a limit, so that it lists each of them."

**Still open.**

- A setup check's failure is stored as a known state, not as a result (`sink.ts` `setupOutcome`), so `squeal failures` never lists one. A group of setup failures gets a command that lists nothing for them; that was so before this repair too.
- A member whose own row another worktree later overwrote under the same key would be left out without `--all-worktrees`. Results are keyed by check and key, not by worktree. No test reaches this.
