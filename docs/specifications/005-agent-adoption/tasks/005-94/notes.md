# 005-94: worker notes (wave 17)

Worker's file for row 005-94, 2026-11-17. The texts are `texts.md`, "Decided". This file says what was built, where it differs from `texts.md`, and what the next worker needs.

## Primer lengths, as built

Measured with the real `src/harness/shared/primer.ts` on `texts.md`'s coverages (a throwaway Vitest file beside `test/harness`, now deleted). The Codex CLI is the probe's (`~/.codex/plugins/cache/squeal/squeal/0.1.531/…`). Every primer is byte-equal to the draft `probe/primer-after.ts`.

| Coverage | `squeal` | Codex | Wait | Dropped (Codex) |
|---|---|---|---|---|
| default | 1100 | 1209 | path | none |
| cezar | 1435 | 1458 | path | none (slow sentences: 0 slow files) |
| slow-on | 1424 | 1415 | path | slow arrival (and retry) |
| eval fixture | 1473 | 1458 | path | none (slow arrival) |
| eval fixture, a8 | 1468 | 1453 | path | none (slow arrival) |
| no test group at edit | 1356 | 1471 | narrow run | none |

All are within `PRIMER_CAP_CHARS` (1,500).

## Decisions the texts did not settle

- **Owed counts (row 011-205).** The coordinator granted the title change in `content-title.ts` ("first results in this worktree") and the `grade.mjs` title pattern. The line has no `Known failures: N`: `Delta` carries no failure count on that path, and `delivery.ts` is not this row's. It reads `Revision 79: 468 of 584 test files are current (run on the files as they are now), and \`squeal status\` counts the rest.` (coordinator, 2026-11-17).
- **Verb agreement.** `1 of 2 test files is current`, `0 of 1 test file is current`, `0 of 5 test files are current`: singular when the count or the total is 1.
- **No test files listed while listed.** `Known failures: 0; the daemon listed no test files.` keeps status's words, with a period.
- **Unlisted with a failure.** `Known failures: 1 (1 test)` alone: the line above says Squeal has no results yet.
- **The unlisted line in the news form** loses "A daemon is starting; results are as of revision 0." too: one helper (`unlistedLine`) serves both forms, and the reason (no result exists) holds there.
- **No daemon while unlisted** reads `Squeal has no results in this worktree yet, and no daemon is running; \`squeal start\` starts one.` only for the plain down daemon; a stopped, resting, stopping or late daemon keeps its own sentence after "Squeal is still starting…".
- **Counts in progress.** `Complexity: counting…` and `Lint: linting…` leave the registration; lint's off, unreadable and failed lines stay. The registration's "coverage not measured" sentence rides on the complexity line, so it is not said while the count runs.
- **Primer order.** The path wait is tried at every drop level before the plain-wait folds, as the draft does; within a drop level, project lists fold before the next drop (`withPathWait`). A one-project node:test primer now says `node:test (1 project)` where its path wait is 5 characters over at full projects (`test/harness/primer-listing.test.ts`). Dropping text before folding projects is the alternative; not taken, to match the measured draft.
- **The fallback folds drop text too.** Where no drop lets the path wait fit (a 1,000-character CLI in `test/harness/primer-wait.test.ts`; 500 characters still fit), the plain-wait folds run at each drop level. The longer hand-run clause put two 500-character-CLI no-edit primers 12 characters over the cap without this.
- **"short" wait form.** With the path wait tried first at every drop level, the `short` form (`Wait only when you need a result, as before you finish: …`) and the CLI-named `plain` form are never chosen: a primer that fits either also fits the path wait after drops. They are left in `primer.ts`; a quality pass can remove them.
- **Skill step 5.** "while Squeal is still starting, use step 3's path wait instead": the skill test requires "next tool call" before every `status --wait` in a paragraph, so the step names step 3 instead of the command.
- **Skill budget.** The body went from 5,087 to 5,247 characters; the test's budget is now 5,300 (was 5,100).
- **Late feed.** "these counts cover" became "these results cover", as `texts.md` 4 shows.
- **Stop with a delta while unlisted.** `stop.ts` (not this row's) joins `formatDelta` and `knownFailuresLine` with a newline; `knownFailuresLine` now returns an empty string while unlisted with no failure, so that rare text ends with a newline.

## Seam map

- The registration's and Stop's form: `headerParts` in `src/core/delivery/header.ts` (`fullLine`, `currentFilesText`); `formatRegistration` in `format.ts` puts the `Known failures` line between the line and the tier lines; `statusText` and `knownFailuresLine` in `src/harness/shared/text.ts`. `HeaderForm` keeps the name `full` for the registration's form, since `stop.ts` passes it.
- `squeal status` never used `headerLines`; it prints its own lines (`format-status.ts`), so no status text changed except the late line.
- The late sentence: `src/core/status/feed-late.ts` (`delaysText` takes the command); `utcTimeText` in `src/core/text.ts`.
- Parsers that read hook text: `evals/lib/squeal-text.mjs` (`CURRENT_FILES`, the new no-daemon words), `evals/lib/grade.mjs` (`RESULT_TITLE`), `test/e2e/agree.ts`, and the control's `accepted` list (`test/e2e/control-wording.ts`).
