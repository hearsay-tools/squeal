# 017-09: notes for the next rows

Worker d7a6463f, 2026-10-26. Lint presentation logic for D8 and D9, read from `lint.sqlite`. Wave 2 brief: `tasks/wave-2.md`. The sibling row 017-10 wires this API into the CLI, status, registration, agent delivery and Stop. No CLI, delivery, status, harness, provider or key file changed.

## Seam map

| File | What it holds |
| --- | --- |
| `src/core/types/lint-delivery.ts` | The payload types: `LintNews`, `LintNewsEntry`, `LintSummary`, `LintRegistration`, `LintStatus`, `LintDetails`, `LintFileDetail`, `LintChanged`, `LintChangedEntry`, `LintStopEvidence`, `LintReasons`, `LintProgress`, `LINT_LISTED_MAX` (5). |
| `src/core/lint/surface/source.ts` | `lintStoreSource(commonDir, root)`, `withLint`, `LintRead<T>`, `openForReading`. Readers never create the store. With `lint.enabled` off, nothing is opened. |
| `src/core/lint/surface/told.ts` | A consumer's told mark in lint `meta`, key `lint-told:<worktree>:<session>:<agent>`. |
| `src/core/lint/surface/news.ts` | `planLintNews`: the view against the states. Pure. |
| `src/core/lint/surface/deliver.ts` | `registerLint`, `readLintNews`, `acknowledgeLint`, `tellLint`, `dropLint`. |
| `src/core/lint/surface/snapshot.ts` | Counts, progress (`linting, N of M`), D9 reasons, the findings of a judged state. |
| `src/core/lint/surface/report.ts` | `lintStatus`, `lintDetails`, `lintChanged`, `lintStop`, `wentToFail`. |
| `src/core/lint/surface/format.ts` | The only lint formatter. `LINT_STALE`, and the text lines: `lintLines`, `lintEntryLine`, `lintSummaryLine`, `lintFailedLine`, `lintOffLine`, `lintRegistrationLine`, `lintStatusLines`, `lintChanges`, `lintTitleWords`. |
| `src/core/lint/surface/index.ts` | Re-exports the above. |

## Store and pass extensions (own commits)

1. `32016a5fa`: `LintTransitionRepo` gains `after(worktreeId, id)`, `latest(worktreeId)` and `lastId(worktreeId)`. The new type `LintTransitionRecord` is a `LintTransition` with its row `id`.
2. `cff898098`: the pass writes `lint-keying:<worktree>` = `{ seq, mode: "first" | "config", revision, at }` in the keying's own transaction (`rekey.ts`). `readKeying` and `writeKeying` are in `pass/records.ts`.
3. `7d6e04833`: the keying record also holds `transition`, the last transition id when the keying committed. The pass counts each failed keying under `lint-failures:<worktree>` (`failKeying`) and each time lint goes off for a new reason under `lint-offs:<worktree>` (`writeOff` in `run.ts`). Helpers: `failuresKey`, `offsKey`, `readCount`, `countOne`, `writeOff`.

Both are additive. The schema stays v1. No key part changed: `LINT_KEY`, `PROVIDER_VERSION` and `KEY_FORMAT_VERSION` are as they were.

## Decisions the spec did not settle

1. **The told mark is a transition id, not a clock.** The pass reads `now()` before it writes its transaction. With a clock mark, a hook could read its clock, then the pass could commit a transition stamped earlier, and the next delivery would treat it as old. Writers take the store's lock in turn and no transition row is deleted, so ids grow in commit order. `test/lint/surface/race.test.ts` runs the pass clock from 1,000 and the deliveries from 5,000, so every missed change looks older than the delivery that missed it.
   - **For a later prune row:** never delete the newest transition row of a worktree. An id that is used again would hide news.
