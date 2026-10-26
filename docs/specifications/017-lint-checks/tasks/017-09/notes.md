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
| `src/core/lint/surface/format.ts` | Text lines: `lintLines`, `lintEntryLine`, `lintSummaryLine`, `lintFailedLine`, `lintOffLine`, `lintRegistrationLine`, `lintStatusLines`, `lintChanges`, `lintTitleWords`. |
| `src/core/lint/surface/index.ts` | Re-exports the above. |

## Store and pass extensions (own commits)

1. `32016a5fa`: `LintTransitionRepo` gains `after(worktreeId, id)`, `latest(worktreeId)` and `lastId(worktreeId)`. The new type `LintTransitionRecord` is a `LintTransition` with its row `id`.
2. `cff898098`: the pass writes `lint-keying:<worktree>` = `{ seq, mode: "first" | "config", revision, at }` in the keying's own transaction (`rekey.ts`). `readKeying` and `writeKeying` are in `pass/records.ts`.

Both are additive. The schema stays v1. No key part changed: `LINT_KEY`, `PROVIDER_VERSION` and `KEY_FORMAT_VERSION` are as they were.

## Decisions the spec did not settle

1. **The told mark is a transition id, not a clock.** The pass reads `now()` before it writes its transaction. With a clock mark, a hook could read its clock, then the pass could commit a transition stamped earlier, and the next delivery would treat it as old. Writers take the store's lock in turn and no transition row is deleted, so ids grow in commit order. `test/lint/surface/race.test.ts` runs the pass clock from 1,000 and the deliveries from 5,000, so every missed change looks older than the delivery that missed it.
   - **For a later prune row:** never delete the newest transition row of a worktree. An id that is used again would hide news.
2. **News is "what the consumer was told" against "the state now".** It is told only when both of these are true:
   - the file's last transition is in the consumer's own revisions (`isOwn`, 015's bound);
   - the consumer's own transitions since its mark add or remove at least one finding.
   The kind comes from the view and the state now. The evidence is the net of the own transitions, counted by rule and message. A change from a config keying is never named as an edit's evidence. Example: an edit adds `no-undef`, and a second edit before the delivery replaces it with `no-console`. The consumer hears one `pass-to-fail +no-console`.
3. **Deferred files.** A file that is `pending`, `unknown` or a stale `pass` when read is told nothing. Its own changes stay owed in the mark (`deferred`, with the id they count after). So a fix followed by an unknown lint is told as PASS once the file is judged again. This is true even when that lint records no transition.
4. **A stale FAIL is told,** with `stale: true` ("linted before the last program change"). A stale PASS never is. Status and registration count `failing` as current failures only. `stale` is counted apart, so no file is counted twice.
5. **Summary.** A `first` or `config` keying newer than the consumer's mark gives one summary, once no quiet file is `pending`. The view is then seeded again by count. Quiet files that read `unknown` do not hold the summary back. A consumer that registers while a keying's files lint gets the summary when they end. So does one that registered before the store existed. A consumer that registers after the end gets no summary.
6. **The first pass's end is a summary too** (`reason: "first"`), as 015's first count is. The wording is `Lint: N files with findings; squeal lint lists them.`
7. **D9 reasons are told once per consumer for each new reason:** `failed` (a keying failed) and `off`. They are not repeated at each tool boundary. Registration and status always show them.
8. **Stop evidence (`lintStop`):**
   - It is `null` unless `lint.blocking` is `true`.
   - It counts a file only when the file fails at its current key and its last transition into `fail` (`first-seen-fail` or `pass-to-fail`) is in the consumer's own revisions.
   - A `fail-changed` on a file that failed at registration is not counted.
   - A stale, pending or unknown file is not counted. They are counted in `notCurrent`.
   - With no registration (`since` null), nothing counts.
9. **`--changed`** lists each file whose last transition is the session's own. The newest revision is first, and files in one revision are by path. Each entry has its last transition and its state now. Every change a delivery listed or counted in `more` is there.
10. **Findings not stored.** When the result a state was judged on is gone, the findings read `null`, and the line says "findings not stored". It never says "0 findings" for a failing file. No prune exists yet, so this path does not run today.
11. **Two-step delivery.** `readLintNews` is read only and returns an `ack`. `acknowledgeLint(ack)` writes the view and mark that the read saw, and never moves a newer mark back. A change after the read stays news. `tellLint` does both, as `tellCode` does: a read-only probe, then one write transaction that reads again.
12. **`dropLint` drops the views and marks of consumers that left.** It does not clear the views of departed consumers in other worktrees, as `dropCode`'s `retain` does, because `LintViewRepo` has no `retain`. An ended session's views stay, as 015's do.
13. **015-38's rule for git-brought recoveries is not ported.** The lint pass records no pull marks. A recovery that a pull brings inside the consumer's revisions is told.

## For 017-10

- Call `registerLint(source, consumer, at)` in the registration transaction, beside `registerCode`.
- Call `tellLint(source, consumer, at, () => codeSeenUpTo(store, consumer))` beside `tellCode`. Format its result with `lintLines(news, command)` after the code lines. The lines never change `codeChanges`, `codeLines` or code overflow.
- For status: `lintStatus(source, worktreeId, codeSince(store, worktreeId, shell))` and `lintStatusLines`. The JSON is `LintStatus`. It holds the spec's `files, failing, sinceRegistration, pending, stale, unknown, off?` plus `since`, `reasons`, `linting?`, `failed?` and `unreadable?`.
- For `squeal lint`: `lintDetails` and `lintChanged`. Both read the store with no daemon. A missing store reads as `linting: { done: 0, total: 0 }` ("linting has not started").
- For Stop: `lintStop(source, worktreeId, codeSeenUpTo(store, consumer))`. Lint never denies a tool call. Lint never counts in `Known failures`: no surface function touches the main store.
- Each function returns `undefined` or `null` while `lint.enabled` is off, and opens nothing. A store that fails mid-read loses only the lint part. Nothing throws to the caller.

## Checks run (2026-10-26)

- `npm run lint`: exit 0, `Checked 2383 files in 891ms. No fixes applied.`
- `npm run typecheck`: exit 0, no diagnostics (after one fix in `format.test.ts`).
- Squeal, revision 46, `squeal status --wait 60000` over the 9 `test/lint/surface/*.test.ts` and the 9 `test/lint/pass/*.test.ts`: `18 test files, each with a current result`, no known failures among them. `source.test.ts` was current at revision 47 after its last test was added.
- Node 22.19.0, CI's version: `node node_modules/vitest/vitest.mjs run test/lint/surface/ test/lint/pass/ test/store/worktree-meta.test.ts --maxWorkers=2` gave `Test Files 19 passed (19)`, `Tests 79 passed (79)`, with a host load average of about 22. These tests use the fake provider, not real ESLint.
- Mutation checks on `news.ts`, each reverted:
  - letting a stale `pass` be told failed `states.test.ts` "stale FAIL ... stale PASS";
  - dropping deferral failed the unknown test and the stale test.
- **Known failures in the worktree: the bundle tests.** `rekey.ts` and `records.ts` are in the daemon bundle, so `cli/squeal.mjs` differs from the build. `test/harness/opencode/package.test.ts` and `test/harness/pi/package.test.ts` fail with "cli/squeal.mjs differs from the build". `test/harness/plugin.test.ts` and `codex/plugin.test.ts` are expected to fail the same way. The brief forbids a build in a worker tree, so the integrator rebuilds the bundles.
- Not run: a full suite or a checkpoint (the brief), a build, key-format or compare-refs (no key part changed).
