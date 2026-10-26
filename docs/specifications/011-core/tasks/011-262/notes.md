# 011-262 notes: the change notice names its paths and marks the ones git ignores

Row 011-262 (`tasks/wave-56.md` W1, gh-105). Worker run `10635869`, 2026-10-26/27. Baseline: `c1018ea66`.

## What changed

- **The news form names the changed paths.** `newsLine` (`src/core/delivery/header.ts`) puts the same clause as the full form after the revision: `Revision 12 (changed src/a.ts, src/b.ts, src/c.ts and 2 more): 3 pending ...`. Task 001-407 had dropped it; the human's "Show paths: yes" (2026-10-26) brings it back. The row-011-205 branch of `newsLine` (counts owed) carries it too, since it builds on the same `revision` prefix.
- **A stored change marks a path git ignores.** `FileChange.ignored?: true` (`src/core/types/revision.ts`). `commitBatch` (`src/core/revision/reconcile.ts`) takes an optional `ignored(path)` and marks each change it names (`marked`). Two callers fill it from the new `WorktreeKeys.isExtra(path)` (`src/core/scheduler/keying.ts`), the daemon's in-memory extra-file set (`#extra`):
  - the watch and pass path, `reconcileBatch` (`src/core/scheduler/batch.ts`);
  - `WorktreeKeys.reconcile`, which the start pass (`bootstrap`) and tests use, through `ReconcileContext.ignored`.
- **The header carries the mark.** `StatusHeader.ignoredPaths?` (`src/core/types/status.ts`), set by `readLiveHeader` (`src/core/delivery/liveness.ts`) from the newest change of each path in `changedSince`; absent when none. `changedText` writes such a path as `git-ignored <path>` in both forms.

Example: E1's descriptor step now reads `Revision 1 · 0123abcd + 1 (changed git-ignored .ai/qa/test-env.json): ...`.

## The shape (coordinator request `2c2a4be1`, replied: approved)

1. Store: `FileChange.ignored?: true`, inside the existing `revisions.changes` JSON column. No migration, no git process per delivery or per revision, no key change. Rows without the mark (all rows from before, and rows of an older daemon) read as not ignored.
2. `StatusHeader.ignoredPaths?: readonly RelativePath[]`, set by `readLiveHeader` only, like `changedPaths`. `squeal status --json` does not read `readLiveHeader`, so it does not change.
3. No `--json` change.
4. Text: the word before the path, `(changed src/a.ts, git-ignored .ai/qa/test-env.json and 2 more)`. The brief's `(changed .ai/qa/test-env.json, git-ignored)` reads as a second path when there are several. "and N more" is unchanged; it does not count the ignored ones among the rest (coordinator's decision).

Rejected source: a `meta` row with the daemon's extra-file set. It costs a parse of the whole set on every delivery and marks by the set at delivery time, not at the revision.

Why `#extra` is the right set: a gitignored path reaches a revision only as an extra file. `candidatesFromHints` checks every hinted path with `git check-ignore` except the extra files; `candidatesForReconcile` takes `git status`, the tracked paths (`WorktreeKeys.trackedPaths` leaves the extra files out) and the extra files; `bootstrap` adds each cached path git ignores to `#extra` before its start pass. A tracked file that matches `.gitignore` is not ignored by git and is not marked.

## The coordinator's two checks before (1)

**An older daemon or hook reads a marked row correctly.** The parse is `json<FileChange[]>(row, "changes")` (`src/core/store/repos/workspace.ts:81`), which is `JSON.parse(str(row, column)) as T` (`src/core/store/codec.ts:41`): no validation, no strict key set. Every reader names `path`, `oldHash` and `newHash` and nothing else. `test/store/repos.test.ts` ("round-trips a change's ignored mark ...") stores a marked row, reads it back with the mark, and parses the raw column with `JSON.parse` as an old reader does: the path and hashes are as before. Result: pass.

**Nothing compares or hashes the changes JSON.** Every reader of `Revision.changes` or `FileChange`, by grep of `src`:

