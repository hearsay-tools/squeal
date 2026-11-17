# 005-114: the late line owns the delay sentence; one next step

Wave 26 W1. The human, 2026-11-17: when test files are not listed yet, or a delay is told, the
agent reads one next step, the path wait `squeal status --wait 60000 <path>...`. No hook
sentence says "run the tests yourself" while a daemon validates.

## The owner

`late.ts` exports `lateCarriesDelay(header, owed, late)`: the late line carries the delay
sentence while files are owed (as before, row 005-97) or in the message that says late, when
`lateMaySay(header)`. `newsLine` (`header.ts`) uses it in place of `owed > 0`, and reads
`told.editsLate` (an added key in its `Pick<Delta, ...>`; `headerParts`' `told` too). So the
unlisted late state (no own count, `ownEdits` undefined) and the unread state with no owed file
no longer say the header's delay sentence in the message that carries the late line. In later
messages of the same late state, with no owed file, the header says the delay again: once per
message, never twice in one.

Not changed: with an `unread` late line while the runner part is also pending, the header's
two-delay sentence (`behindText`) is left out and the late line names only the unread edits.
That was already so while files were owed (005-97); the path wait in the late line covers both,
since it waits for the read and the listing.

## Each "run … yourself" clause in `late-format.ts`, before and after

| Late kind | Before | After |
|---|---|---|
| `owed`, files named | ``To have it now, `squeal status --wait 60000 src/a.test.ts` runs it first; or run it yourself.`` | ``To have it now, `squeal status --wait 60000 src/a.test.ts` runs it first.`` |
| `owed`, more than 3 files | ``To have them now, `squeal status --wait 60000 <path>...` runs the files your paths select first; or run those files yourself.`` | ``To have them now, `squeal status --wait 60000 <path>...` runs the files your paths select first.`` |
| `unread` | ``Squeal has not read edits made after 14:03:20 UTC, so it has not queued their test files. To have results now, run the tests yourself; `squeal status` says when Squeal reads them again.`` | ``Squeal has not read edits made after 14:03:20 UTC, so it has not queued their test files. `squeal status --wait 60000 <path>...` asks it to read them and waits for the files your paths select.`` (the header's `readWaitText`, now exported from `status/feed-late.ts`) |
| `unlisted` | ``Vitest has not yet listed the test files of revision 1, so Squeal has not queued them. To have results now, run the tests yourself; `squeal status` says when they are listed.`` | ``Vitest has not yet listed the test files of revision 1, so Squeal has not queued them. `squeal status --wait 60000 <path>...` waits until they are listed, then for the files your paths select.`` (`listWaitText`, `status/feed-late.ts`; a path wait waits for the listing, `windowRefined` in `src/cli/status-wait-edit.ts`) |

`grep -rn "yourself" src/core/delivery` is empty.

## A state with no daemon validating and a late line

None. `lateNotes` (`late.ts`) says a new late line only while the daemon is `alive` and not
stopping, so no late line needs a hand-run sentence. The hand-run sentences that stay are in the
skill's `reports.md` and `commands.md` (no daemon validates, a stopped handover) and the
primer's `RUN_YOURSELF`; none is in hook text from `src/core/delivery`.

## Copies checked

`test/e2e/**`, `evals/lib/**` and the skill copies (`plugins/*/skills/squeal/references/*.md`)
hold none of the changed sentences. `reports.md` line 17 ("how to have them now") stays true.
The design's copies in `tasks/005-93/design.md` and `tasks/005-97/notes.md` are history.

## Tests

`test/delivery/late.test.ts`: the unlisted case asserts the header's "so new test files are not
counted" is absent and no "yourself"; a new unread case with no owed file asserts the header's
"Squeal has not yet read edits" is absent and one path wait. Both failed on the old `newsLine`.

## Repair, review 0.1.554 (the counts after the listing)

The review proved a double: a consumer registered before the listing is owed the counts (row
011-205). If its first boundary after the listing also carries the late line, `newsLine`'s
`countsOwed` branch said the header's delay sentence anyway, since it did not ask
`lateCarriesDelay`. With a late feed it also said the path wait twice. A second double of the
same kind: before the worktree's listing, the header's "still starting" sentence carries a path
wait, and an unlisted late line could add a second one.

Each branch of the news header that can say a delay sentence or the path wait:

| Branch | Says | Why it cannot double now |
|---|---|---|
| `unlistedLine` (test files of the worktree not listed) | `noResultsText`'s path wait, or a stopped, slow or absent daemon's sentence; never the delay sentence | `lateNotes` says no late line in this state: `quietFor` holds while `testFilesListed === false`, so `lateMaySay` is false too. With a down daemon no late line is said anyway. |
| `countsOwed` (first delivery after the listing) | `incompleteText`: the delay sentence, with its path wait when the feed is late | It now asks `lateCarriesDelay` as the own-count branch does. |
| Own count, or no count | `incompleteText` | Asks `lateCarriesDelay` (first commit). |
| `daemonText` in every branch | liveness and install sentences; no delay sentence, no path wait | A stopping or down daemon gets no late line (`lateNotes`). |

Before (registered before the listing, unlisted edit, 61 s, no late feed):

> Revision 1 (changed src/a.ts): 2 test files are current (run on the files as they are now). Vitest has not yet listed the test files of revision 1, so new test files are not counted.
> Vitest has not yet listed the test files of revision 1, so Squeal has not queued them. `squeal status --wait 60000 <path>...` waits until they are listed, then for the files your paths select.

After: the header line ends after "(run on the files as they are now)."; the late line is the
same. With a late feed, the header's "Squeal is behind: …" sentence and its path wait go; the
late line says the unread delay and the one path wait.

Known loss, as before this row while files were owed: with a late feed and the revision not
listed, the `unread` late line names only the unread edits, not the listing. Its path wait
covers both. Naming both would add a field to `EditsLate` (`src/core/types/delivery.ts`),
outside this row's files.

Tests: `test/delivery/late-one-delay.test.ts`, the three cases, each counting the delay sentence
and `status --wait 60000` in the whole message. All three fail on b45d6d0a7.
