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
6. Outcome: `decided` first (so a file current before any focused run is `settled`, the named verdict), then `focused` when `focusAnswered`, then hold and timeout.
7. `namedCode`: `focused` exits 1 when a selected check failed (`anyFailed`), else 3.

The text (`status-wait-focus-lines.ts`): `refusedLine` first; `focusLines` after the named failures and before the class lines; `focusedVerdictText` as `namedLine`'s `focused` case. `focusPayload` is `selection.focused` in `--json`.

Status (`src/core/status/focused.ts`): `readStatusFocused` in `snapshot`, `focusedLines` in `formatStatus` before `Affected checks`, `whyFocusedOf` in `why.ts` and `whyFocusedLines` below the known state in `format-why.ts`. `phaseLines` reads `s.focused` for the running mark.

## Decisions the spec did not settle

1. **The status line's place.** C6 says after the earlier-failures line; the failure list follows that line, so the focused lines go after the list, right before `Affected checks`. Newest first, at most three.
2. **A pass on the status line** reads `0 of 2 selected checks FAIL`, the drafted template with K = 0.
3. **The running mark** moves an in-flight focused file from `Queued:` to `Running:` in the text only. `pendingTestFiles`, `testFilesByPhase` and the breakdown stay the queue's.
4. **`why` when the entry no longer applies** with the same key: `the file's own run stored its result at this key since`. C6 names only `its key moved since`.
5. **A run in flight** gives `why` no line: it has no outcome for the check yet.
6. **Which run answers the wait.** One whose texts hold every text of this wait. An earlier run at the same key for other texts does not. The same texts at the same key answer at once, with no request sent.
7. **`crashed` and `timed-out`** end the wait with what the run recorded (a file-level fail exits 1). `discarded` and `cancelled` do not: the daemon queues them again.
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
