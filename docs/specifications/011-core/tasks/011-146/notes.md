# Row 011-146: focused checks in the CLI, status and `why` (worker notes)

Wave 27, brief W1. Spec 011 C4, C5, C6, C14 and C15 as amended 2026-10-23;
design `tasks/011-135/design.md` sections 1, 2 and 8 (R3). The daemon side
is row 011-145 (`tasks/011-145/notes.md`). These notes are the residue for
the reviewer and the next row.

## What landed

| Commit | What |
| --- | --- |
| `89580a9c9` | `StatusFocused` (status JSON, additive), the reader `src/core/status/focused.ts`, the `Focused (not counted)` line, `--json` `focused` with `applies` |
| `f122f6189` | the running-files mark `(focused: <texts>)` in `phase-files.ts` (coordinator request 0dcc4623) |
| `419e5879c` | `--check` on `status`, the `focus` request beside `promote`, the `focused` outcome, its text, exit status and `--json` `selection.focused`, the older daemon's line |
| `4fd3fb804` | tests: `--check` parsing, the printed prefix, `focusNamed` on a socket, a slow file |
| `388d3ef36` | `status <path>... --check` without `--wait` (`status-paths.ts`, coordinator request 0dcc4623) |
| `15e74ace9` | the `why` line and `--json` `focused`; `failures` and the hooks' header show nothing |
| `763b3522a` | the help text and every copy of the skill's `commands.md` |
| `e515dcb6a` | the wait resolves its own-path files only to promote or to focus |

## Seam map

The wait (`src/cli/status-wait-paths.ts`, `waitForNamed`):

1. `main.ts` takes `--check` with `takeChecks` (`status-wait-focus.ts`) and passes the texts as `NamedTextOptions.checks`. They reach `namedWaitCommand` through `statusWaitCommand`'s `named` argument, so `status-wait.ts` is unchanged.
2. At each decided read with texts, `ownNamedFiles` gives the files named by their own paths. None: `CheckUsageError`, thrown outside the store's read (a throw inside `withStatusStore` reads as an unreadable store), exit 2.
3. `wholeFileReasons` (once): a slow file, or a node:test project, gets no focus, as the daemon decides (`mayFocus`, row 011-145).
4. `focusOf` reads, for each own file, `readFocusedFiles`: the meta row through `readFocused`, the file's current key, and `store.results.byKey(key, 0)`. A run answers when its key is the file's current key, its texts hold every text of this wait, and it ended other than `discarded` or `cancelled`. A result stored at the key answers too, and wins over a run (C5: the entry no longer applies).
5. At the promotion read, `focusNamed` (`status-wait-promote.ts`) is sent once, for the own files that are not whole, with the texts after `focusTexts` (the printed prefix stripped). Its answer sets `reply`: `accepted`, `refused` (unknown request or `this daemon cannot focus`) or `none`. `refused` turns the wait into a named wait with the fallback line.
6. Outcome: `decided` first, where the named wait's `settled` goes through `settledFocus` (B6: the named verdict only for a file current at its key before any focused run), then `focused` when `focusAnswered`, then hold and timeout.
7. `namedCode`: `focused` exits 1 when a selected check failed (`anyFailed`), else 3.

The text (`status-wait-focus-lines.ts`): `refusedLine` first; `focusLines` after the named failures and before the class lines; `focusedVerdictText` as `namedLine`'s `focused` case. `focusPayload` is `selection.focused` in `--json`.

Status (`src/core/status/focused.ts`): `readStatusFocused` in `snapshot`, `focusedLines` in `formatStatus` before `Affected checks`, `whyFocusedOf` in `why.ts` and `whyFocusedLines` below the known state in `format-why.ts`. `phaseLines` reads `s.focused` for the running mark.

## Decisions the spec did not settle

1. **The status line's place.** C6 says after the earlier-failures line; the failure list follows that line, so the focused lines go after the list, right before `Affected checks`. Newest first, at most three.
2. **A pass on the status line** reads `0 of 2 selected checks FAIL`, the drafted template with K = 0.
3. **The running mark** moves an in-flight focused file from `Queued:` to `Running:` in the text only, by its phase read before the 100-name cap (B5, decision 16). `pendingTestFiles`, `testFilesByPhase` and the breakdown stay the queue's.
4. **`why` when the entry no longer applies** with the same key: `the file's own run stored its result at this key since`. C6 names only `its key moved since`.
5. **A run in flight** gives `why` no line: it has no outcome for the check yet.
6. **Which run answers the wait.** One whose texts hold every text of this wait, with only the checks that hold one of them (B1, decision 14). An earlier run at the same key for other texts does not. The same texts at the same key answer at once, with no request sent.
7. **`crashed` and `timed-out`** end the wait with what the run recorded (a file-level fail exits 1); the last line says `no outcome: the focused run ended <end>` (B2). `discarded` and `cancelled` do not: the daemon queues them again.
8. **Several own files** each need an answer; the wait waits for all of them. Files the daemon runs whole are left out of that and named with their reason.
9. **The prefix rule** strips the printed prefix of any own file from each text, since the request carries one list for every file.
10. **No daemon answer** (`none`): the wait still returns at a focused run or a stored result; with neither it waits for the file as a named wait does.
11. **Seconds** are printed with one decimal (`7.8 s`), as the design's text, not `durationText`.
12. **The usage error without `--wait`** is a `usage` field on `NamedFocus`, since that read cannot throw.
13. **`SKILL.md`** is at its 5,000-character budget (`test/harness/skill.test.ts`), so step 3 is unchanged; `commands.md` carries the text in all three copies.

