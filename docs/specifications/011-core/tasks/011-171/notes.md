# 011-171: a focused wait decides in one place, and one reader says when a focused run applies

Worker 9354f23b, wave 29 W3, from main 897e3e357, 2026-10-24. Shape: slice (subtraction). With slices 1, 3, 4, 5 and 11 of `quality/2026-10-24.md`, and slice 6 of row 011-172. No behaviour or printed text changes, and no test changed.

## 1. What changed

| Item | Where | What |
|---|---|---|
| (a) the outcome | `src/cli/status-wait-focus.ts` `focusOutcome` | One function takes the named outcome (`decidedOutcome`), the focus and the daemon's reply, and gives the wait's outcome or `null`. `settledFocus`, `focusAnswered` and the three-way chain in `waitForNamed` are gone. |
| (b) the usage error | `checkUsage` in `status-wait-focus.ts`; `printNamed` in `status-wait-paths.ts` | Both forms return `checkUsage`'s `{ usage }` from the store read and throw it as `CheckUsageError` after the read. `printNamed` now takes the read's promise and exits 2 on that error for both forms. `NamedFocus.usage` and the snapshot's separate path are gone. |
| (c) when a focused run applies | `readFocusedFiles` and `FocusedRead` in `src/core/status/focused.ts` | One reader gives each file's current key, its newest focused run, the results stored at its key, and `applies`. `readStatusFocused`, `whyFocusedOf` and the CLI's `focusOf` read it. The CLI's own `readFocusedFiles` is gone; `focusedFileOf` maps one read to the wait's `FocusedFile`. |
| (d) a run's count | `FocusTally` and `focusedTally` in `focused.ts` | `answerOf` (CLI) and `focusedOutcomeText` (status) both count a run's own texts with `focusedTally`. `projected` (B1) stays in the CLI and returns the narrower wait's view and count together. `storedTally` is gone: a stored result's count is `focusedTally({ checks, more: 0 })`. |
| slice 1 | `status-wait-focus.ts`, `status-wait-focus-answer.ts` | Import `holdsCheckText` from `src/runners/focus.ts`; `holdsText` is gone. |
| slice 3 | `focusedCheckOf` in `focused.ts` | One builder of `StatusFocusedCheck` for a focused check and a stored result; the `StoredCheck` alias is gone. |
| slice 4 | `ownNamedFiles` in `status-wait-paths.ts` | `ownPathFiles` folded in; `status-wait-promote.ts` holds the two requests only. |
| slice 5 | `status-wait-focus-lines.ts`, `noMatchText` | `checksText` and the collected count use `plural`. |
| slice 6 (011-172) | `testFileText` in `src/core/text.ts` | Replaces `pathText`, `refText`, `focusedFileText` and the inline copies in `phase-files.ts`, `slow-text.ts`, `outstanding-text.ts` and `unknown-files.ts`. |
| slice 11 | `focusedCheckLines`, `namedFailures`, `testCommandReason` | Each prints a location through `atText(location, undefined)`. With no frame the text is the same. 011-103 slice 5 is now only the frame argument. |

`status-wait-paths.ts` is 611 lines (was 619). `focused.ts` is 309 (was 257): the reader and the count moved in, as the row asks.

## 2. Decisions the row did not settle

1. **The usage error leaves the read as a throw, not as a new `NamedWait` variant.** A third variant (`outcome: "usage"`) was tried first. It breaks the types of tests that call `waitForNamed` and `readNamedSnapshot` directly and read `selection`, `files` or `down` after only an `unavailable` check (`handoff-wait`, `next-step-rows`, `next-step-seed`, `slow-wait-liveness`, `status-paths` and others). The done-when allows import changes only. So both reads return `checkUsage`'s object, both functions throw `CheckUsageError` after the read (the read itself turns a throw into an unreadable store), and `printNamed` is the one catch.
2. **`printNamed` takes the read's promise.** It had no caller other than the two commands. Folding the catch into it removed a function and kept `status-wait-paths.ts` under its old length.
3. **Status's total with a count is `pass + fail + skip`.** Before, status printed `checks.length + more` even when the row had `outcomes`; the CLI used `pass + fail + skip`. For every row the recorder writes they are equal: `outcomesOf` counts the uncut list (`focused-record.ts`), and `checks.length + more` is that list's length. Both now read `focusedTally`. A hand-made row with counts that do not add up would now print its count's total in status too.
4. **`whyFocusedOf` keeps its `key` parameter.** `why.ts` is outside this brief's files. `applies` comes from the reader; `keyMoved` still compares the run's key with the key `why` passes. Both keys come from the same `test_file_keys` rows in the same read. A later row may drop the parameter and use `FocusedRead.key`.
5. **The wait drops `FocusedFile.run` when a result is stored at the key.** Before, the wait kept the run beside `stored`. Every reader (`fileLines`, `foundText`, `fileEntry`) takes `stored` first, so nothing printed or in JSON changes.
6. **The wait no longer reads the hold when the focused answers decide.** `focusOutcome` gives `focused` before the hold read, so `holdOfWait` runs only while the outcome is open. The `hold` field was read only for `on-hold`.
7. **Slice 11 includes the two printers of 011-103 slice 5**, with no frame, because this brief owns their files and the text does not change.

## 3. Cost of the one reader

`readFocusedFiles` reads the results at each file's current key whether or not its run applies. Before, status read them only when the run's key was current, and `why` only when the run had selected the check. Status reads at most `FOCUSED_FILES` (20) files, and `why` one. Each read is one indexed `byKey` lookup with `usedAt` 0. With no focused row, status reads nothing more than before.

## 4. Checks

Each step ran the focused tests through Squeal: `test/cli/status-wait-focus*.test.ts`, `test/cli/status-paths-focus.test.ts`, `test/cli/status-check-args.test.ts`, `test/status/focused*.test.ts`, `test/status/why-focused.test.ts`, `test/cli/status-paths.test.ts`, `test/cli/status-wait-paths.test.ts`. All passed, unchanged. The full-suite checkpoint and its output are in the worker's final message. The only failures seen were the four plugin bundle drift tests, which the brief excepts (no `npm run build`).

## 5. For the next worker

- The seam for the focused wait is now: `checkUsage` → `focusOf` (`readFocusedFiles` → `focusedFileOf` → `answerOf`) → `focusOutcome`. Status's seam is `readStatusFocused` → `focusedOutcomeText`, both on `focusedTally`.
- The callback inside `waitForNamed` is still over the complexity limit of 20: `squeal code` gives CC 42 at the end of this row, over since before it. The selection read it shares with `readOnce` in `status-paths.ts` is the next candidate (`quality/2026-10-24.md`, "Checked, not filed").