- path only: `code/pass/source.ts`, `delivery/liveness.ts` (`changedSince`), `scheduler/backlog.ts`, `scheduler/handover.ts`, `scheduler/install.ts`, `scheduler/scheduler.ts:381`, `scheduler/batch.ts`, `scheduler/refinement.ts`, `scheduler/revision.ts` (`rekeyContent`, `toInvalidatedPath` builds `{ path, kind }`), `status/why.ts`, `keys/resolution.ts`;
- path and hashes: `keys/observed.ts` (`apply`), `scheduler/editor-scratch.ts`, `scheduler/keying.ts` (`updateDeclaredInputs`; `provisionalEnvironments` hashes `[path, newHash]` pairs, not the object), `delivery/liveness.ts` (`installed`).
- No revision dedup by content: `append` numbers by `max(number) + 1`. No SQL reads the `changes` column except `SELECT *` in the repo. No `isDeepStrictEqual` in `src`. Provenance uses `installedLockfile` (path and `newHash`). Inheritance moves results by key, and keys come from file hashes, not revision rows.

Both checks passed, so (1) was committed.

## Tests

- `test/delivery/news-header.test.ts`: the news form names up to three paths and "and N more", and nothing with no change set; each named ignored path reads `git-ignored` in the news and the full form; the other lines now start with the paths clause. "drops the changed paths" is replaced.
- `test/delivery/ignored-paths.test.ts` (new): findings E1's descriptor step in a private `/tmp` git repository, `.ai/qa/` ignored, a reader's closure naming `.ai/qa/test-env.json` (as its observed reads did). The rewrite leaves `git status --porcelain` empty, makes a revision whose change carries `ignored: true`, and both header forms start `Revision 1 · <sha8> + 1 (changed git-ignored .ai/qa/test-env.json): `. A tracked path beside it reads unmarked. A daemon that finds the descriptor rewritten while none ran marks it in its `start` revision (E1's restart row).
- `test/revision/reconcile.test.ts`: `commitBatch` marks only the paths `ignored` names; without `ignored` it stores no mark.
- `test/scheduler/daemon-loop.test.ts`: the existing rewrite of the gitignored `src/gen/client.ts` through the real change feed and scheduler now asserts the watch revision's mark. It adds no run.
- `test/store/repos.test.ts`: the old-reader check above.
- `test/status/feed-late.test.ts`: its news line now names `src/a.ts`.

## Commits

- `44e4a78f0` feat(011-262): the news form names the changed paths as the full form does
- `166c95009` test(011-262): the news-header test reads a line that may be missing
- `213176f77` feat(011-262): a stored change marks a path git ignores
- `a209480aa` feat(011-262): a header marks each changed path git ignores

## Checks run (all commands with `env -u PLUGIN_ROOT -u PLUGIN_DATA`)

- `npm run lint`: `Checked 2381 files in 875ms. No fixes applied.` (at `a209480aa`)
- `npx tsc --noEmit` (`npm run typecheck`): no output, exit 0 (at `a209480aa`, before the commit).
- Squeal, named files, each `squeal status --wait 60000 <file>`: pass at the revision named:
  - `test/delivery/news-header.test.ts` (revision 17, after the mark test), `test/status/feed-late.test.ts` (revision 3), `test/revision/reconcile.test.ts` (revision 10), `test/store/repos.test.ts` (revision 11), `test/delivery/ignored-paths.test.ts` (revision 16).
- Not yet read: the verdict on the 582 test files `src/core/delivery/header.ts` selects, among them `test/scheduler/daemon-loop.test.ts` and `test/keys/key-format.test.ts`. They were queued behind the vitest lane's 120 s quiet window. Known: `test/harness/plugin.test.ts` bundles test fails, the expected drift above.

## What is left

1. Read `squeal status --wait 60000 src/core/delivery/header.ts src/core/delivery/liveness.ts src/core/types/status.ts src/core/types/revision.ts src/core/revision/reconcile.ts src/core/scheduler/keying.ts src/core/scheduler/batch.ts test/scheduler/daemon-loop.test.ts test/keys/key-format.test.ts` until no file is pending; wait again while files are queued. Every failure except the bundles test is to be read with `squeal why`.
2. Report the commits and check outputs to the coordinator.

## For the next worker or the coordinator

- Spec text is not mine: 001 D6 and task 001-407 still say the news form drops the changed paths. The amendment ("the news form names the changed paths, and a header marks a path git ignores", row 011-262) goes to `status.md`.
- `plugins/claude-code/dist` and the other bundles are not rebuilt (brief: no `npm run build`); `test/harness/plugin.test.ts` "bundles ... are committed exactly as `npm run build` produces them" fails until the release build. That is the expected drift.
- Old revision rows carry no mark, so a delivery that spans a daemon upgrade can name an ignored path without `git-ignored` once.
- Not done, and not asked: counting the ignored paths among "and N more", naming how many test files a path re-keyed, and the top directories of a large set (findings section 4's other ideas).
