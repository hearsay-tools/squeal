# 005-97 worker notes (wave 18 W1)

Worker session 5a844516, 2026-11-17. Shape: finish. The late and caught-up messages carried from
`origin/wip/005-93` (190abb535, built on 0.1.529) onto main (8c439ee46), on main's own count
(0.1.534), the scheduler's record (0.1.535, row 005-96) and the 0.1.537 texts.

## Seam map

- `src/core/delivery/late.ts`: the late state (meta row `edits-late:`, one slot per consumer),
  `lateNotes` (late or caught up at a tool boundary), `endLate` (a delivered failure),
  `lateMaySay` (whether a late message may say the delays, read by `header.ts`).
- `src/core/delivery/late-format.ts`: `lateLine` (forms `owed`, `unread`, `unlisted`),
  `caughtUpLine`. The own count's words stay in `header.ts` (`ownCountText`, `notRunText`).
- `src/core/delivery/edits.ts`: `readOwn` (the one read of the consumer's own edits: files, owed
  files with their edit revision, unknown, `refined`), `editNotes`, `recordNotes` (what a delivery
  records), `editTold`, `tellEdits`.
- `src/core/delivery/delivery.ts`: `boundary` (a tool boundary that is not a Stop) is the only
  place late and caught up are computed; the live header is read lazily with `once`
  (`src/core/presence/once.ts`).
- Used as they are on main: `late-bound.ts`, `late-timings.ts`, `src/core/scheduler/edit-timings.ts`.

## The late state on every delivery path

`late` is the consumer's slot (`edits-late:`): the revision its open late message named, or
`{ ended }`, the latest revision when a delivered failure ended it. `since` is the edit state's
revision the own count counts from. "Moves" means `since` becomes the latest revision; it moves
only when a delivered header showed the own count with no file owed (`shown`, main's rule since
0.1.534) and no late state is open, or at caught up, or when a failure ends the late state.
Test files: `late.test.ts` (L), `late-paths.test.ts` (P), `late-cells.test.ts` (C), `edits.test.ts`
(E), all under `test/delivery/`.

| Path | Late / caught up | A delivered new failure | Other news while late is open | `since` |
| --- | --- | --- | --- | --- |
| Tool boundary, refined revision | late once past the bound (L "sends nothing while results come in normal time"); caught up once when nothing is owed (L "follows a late message") | ends late, no caught up (L "is not said when a failure arrived"); the files still owed then are not said late again, a later edit's are (C "not at a failure while files are owed") | caught up rides on it when nothing is owed (P "caught up is said with the daemon down") | moves at caught up (C "at caught up"), at a failure with every file run (C "at a failure that ends"), when shown with none owed and late closed (E "says once every one has run") |
| Tool boundary, unrefined revision | `unlisted` late after the bound and at least `FEED_LATE_MS` (L "says that the runner has not listed"); caught up never until refined (L "does not claim an edit whose revision is not refined") | ends late (P "at a boundary while the latest revision is not refined") | kept | unchanged: nothing is counted |
| Stop, quick and waiting at the latest revision | never (L "is never said at Stop"; C "a Stop that waits at the latest revision") | ends late (P "at Stop") | kept; the next boundary says caught up (P "a recovery at Stop") | unchanged: Stop's header does not show the count (E "a Stop's full header leaves the count") |
| Stop waiting at another revision (`atRevision`) | never | nothing delivered, nothing written (P "a Stop that waited for another revision") | — | unchanged |
| Turn end (`endTurn`) | never | — | late kept (P "the end of a turn") | unchanged |
| Peek | never | ends late (P "by peek") | kept (P "a recovery by peek keeps it") | moves only when shown, none owed and late closed (E peek tests; P "a recovery by peek keeps it" fails if it moves while late is open) |
| Idle waiter | never | ends late (P "from the idle waiter") | kept (P "a recovery from the idle waiter") | as peek (same test) |
| UserPromptSubmit (`startTurn`) | never | ends late (P "when the turn starts") | kept (P "a recovery by peek or the turn start") | as peek (same test) |
| Registration, leaving, expiry | never at registration; an edit before it is never late (C "a registration counts from its revision") | — | leaving forgets late (P "a session that leaves"); expiry too (C "an expired consumer") | set to the registration revision |
| Hold on validation | late never (C "says no late while a hold is on"); caught up allowed (same test) | ends late | kept | as the boundary |
| Daemon down, stopping, stopped | late never (L "is not said while the daemon is down"); caught up allowed beside the liveness line (P "caught up is said with the daemon down") | ends late | kept | as the boundary |
| No test group at `edit` | never, any form (P "says no unlisted late notice", "says no unread late notice"; C "says no late for owed files") | ends late | kept | as the boundary |
| Empty late state | no caught up without a late before it (L "is never said without a late message"); a late state whose revision affects no file closes silently (P "closes a late state with nothing to count") | — | — | unchanged |

