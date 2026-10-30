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

## 2026-10-30: W1b finish (worker 408523d6, coordinator cbd3888a)

The five commits above were rebased with no conflict onto main `093f29861` (about 500 commits later, 0.1.369's `runtimeFiles` among them). Their new hashes: `a3a8fe024`, `1cf5b503c`, `8dc4010d7`, `1b3cf19c0`, `67cb472b8`, in the order of "Commits" above. The shape is unchanged.

### `runtimeFiles` and the mark

A `runtimeFiles` rule takes an exact path out of the observed reads of the test files it names (`RuntimeFiles.effective`). The mark still comes from `#extra` (`WorktreeKeys.isExtra`), so:

- While a reader outside the rule still names the path, it stays an extra file. Its change is a revision whose change carries `ignored: true`, and both header forms name it `git-ignored`. So is the start revision `reconcileRuntime` makes for a cached runtime file a daemon finds changed, since it calls `WorktreeKeys.reconcile`.
- When the rule takes the path out of every reader that names it, nothing names it: `trackUntracked` does not hash it and the release drops it from `#extra`. A rewrite makes no revision, so no header names it, with or without the mark.
- A runtime file git tracks (`git add -f`) is not ignored by git: an ordinary revision, no mark.

Tests: `test/delivery/ignored-paths.test.ts`, describe "the descriptor a runtimeFiles rule takes out of a reader's reads", three cases for the three points above (the third without the tracked case, which `test/scheduler/runtime-files-protection.test.ts` covers).

### What the rebase and the row broke, and the repairs

Read with `squeal why` each:

- Six tests asserted the old news line, `Revision 1: no check pending, stale or unknown.`; the row makes it `Revision 1 (changed src/math.ts): ...` (`src/a.ts` in the delivery fixtures). That is the row's change, so the expectations move: `test/delivery/edits.test.ts` ("says once that Squeal saw it ..."), `test/delivery/edits-confirmation.test.ts` ("is left out with nothing pending ..."), `test/harness/liveness.test.ts` (two), `test/harness/stale-replacement.test.ts`, `test/harness/starting-daemon.test.ts`.
- Two header parsers did not read a news line with the paths clause:
  - `test/e2e/agree.ts` `NEWS`: no match at all, commit or not. Fixed with a `CHANGED` group beside `COMMIT`, as `HEADER` had. Red-then-green case in `test/delivery/e2e-agree.test.ts`. Squeal does not run `test/e2e/**`; the e2e tests run the committed plugin bundles, which this row does not rebuild, so a local run tests the old news form and was not made. CI's full run covers them.
  - `evals/lib/squeal-text.mjs` `NEWS`: the greedy `(?: · [^:]*)?` took the clause after a commit, but a revision without one (head null) read null counts. Fixed with an optional `(?: \(changed [^)]*\))?` after the commit group. The coordinator gave this file to the row (request `1ba84657`). The case in `test/evals/evidence-squeal.test.ts` parses each push formatter's real output (`formatRegistration`, Stop's `statusText`, `formatDelta` news and owed news), for every variant, as text and in hook JSON, with and without a commit, with one path, "and N more" and a git-ignored path, and compares the evidence with the same text without the clause. Red: the three news cases without a commit; green after the fix.
- Nothing the rebase alone broke was found.

### Scoped run (coordinator request `7380c3db`, decision (a))

The changed sources select 832 test files, which the lookup-only baseline left unknown with nothing queued. Not all were run (host policy 2026-10-25). The file list rule, 159 test files (`squeal retry`):

- every `test/delivery/*.test.ts` and `test/revision/*.test.ts`;
- the direct importers of `src/core/delivery/header.ts`, `liveness.ts` and `src/core/scheduler/keying.ts`;
- every test file naming `reconcileBatch`, `isExtra`, `extraFiles()`, `readLiveHeader`, `headerLines`, `formatDelta`, `formatRegistration`, `newsLine`, `commitBatch`, `ignoredPaths` or `changedPaths`, or asserting `Revision N` header text;
- `test/harness/plugin.test.ts`, `test/store/repos.test.ts`, `test/watcher/change-feed.test.ts`.

Result at revision 2: 159 current, 152 pass, 7 fail: the six above and the bundles test. After the repairs they pass. The parser edits re-keyed 81 more test files (readers of `evals/lib/squeal-text.mjs` and the others); they ran in catch-up and pass.

### Checks run (commands with `env -u PLUGIN_ROOT -u PLUGIN_DATA`)

- `pnpm run lint`: `Checked 2562 files in 812ms. No fixes applied.` at `67cb472b8`; `Checked 2562 files in 889ms. No fixes applied.` at `7b73b8779`.
- `pnpm run typecheck`: `tsc --noEmit`, no output, exit 0, at `67cb472b8` and at `7b73b8779`.
- `squeal status --wait 60000` on the 8 named test files at revision 0 (the wait asked one run each): 8 pass, among them `test/keys/key-format.test.ts` and `test/version-sensitive.test.ts`.
- `squeal status --wait 60000` on every changed file of `093f29861..7b73b8779` and the two above, at revision 11 (`7b73b877 + 0`): 902 test files selected; current 223: 222 pass, 1 fail (`test/harness/plugin.test.ts > bundles > are committed exactly as \`npm run build\` produces them`, `cli/squeal.mjs differs from the build`, the expected drift); pending 0; unknown 679, never run at their inputs, left for CI. `test/e2e/agree.ts` is no test file Squeal lists.
- Not run: `pnpm run build` (brief), the e2e tests (above), a full suite (policy).

### Commits (W1b)

- `2aa771f65` test(011-262): a path a runtimeFiles rule takes out of a reader's reads keeps its mark while another reader names it
- `b5b03ddd4` fix(011-262): the e2e agreement helper reads a news line that names its changed paths
- `94ac31738` test(011-262): delivery and liveness tests expect the news line to name its changed path
- `7b73b8779` fix(011-262): the evals parser reads a news header that names its changed paths (by agreement, coordinator request 1ba84657)

### For the coordinator

- No type change in W1b. The row's type changes stay as above: `FileChange.ignored?: true`, `StatusHeader.ignoredPaths?`, `WorktreeKeys.isExtra`, `ReconcileContext.ignored`, `commitBatch`'s optional `ignored`.
- `docs/specifications/005-agent-adoption/research/probes/adoption-baseline/metric.mjs` reads `Revision (\d+)[^:]*: (\d+) current, ...`, which takes the clause; not changed.
- `test/evals/fixtures/squeal-text-c6320866.mjs` is main's parser frozen before 001-407, the gate's floor; not changed.
- The spec and `status.md` amendment and the bundles are still to do, as "For the next worker or the coordinator" says.