## Type changes (all additive)

- `StatusSnapshot.focused?`, `StatusFocused`, `StatusFocusedCheck` (`types/status.ts`).
- `WhyReport.focused?`, `WhyFocused` (`types/status.ts`).
- `NamedWaitOutcome` gains `"focused"`; `NamedWait.focus?`; `NamedWaitPayload.focused?`; `NamedWaitOptions.checks?` and `focus?`; `NamedTextOptions.checks?`; `NamedSnapshotOptions.checks?`.
- New: `FocusReply`, `FocusNamed`, `focusNamed` (`status-wait-promote.ts`); `NamedFocus`, `FocusedFile`, `CheckUsageError` and the helpers (`status-wait-focus.ts`); `FocusedPayload`, `FocusedFileEntry` (`status-wait-focus-lines.ts`).

## Tests

| File | Covers |
| --- | --- |
| `test/status/focused.test.ts` | the status line while an entry applies, its place, `--full`, none after a key move or a stored result, the match-nothing line, at most three; the running mark with counts unchanged |
| `test/status/why-focused.test.ts` | the `why` line and `--json`; key moved; own result stored; an unselected check; `failures` and the hooks' header |
| `test/cli/status-wait-focus.test.ts` | the focused fail (exit 1, drafted text, sent once beside promote), pass (3), match nothing, a current file, a stored result at the key, the older daemon, a discarded run, `--json`, an earlier run for other texts, the usage error, the prefix |
| `test/cli/status-check-args.test.ts` | `takeChecks`, the usage errors through `main`, `focusTexts`, `focusNamed` on a socket, a slow file |
| `test/cli/status-paths-focus.test.ts` | the snapshot form, its `--json`, its usage error |
| `test/harness/skill-focused.test.ts` | every copy of `commands.md` and the help |

## For the next worker or the reviewer

- Bundles are not rebuilt (`npm run build` is not this row's). `test/harness/pi/package.test.ts` and the other bundle tests fail on drift until the integration build.
- Not measured with a real daemon: the wait against row 011-145's scheduler end to end. The CLI tests write the meta row as the daemon does (`focused-row.ts`'s `writeFocused`).
- The `Focused` lines name a file by its path from the worktree root in status, and from the cwd (`fromBase`) in the wait, as the existing lines do.

## Repair round: review 0.1.286 (FAIL, B1 to B6)

One commit per blocker, each with a regression that failed before it.

| Commit | Blocker | Regression |
| --- | --- | --- |
| `fdef37260` | B4: `--check` with source paths only exits 2 once the daemon listed the revision, whether or not a test file reads the source; nothing promoted or sent | `test/cli/status-wait-focus-usage.test.ts` (both forms, with and without a consumer; a path before the listing is not judged) |
| `386abd519` | B3: `why` resolves a check a focused run recorded, by exact name and by a unique part, with no known state, history or duration | `test/status/why-focused.test.ts` (first seen, key moved, ambiguity kept, a run in flight names nothing) |
| `cbdf1ef74` | B5: the running mark for a focused file past the first 100 queued names, out of the omitted count | `test/status/focused.test.ts` (101 queued files; a file nothing queues) |
| `1a44bebaf` | B6: with `--check`, `settled` is the early verdict only when each focusable own file has a result at its key; an unknown or stale file that nothing queues gets its focus request and waits | `test/cli/status-wait-focus-unqueued.test.ts` (unknown, stale, the refusal, a real scheduler after a lookup-only start) |
| `0e696d84d` | B1: a run for more texts answers with only the checks that hold one of the wait's texts | `test/cli/status-wait-focus-shared.test.ts` (two waits, opposite outcomes; a narrower text that held nothing; a capped superset; the snapshot) |
| `fb7ab75e2` | B2: the writer keeps fails first and counts every outcome (request 732c0c52); one count per file gives the exit, lines and JSON | `test/scheduler/focused-outcomes.test.ts` (51 checks, the fail last), `test/cli/status-wait-focus-capped.test.ts`, `test/status/focused-capped.test.ts` (rows with and without the count, more than 50 fails, a capped superset, crashed and timed-out) |

### Seam map, repaired