The news header leaves out the late-feed and unlisted sentences while files are owed and a late
message may say them (`lateMaySay`: a live daemon, not stopping, no hold, a test group at
`edit`). Where none may, it keeps them (C "says no late for owed files, and the header keeps the
late-feed sentence"; L "says once that Squeal has not read edits" for the leave-out side). The hold
and daemon-down rows share `lateMaySay`; only the no-test-group row has a header test of its own.

## The bound with group lanes

Configured group lanes record no timings (`../011-core/reviews/0.1.535.md` N1). A file only a group
lane runs has a project with no recorded width, so `pastBound` reads width 1, and its revision has
no first start, so the start median comes from other revisions or is 0. Width 1 is the narrowest
estimate, and a start of 0 only shortens the bound by the start delay: the bound is never shorter
than twice the files' own durations run one after another. C "reads width 1 and no first start"
pins it: two 1 s files are not late at 3.5 s (two wide would make them late after 3 s) and are
late after 4 s. No recorder was added.

## What changed against the wip branch, and why

- `since` follows main's rule (0.1.534): it moves only when the delivered header `shown` the own
  count, and on the wip's late rule (late closed, at caught up, or at a failure). `tell` takes
  `{ shown, failed }`. A peek counts and can move it, so a peek with late open must not: tested.
- A failure that ends a late state writes `{ ended: latest revision }` in place of nothing. On the
  wip, the next boundary said "late" again for the same owed files right after the failure's
  report. Now only owed files whose edit is after `ended` can make a new late message; its line
  still counts every owed file.
- The news header keeps the late-feed and unlisted sentences where no late message may say them
  (a hold, no test group at `edit`, a daemon not alive or stopping). On the wip they were left out
  whenever files were owed, so with no test group at `edit` a late feed went unsaid.
- `readOwn` returns `refined: false` and `OwedFile[]` again (the wip's), which part 1 had cut.
- `editNotes` takes `{ countOnly, boundary }`; its record step is `recordNotes`. Complexity 17
  (wip: 23; the threshold is 20).
- Texts: the late line says "Passes stay silent unless they follow a failure;" (0.1.537).
  `utcTimeText` is main's (`src/core/text.ts`); `ownCountText` stays in `header.ts`, and
  `notRunText` is shared by the own count and the late line.
- The `unread` late line keeps the design's next step (run the tests yourself; `squeal status`
  says when Squeal reads them again), not 0.1.537's path wait that asks the daemon to read them.
  The brief says design section 4 "in those words". Since the header leaves its late-feed
  sentence to this line while files are owed, the agent then sees no path wait: a candidate for
  the coordinator.
- The late tests share `test/delivery/late-fixture.ts`. `edits.test.ts` and
  `edits-confirmation.test.ts` make revisions at `Date.now()`, so no result there reads as late.

## Texts as built

- Title, late: `SQUEAL · results for your edits are late at revision 42`.
- Late, owed: `7 of the 9 test files your edits affect have not run, 2 min 10 s after your edit at
  revision 41. Passes stay silent unless they follow a failure; Squeal says once when it has caught
  up. To have them now, \`squeal status --wait 60000 <path>...\` runs the files your paths select
  first; or run those files yourself.` With 3 files or fewer it names them: `To have it now,
  \`squeal status --wait 60000 src/a.test.ts\` runs it first; or run it yourself.`
- Late, unread: `Squeal has not read edits made after 14:03:20 UTC, so it has not queued their test
  files. To have results now, run the tests yourself; \`squeal status\` says when Squeal reads them
  again.`
- Late, unlisted: `Vitest has not yet listed the test files of revision 41, so Squeal has not
  queued them. To have results now, run the tests yourself; \`squeal status\` says when they are
  listed.`
- Title, caught up: `SQUEAL · caught up at revision 45`.
- Caught up: `All 9 test files your edits affect have run at revision 45, with no new failure.`;
  one file: `The 1 test file your edits affect has run at revision 45, with no new failure.`; with
  no result: `…have run at revision 45: 8 with results, 1 with no result (unknown); no new failure.`
- Skill `reports.md` (three copies): one paragraph after the news header's, quoting both titles;
  `test/delivery/titles.test.ts` pins them to the formatter.

## For the next worker or the coordinator

- Bundles are not rebuilt here: the bundle drift tests (`test/harness/*/package.test.ts`) fail
  until the coordinator builds.
- Every tool boundary now reads the own count (`readOwn`: the worktree's test-file keys and the
  re-key record) once the first-edit line was said, as the wip did; before, a boundary with no
  other news read only the edit state. Not measured.