2. **News is "what the consumer was told" against "the state now".** It is told only when both of these are true:
   - the file's last transition is in the consumer's own revisions (`isOwn`, 015's bound);
   - the consumer's own transitions since its mark add or remove at least one finding.
   The kind comes from the view and the state now. The evidence is the net of the own transitions, counted by rule and message. A change from a config keying is never named as an edit's evidence. Example: an edit adds `no-undef`, and a second edit before the delivery replaces it with `no-console`. The consumer hears one `pass-to-fail +no-console`.
3. **Deferred files.** A file that is `pending`, `unknown` or a stale `pass` when read is told nothing. Its own changes stay owed in the mark (`deferred`, with the id they count after). So a fix followed by an unknown lint is told as PASS once the file is judged again. This is true even when that lint records no transition.
4. **A stale FAIL is told,** with `stale: true`. Its line says `LINT_STALE`: "an input changed since it was linted; linting resumes when the agent is idle". `squeal lint` shows the same text. A stale PASS never is. Status and registration count `failing` as current failures only. `stale` is counted apart, so no file is counted twice.
5. **Summary.** A `first` or `config` keying newer than the consumer's mark gives one summary, once no quiet file is `pending`. The view is then seeded again by count. Quiet files that read `unknown` do not hold the summary back. A consumer that registers while a keying's files lint gets the summary when they end. So does one that registered before the store existed. A consumer that registers after the end gets no summary.
6. **The first pass's end is a summary too** (`reason: "first"`), as 015's first count is. The wording is `Lint: N files with findings; squeal lint lists them.`
7. **D9 `failed` is told once per failed pass while the error lasts. `off` is told once each time lint goes off.**
   - The pass records the identity at the failure source: it counts one more under `lint-failures` in the keying's failure, and one more under `lint-offs` when it writes a new off reason.
   - The told mark keeps both counts (`failures`, `offs`). A delivery tells `failed` when the count grew past the mark and a keying still fails, and `off` the same way.
   - So two failed passes with the same wording give two lines. A clock or the reason text is never the identity.
   - They are not repeated at each tool boundary between passes. Registration and status always show them.
8. **Stop evidence (`lintStop`):**
   - It is `null` unless `lint.blocking` is `true`.
   - It counts a file only when all of these are true:
     - the file fails at its current key;
     - its last transition leaves it failing (`first-seen-fail`, `pass-to-fail` or `fail-changed`);
     - its latest transition into `fail` (`first-seen-fail` or `pass-to-fail`) has an id above the last keying's `transition`;
     - that transition is in the consumer's own revisions.
   - Why the keying cut: a first or config keying records no transition per file. Example: a file fails in the session, passes, then fails after a config change. Without the cut, the old own `pass-to-fail` would count. With it, nothing counts.
   - The cut is conservative: an own failure from before any config change also stops counting. Lint then blocks less, never more.
   - A `fail-changed` on a file that failed at registration is not counted.
   - A stale, pending or unknown file is not counted. They are counted in `notCurrent`.
   - With no registration (`since` null), nothing counts.
9. **`--changed`** lists each file whose last transition is the session's own. The newest revision is first, and files in one revision are by path. Each entry has its last transition and its state now. Every change a delivery listed or counted in `more` is there.
10. **Findings not stored.** When the result a state was judged on is gone, the findings read `null`, and the line says "findings not stored". It never says "0 findings" for a failing file. No prune exists yet, so this path does not run today.
11. **Two-step delivery.** `readLintNews` is read only and returns an `ack`. `acknowledgeLint(ack)` writes the view and mark that the read saw. `tellLint` does both, as `tellCode` does: a read-only probe, then one write transaction that reads again.
   - **The ack is compare-and-set.** `ack.prior` is the mark the read started from. `apply` writes the views and the mark in one transaction, and only while the stored mark equals `prior`. Otherwise it writes nothing.
   - Newest then oldest: the older ack writes nothing, so the newer views and mark stay.
   - Oldest then newest: the older ack is written, and the newer ack then writes nothing. Its change is still owed, and the next delivery tells it once.
   - A change after the read is past the mark the ack writes, so it stays news.
   - `race.test.ts` covers the three cases, with a later transition of the same fingerprint.
12. **`dropLint` drops the views and marks of consumers that left.** It does not clear the views of departed consumers in other worktrees, as `dropCode`'s `retain` does, because `LintViewRepo` has no `retain`. An ended session's views stay, as 015's do.
13. **015-38's rule for git-brought recoveries is not ported.** The lint pass records no pull marks. A recovery that a pull brings inside the consumer's revisions is told.
14. **Paths in `squeal lint`.** `lintDetails` and `lintChanged` take files or folders. A folder holds the paths below it at a `/` boundary: `src` holds `src/a.ts`, not `srcx/a.ts`. `.`, `./` and the empty path hold every file. A path that holds no file with a state is in `notLinted` once a keying has run (a cursor exists), else in `waiting`. A missing store puts every asked path in `waiting`. So no path reads as "not linted" before lint started.
15. **Bytes.** `LintFileDetail.blob` and `LintChangedEntry.blob` are the blob the state was judged at (`state.judged.blob`), `null` before the first judgement. The CLI compares them with the bytes on disk, so a saved edit is not shown with the old result as current.
16. **Wording.**
    - A finding with no rule, as a parse error, is named by its message's first line (`+1 Parsing error: x`), not `fatal`. Its message is not repeated in parentheses.
    - While the first lint runs and no file has a finding yet, status says only `Lint: linting, N of M files.`. It never says `0 files with findings` then.

## For 017-10

- Call `registerLint(source, consumer, at)` in the registration transaction, beside `registerCode`.
- Call `tellLint(source, consumer, at, () => codeSeenUpTo(store, consumer))` beside `tellCode`. Format its result with `lintLines(news, command)` after the code lines. The lines never change `codeChanges`, `codeLines` or code overflow.
- For status: `lintStatus(source, worktreeId, codeSince(store, worktreeId, shell))` and `lintStatusLines`. The JSON is `LintStatus`. It holds the spec's `files, failing, sinceRegistration, pending, stale, unknown, off?` plus `since`, `reasons`, `linting?`, `failed?` and `unreadable?`.
- For `squeal lint`: `lintDetails` and `lintChanged`. Both read the store with no daemon. A missing store reads as `linting: { done: 0, total: 0 }` ("linting has not started"). Both take folder paths (decision 14). Compare `blob` with the bytes on disk before you show a result as current (decision 15).
- `surface/format.ts` is the only lint formatter. Its lines are the text the CLI and deliveries show.
- For Stop: `lintStop(source, worktreeId, codeSeenUpTo(store, consumer))`. Lint never denies a tool call. Lint never counts in `Known failures`: no surface function touches the main store.
- Each function returns `undefined` or `null` while `lint.enabled` is off, and opens nothing. A store that fails mid-read loses only the lint part. Nothing throws to the caller.

## Checks run (2026-10-26)

After the follow-up commits (`16f332fc5`, `8ba5bd624`, `9ee943e7e`, `406b04da2`):

- `npm run lint`: exit 0, `Checked 2383 files in 797ms. No fixes applied.`
- `npm run typecheck`: exit 0.
- Squeal, revision 65, `squeal status --wait 60000` over the 9 `test/lint/surface/*.test.ts`, the 9 `test/lint/pass/*.test.ts` and `test/store/worktree-meta.test.ts`: `19 test files, each with a current result`, no known failures among them.
- Node 22.19.0, CI's version: `node node_modules/vitest/vitest.mjs run test/lint/surface/ test/lint/pass/ test/store/worktree-meta.test.ts --maxWorkers=2` gave `Test Files 19 passed (19)`, `Tests 84 passed (84)`. The host load average was about 15 to 19 from other work. These tests use the fake provider, not real ESLint.
- Mutation checks, each reverted and checked again:
  - letting a stale `pass` be told failed `states.test.ts` "stale FAIL ... stale PASS";
  - dropping deferral failed the unknown test and the stale test;
  - dropping the keying cut and the `LEAVES_FAIL` check in `wentToFail` failed `report.test.ts` "counts no failure a config keying may have made, though the file failed in the session";
  - dropping the `prior` check in `apply` failed both out-of-order tests in `race.test.ts`.
- **Known failures in the worktree: the bundle tests.** `rekey.ts`, `records.ts` and `run.ts` are in the daemon bundle, so `cli/squeal.mjs` differs from the build. `test/harness/opencode/package.test.ts` and `test/harness/pi/package.test.ts` fail with "cli/squeal.mjs differs from the build". `test/harness/plugin.test.ts` and `codex/plugin.test.ts` are expected to fail the same way. The brief forbids a build in a worker tree, so the integrator rebuilds the bundles.
- Not run: a full suite or a checkpoint (the brief), a build, key-format or compare-refs (no key part changed).