- `src/cli/status-wait-focus-answer.ts` (new) is the one place a run answers a wait: `answerOf` projects a run for more texts (B1) and gives its `FocusTally` (`failed`, `total`, `atLeast`) or a `fallback` reason (B2). `readFocusedFiles` stores the tally on `FocusedFile.tally`, from the stored result first (C5). `answered`, `anyFailed`, `settledFocus`, `fileLines`, `focusedVerdictText` and `--json`'s `count` all read that tally.
- `settledFocus` (`status-wait-focus.ts`) replaces the named wait's `settled` in the focused path (B6): `settled` when each focusable own file has a result at its key, or the daemon refused or gave no answer; `focused` once each has its answer; else `null`, so the first such read sends promote and focus.
- `pendingPhasesOf` (`phase-files.ts`) gives every pending file's phase before the 100-name cap; the snapshot passes it to `readStatusFocused`, which sets `StatusFocused.phase` (B5).
- `focusedCheckIds` (`core/status/focused.ts`) feeds `why`'s `known` and `resolve` (B3).

### Decisions this round

14. **A projected run keeps its own texts** in `selection.focused.testFiles[].texts`; the top-level `texts` are the wait's, and the no-match line names the wait's.
15. **A fallback is a whole-file reason** (`FocusedFile.whole`): no request is sent for it, and the wait reads as a named wait. A result stored at the key wins over it.
16. **A file nothing queues** with a focused run in flight is named in the `Running:` text too, and its status line says `its own run is not queued`. No count changes.
17. **B6 also promotes.** `promote` ranks only queued entries, so it queues no whole-file run; the baseline policy is unchanged.
18. **The writer counts every run it ends**, zeros for a run with no checks; the row written at a run's start has no count.
19. **Known limit.** When the daemon merges this wait's texts into a waiting entry and that run cuts its list with no kept fail of this wait's, the wait has no answer and sends nothing more; it ends at its deadline (`no focused outcome yet`). It needs more than 50 selected checks in a merged run.

### Type changes this round

All additive on payloads and the meta row: `FocusedRun.outcomes?` and `FocusedOutcomes` (`focused-row.ts`); `StatusFocused.outcomes?` and `StatusFocused.phase?` (`types/status.ts`); `FocusedFileEntry.count` (`--json` `selection.focused.testFiles[]`). Internal: `FocusTally`, `FocusAnswer`, `answerOf`, `storedTally`, `sumTallies`, `holdsText` and `answeredRun` (moved) in `status-wait-focus-answer.ts`; `FocusedFile.tally?`; `settledFocus`; `focusedCheckIds`; `pendingPhasesOf`. Changed signatures, CLI-internal: `pendingTestFilesOf(phases)`, `readStatusFocused(store, worktreeId, phases)`, `snapshotFocus(store, worktreeId, root, ready, own, checks)`. Removed: `selectedChecks`.

### Proposed spec text (the coordinator edits the spec)

C5, after the focused row's bound: "An entry keeps at most 50 selected checks, the failing ones first, and counts every selected check's outcome (`outcomes`: pass, fail, skip) before that cut. An entry written before the count has none."

C6, replacing the status-line sentence and the running-files sentence: "`Focused (not counted): <file> at revision N: K of M selected checks FAIL (<names>); its own run is <queued|running|not queued>.` K and M come from the entry's count. An entry without the count whose list left checks out reads `K of the N kept of M selected checks FAIL (<names>); R more not kept`. A focused run in flight is named in the running-files list with `(focused: <texts>)`, wherever the queue lists its file and when nothing queues it; its file's checks are not counted as running." And after the `why` sentence: "`why` finds a check by a name a focused run recorded, though it has no other record, and creates none."

C15, replacing the sentences from "A source path selects no focus" to "exits as today": "A source path selects no focus. Once the daemon listed the revision, `--check` with no test file named by its own path is a usage error (exit 2), whatever the paths select. [The CLI sends `focus` ... unchanged.] A focused run for more texts than the wait's answers it with only its checks that hold one of the wait's texts, and its file-level failure; one that left selected checks out of its list answers only with a kept failure of the wait's, else the wait sends its own request. The wait's outcome is `focused` once each such file has a focused outcome at its current key or a result stored at that key. A completed run that selected no check reads `No check of <file> holds "<text>" at revision N (the run collected M checks)`; a run that ended crashed or timed out reads `no outcome: the focused run ended <end>`. Counts come from the entry's count of every selected check. An entry without the count whose list left checks out proves no pass: with a kept failure the wait exits 1 and reads `at least K of M selected checks failed`; with none the file has no focused answer, the wait prints `Focused: <file>: its focused run kept N of M selected checks, none failing, and counted none of the rest; waiting for the file's run` and reads as a named wait. It exits 1 when a selected check failed, else 3. A file current at its key before any focused run gives the named wait's verdict, with the selected checks named from its result, and exits as today; an unknown or stale file that nothing queues is not current, so the wait sends its request and waits for its focused outcome. `--json` adds `count` (`failed`, `total`, `atLeast`) to each file of `selection.focused`."

Exit codes: unchanged (1 when a selected check failed, else 3; usage 2). One behavior change: a cut list with no count and no kept failure is no longer a `focused` outcome; the wait gives the named wait's verdict instead.
