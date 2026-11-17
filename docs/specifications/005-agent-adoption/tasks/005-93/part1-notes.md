# 005-93 part 1 notes (wave 16 W1)

Worker session a1eb0936, 2026-11-17. Shape: finish. The own count carried from
`origin/wip/005-93` (190abb535) onto main (73b613a15), with no late state and no scheduler fact.
Main had not touched any file of the wip diff since the branch point (ee39fb9da), so every
carried hunk applied as it was; the late parts were then cut out.

## Hunks: carry or leave

Carried (then stripped of every late and caught-up part):

- `src/core/delivery/edits.ts`: `readOwn` and the owed rule (a file is owed while its re-key
  record entry is `open`, no result at its key); `EditNotes.own`; the settled computation
  removed. `readOwn` returns `null` until the latest revision is refined, as main did (the wip's
  `refined: false` form fed only the `unlisted` late form). `owed` is a count, not the wip's
  `OwedFile[]` (the `from` revision fed only the late bound). `editTold`, `tellEdits`, `lateOf`,
  `lateParts`, `Boundary` and the `failed` argument of `tell` left out.
- `src/core/delivery/delivery.ts`: only `editsSettled` → `ownEdits`. The wip's `once` lazy
  header, `boundary` option and `editTold`/`tellEdits` calls left out: they exist for late.
- `src/core/delivery/header.ts`: the own count in the news line, `ownCountText` (moved here from
  the wip's `late-format.ts`), no count for a consumer with no edit. The wip dropped the
  late-feed and unlisted sentences while files were owed; here they stay, as on main.
- `src/core/delivery/format.ts`: `settledLine` and `sawSettledLine` removed; `sawEditLine`'s
  "which affects" and its `done` form (`Squeal saw your edit; passing results stay silent.`).
  `lateLine`, `caughtUpLine` left out.
- `src/core/delivery/content-title.ts`: the settled title words removed; the late and caught-up
  words left out.
- `src/core/types/delivery.ts`: `OwnEdits` and `Delta.ownEdits` added; `EditsLate`, `CaughtUp`,
  `Delta.editsLate`, `Delta.caughtUp` left out. `EditsSettled` and `Delta.editsSettled` stay
  (additive type rule), marked not set since row 005-93.
- `evals/lib/squeal-text.mjs`: the `OWN` reader and the `headerCounts`/`clauseCounts` split;
  `CAUGHT_UNKNOWN` left out. `evals/lib/grade.mjs` needs no change: its title pattern already
  reads `your edit…` titles, and the settled title it no longer sees was one of those.
- The three `reports.md` copies: the own-count example only; the late and caught-up paragraph
  left out.
- `test/e2e/{agree.ts,run-triggers-control.test.ts,transitions.test.ts}`: as on the wip.
- Tests whose expected text is the news line, carried as on the wip (no late part in them):
  `test/harness/{codex/turns,late-heartbeat,liveness,not-validated,opencode/turn,stale-replacement,starting-daemon,turn}.test.ts`,
  `test/status/{feed-late,group-texts-golden}.test.ts`. They are outside the brief's list of
  owned files; they fail on the new news line without the change.

Left out entirely: `late.ts`, `late-format.ts`, `late-bound.ts`, `late-timings.ts`,
`src/core/scheduler/edit-timings.ts`, the call in `tier-start.ts`, the `edits-late:` and
`edit-timings:` rows in `src/core/types/store.ts`, and the tests `late.test.ts`,
`late-paths.test.ts`, `late-bound.test.ts`, `test/scheduler/edit-timings.test.ts`, with the late
and caught-up cases of `titles.test.ts`, `content-titles.test.ts` and `own-count.test.ts`. The
wip's `Date.now()` revision times in `edits.test.ts` and `edits-confirmation.test.ts` were only
there so no result read as late; main's times are kept. `pool-wait.ts` and `scheduler.ts` were
never part of the wip's own diff (main moved them).

## How `since` moves now

`since` is the edit state's revision the own count counts from (`edits:` meta slot). On the wip
it moved when a delivery showed every file run and no late state was open, at caught up, or when
a failure ended the late state. With no late state, only the first rule is left: `since` moves
to the latest revision when a delivered news header shows the own count with no file owed
(`own.owed === 0`), and the re-key record is pruned then. A delivery that says the first-edit
line also writes the state (`said`), with `since` unchanged while files are owed. A quiet
delivery writes nothing. Part 2 (row 005-97) adds the other two rules back with the late state.

## Texts, before (main) and after

| Where | Before | After |
| --- | --- | --- |
| News header, files owed | `Revision 12 (changed src/math.ts): 3 pending (3 tests), 2 unknown (2 tests).` | `Revision 12 (changed src/math.ts): 3 of the 5 test files your edits affect have not run.` |
| News header, all run | `Revision 12 (changed src/math.ts): no check pending, stale or unknown.` | `Revision 12 (changed src/math.ts): the 5 test files your edits affect have all run.` (1 file: `the 1 test file your edits affect has run.`) |
| News header, a file with no result | `… 1 unknown (1 test).` | `…: the 3 test files your edits affect have all run; 1 with no result (unknown).` |
| News header, no edit since the count began | `Revision 3: test files without checks: 2 pending.` | `Revision 3.` |
| Settled line (001-223) | `All 2 test files your edits since revision 4 re-keyed are current.` | removed |
| First edit with its files already run (joined form) | `Squeal saw your edit; all 2 test files it re-keyed are current, and passing results stay silent.` | `Squeal saw your edit; passing results stay silent.` |
| First edit, no test group at `edit` | `Squeal saw your edit, which re-keyed 2 test files; no test group runs …` | `Squeal saw your edit, which affects 2 test files; no test group runs …` |
| Title of a settled delivery | `SQUEAL · your edits' test files are current at revision 5` | none (the settled line is gone; titles follow the other lines) |

The late-feed and unlisted sentences, the liveness and install sentences, and the owed full
counts once after a listing (row 011-205) are unchanged after the new count.

## For the next worker (row 005-97)

- Start from this branch, not from the wip's `edits.ts`: `readOwn` here returns `null` while the
  latest revision is not refined and `owed` is a number. The late bound needs each owed file and
  its edit revision (`OwedFile.from` on the wip) and the `refined: false` read for `unlisted`.
- `newsLine` keeps the late-feed and unlisted sentences; the wip dropped them while files were
  owed, because the late message said them.
- The 005-94 wording pass may still change "re-keyed" in `SKILL.md` ("those files and non-zero
  counts only"); left as it is here.
- Bundles are not rebuilt here: the bundle drift tests (`test/harness/*/package.test.ts`) fail
  until the coordinator builds.
