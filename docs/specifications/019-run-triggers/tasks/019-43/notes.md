# 019-43 notes: a lint group at commit tells the agent which finding (P12)

Worker 488d8b15, 2026-11-04, branch `cez/488d8b15`. Lessons Round 3 P12, proposal (a), by the coordinator's reply of 2026-11-04 (request 03866a5e). Base: `aa9ad97b4`.

## The cause, as found

- With lint only at `commit`, the first keying makes every file `pending` and puts it in the quiet set (`lint-quiet:<scope>`, `rekey.ts` `judgeAll`). A held path keeps its quiet mark (019-22, `parts.ts` `readQueue`).
- A commit releases the changed path. The pass lints it with cause `config`, because it is quiet (`lint-part.ts` `judge`). `lintTransition` records nothing for `config`. So D8 has no transition to tell.
- The keying's summary waits until no quiet file is pending (`summaryOf`). Held files never lint, so it never comes.
- Status and registration said `linting, N of M files` while a quiet file was pending, held or not (`progressOf`).

## What changed

- **A commit's release is news** (`src/core/lint/pass/commit-entry.ts`). `release()`, which only `commitLint` calls, writes the paths to `lint-release:<scope>` and to a new record `lint-committed:<scope>` (path to blob). `releaseLintGroup` (`squeal run <lint group>`) writes only the release, so it stays quiet, as 019-22 chose.
- **The hold drops the quiet mark** (`commitHold`, `committedNews`). In each pass, after `releasedNow` finds the live releases, a committed path whose release is live at the same blob leaves the quiet set. The pass reads the quiet set in `lintParts` right after, in the same JavaScript turn (`run.ts`: `rekey`, then `commitHold`, then `lintParts`). So the lint is judged with cause `edit` and records `first-seen-fail`, `pass-to-fail` or `fail-changed`. D8 then tells it once at the next boundary or Stop (017-23 reads lint news at Stop). A committed path whose release is gone or at another blob is dropped.
- **Why at each pass, not once at release**: the parts keep the quiet set in memory and write it at their end, so a release-time removal could be written over by a pass that was running. A config keying (P13's re-key in cezarion) also puts every miss back in the quiet set. Both are undone by the next `commitHold`.
- **The hold record** (`lint-held:<scope>`, the group's name). `commitHold` writes it while a lint group at `commit` holds the tool and deletes it otherwise. It writes only on a change. Status and the delivery read it with no policy.
- **Status counts only lint that runs** (`src/core/lint/surface/snapshot.ts` `progressOf`). A pending check of a held tool whose path no release names is left out of `linting, N of M files`, and does not keep "linting" on. A released one counts.
- **The summary still waits** (`keyingLinted`, used by `summaryOf` and the registration's `keyingSeen`). It counts held files as not linted, as before. So no `Lint: 0 files with findings` summary is told while held files were never linted. If `squeal run <lint group>` lints them all, the summary comes then.
- Both records are in the lint store's `meta` table and `forgetRecords` deletes them with the scope.
- `records.ts`: `readBlobs` and `writeBlobs`, the release record's form, moved here from `commit-entry.ts` so the surface reads releases without importing the pass's group code. `releasedNow` now returns the live map and is no longer exported.

## Decisions the spec did not settle (my choices)

1. **The line is D8's, as it is** (the coordinator's answer, option A). It names the file, the tool when not ESLint, the count, the rules and one finding's message. It has no source line number.
2. **A request's release stays quiet.** Only a commit's paths are told one by one. A request of every held file would otherwise list up to the cap and "N more".
3. **The registration line changes in a held setup.** Before: `Lint: linting, 0 of 3 files.` After: `Lint: 0 files with findings; squeal lint lists them.` (registration has no pending count; status says `3 not linted yet`). Without `checks` it is unchanged.
4. **A released path counts as running in status until the next pass**, even when its release is spent (an edit after the commit). The next pass drops the release.

## Texts without `checks`

No tool is held, so `release` is never called, `lint-held` is never written, `heldOf` is `() => false` and `keyingLinted` is the old `progressOf(...) === undefined`. Every text is the same.

## Tests

- `test/commit/lint-told-daemon.test.ts` (the done-when): a real daemon with the fake lint provider, a real `git commit`, Claude Code's and Codex's hooks. Lint only at `commit`. Status has no "linting" after the first keying; the edit lints nothing; the commit's boundary, the Stop, the Stop with `stop_hook_active` and a later boundary together tell `FAIL lint: src/a.js: 1 finding, +1 no-undef (no-undef found)` once; status has no "linting" at the end. On the base code it fails at both its first status check (`Lint: linting, 0 of 3 files.`) and its FAIL line check (none told), on both harnesses (run in a base checkout, `node_modules/.bin/vitest run`).
- `test/lint/pass/commit-entry.test.ts`, new case: the hold record; the first keying's quiet set; `progressOf` undefined while all are held, `{ done: 0, total: 1 }` after a commit's release, undefined after its lint; the commit's lint records `first-seen-fail` with the rule and leaves the quiet set; a request's release records no transition; `keyingLinted` false while held files wait, true once all are linted; no hold record without a lint group at `commit`.

## For the next worker

- `parts.ts` line 185 says "A held path keeps its quiet mark: once released, it lints with no transition still." That is now true only for a request's release. The file is outside this row's ownership; the comment needs one word of change.
- Where the line arrived in the daemon test is not asserted: the commit's boundary or the Stop, whichever reads after the lint records.
- A delivery that reads between the lint's record and the commit update's store tells the FAIL line before the update. The update then comes at the next delivery. Both are told once.
