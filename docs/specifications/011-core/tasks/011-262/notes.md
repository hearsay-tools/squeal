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

## 2026-10-30: R1, repair of review 0.1.379 (worker 408523d6, coordinator cbd3888a)

Review `reviews/0.1.379.md`: FAIL, B1 blocker, S1 and S2 should-fix. Brief: wave 56.5 R1.

### B1: the mark is git's answer when the revision is recorded

The shape (coordinator decision `92e431f5`, option (a), part 1 only):

- `IgnoredMarks` (`src/core/scheduler/ignored-marks.ts`, new) answers which changed paths git ignores when a revision is recorded. It takes the changed paths that are extra files (`WorktreeKeys.extraFiles()`) and asks git once, `git check-ignore -z --stdin`, which never reports a tracked path. With no extra file among them it runs no git process. Cost: one `git check-ignore` per revision that changes an extra path, none otherwise, never per delivery.
- The scheduler builds it beside its `WorktreeKeys` and hands it over as `KeyingOptions.ignored` (optional; absent, nothing is marked). `WorktreeKeys.ignoredAmong(paths)` delegates to it and replaces `isExtra`.
- Both revision writers ask `ignoredAmong` after the diff and `head`, before the transaction: `reconcileBatch` (`src/core/scheduler/batch.ts`, the watch and pass path) and `reconcile` (`src/core/revision/reconcile.ts`) through `ReconcileContext.ignored`, now `(paths) => Promise<ReadonlySet<RelativePath>>`. `WorktreeKeys.reconcile` passes it, so the start pass (`bootstrap`) and `reconcileRuntime` use it too. `commitBatch` keeps its synchronous predicate; `CommitContext.ignored` is unchanged.
- A path git tracks now (`git add -f`) or no longer ignores (a `.gitignore` edit) gets no mark, but it stays an extra file until the daemon restarts: leaving `#extra` would need the `Listings` count and a re-key of the tests that list its directories, so keys would move. The coordinator files that as a separate row.
- A mark git cannot prove is left off. When git refuses a path by name (a file in an embedded repository or submodule: `fatal: Pathspec 'vendor/lib.ts' is in submodule 'vendor'`; a path beyond a symlink) or fails for another reason (a corrupt index), the whole revision is unmarked, and a note says so once per text per daemon: `A change's git-ignored mark was left off: git did not classify <paths> (<git's error>).` The watcher's `checkIgnored` (`src/core/watcher/git.ts`, unchanged) still counts a refused path as ignored, which is right for what to watch, not for a claim.
- Off the validity path. A first version (`f22f1e86f`) kept the git check in `keying.ts` and gave `checkIgnored` a refused-path collector; `test/keys/key-format.test.ts` then failed, since those lines are on the validity path and no case runs a refused path or a failed check (it named `keying.ts` and `git.ts` lines, and pytest lines, though no pytest file changed since `squeal--v0.1.378`). No key reads a mark, so `5442df19e` moved the check to `IgnoredMarks` and put `git.ts` back; key-format passes again, the pytest lines with it.
- No store, `FileChange`, `StatusHeader`, key or `--json` change.

Tests:

- `test/delivery/ignored-transitions.test.ts` (new), the `WorktreeKeys.reconcile` writer: in one daemon, revision 1 marked; then `git add -f` with a commit, or a `.gitignore` that no longer names `.ai/qa/` (file left untracked); revision 2 unmarked, revision 1 keeps its mark, the path still in `extraFiles()`, and a header spanning both (consumer last told revision 0) names the descriptor without `git-ignored` in both forms. A gitlink `vendor/` makes `vendor/lib.ts` an extra file git refuses: two revisions, no mark, one note. A corrupt `.git/index` makes `check-ignore` fail: no mark, one note naming the path. The fixture's keys ask `IgnoredMarks` as the scheduler's do.
- `test/scheduler/daemon-loop.test.ts`, the `reconcileBatch` writer through the real change feed and scheduler: after the marked watch revision, `git add -f` and a commit of `src/gen/client.ts`, a rewrite; the new watch revision is unmarked, the earlier one still marked, the path still extra.
- `test/delivery/descriptor-fixture.ts` (new): the repository of `ignored-paths.test.ts`, shared with the new file. `ignored-paths.test.ts` reads it; its tests are unchanged.

The tests came after the code in this round. They fail on the old rule, which marked by `#extra` alone; the review's probe reproduced revision 2 marked with the same steps.

### S2: a `)` inside a path

`test/e2e/agree.ts` `CHANGED` and the `NEWS` pattern of `evals/lib/squeal-text.mjs` end the paths clause at the `)` that comes before `: ` (`(?:[^)\n]|\)(?!: ))*\)`), so `src/app/(auth)/page.tsx` does not end it. The group captures nothing, so agree.ts's capture indexes stay. Limit: a path that holds `): ` still ends it. Tests, real formatter output, red then green:

- `test/evals/evidence-squeal.test.ts`: a route-group case beside the others, for every push formatter, with and without a commit. Red: the news form without a commit.
- `test/delivery/e2e-agree.test.ts`: `src/app/(auth)/page.tsx` in the news and the full form, with and without a commit; a wrong `sinceHead` still disagrees, so the commit captures are read where they were.

### S1: the agents' reading instructions

The single source is `plugins/claude-code/skills/squeal/` (`SKILL_SOURCE` in `src/harness/codex/build.ts` and `src/harness/pi/build.ts`). The build copies it to `plugins/codex-runtime/skills/squeal`, `plugins/codex/seed/skills/squeal` and `plugins/pi/skills/squeal`, and the Codex runtime and seed manifests hold each file's SHA-256. A hand edit of the Codex copies made the committed runtime refuse to load (`skills/squeal/SKILL.md does not match its SHA-256`, seen in `test/e2e/transitions.test.ts` and `test/harness/codex/runtime-release/limits.test.ts`), so only the source changes; the release build carries it to the three copies.

- `references/reports.md`: the full-header paragraph says a file git ignores reads `git-ignored <path>`, as in `(changed git-ignored .ai/qa/test-env.json)`; the news paragraph says the news carries the same changed files first, `Revision 12 (changed src/math.ts): 3 pending (3 tests), 2 unknown (2 tests).`, and no longer lists the changed files among what it leaves out.
- `SKILL.md` "Reading a header": `Other SQUEAL messages carry the news, those files and non-zero counts only.`; the pointer to `reports.md` lists `git-ignored`. The body was 4,999 characters against its 5,000 budget (`test/harness/skill.test.ts`, since 005-35); it is 4,991 now. The mark's own sentence did not fit, so it is in `reports.md`.
- `test/harness/skill.test.ts`: the wording checks move; a new case builds the news line with `formatDelta` and finds it in `reports.md`, and checks the mark's example against the formatter.
- Not mine: `docs/specifications/011-core/spec.md:188` (C5) still says counts-owed news is "without the changed paths"; the review asks to remove that.

### Commits (R1)

- `33e5035b4` test(011-262): the descriptor repository is a fixture the ignored-path tests share
- `f22f1e86f` fix(011-262): a git-ignored mark rests on git's answer when the revision is recorded (review 0.1.379 B1)
- `5442df19e` fix(011-262): the git-ignored mark is asked off the key path (review 0.1.379 B1)
- `656e8543d` fix(011-262): both news parsers read past a path that holds a closing parenthesis (review 0.1.379 S2)
- `b44aaf3c6` docs(011-262): the skill says the news names the changed files, and reports.md the git-ignored mark (review 0.1.379 S1)

### Checks run (R1, commands with `env -u PLUGIN_ROOT -u PLUGIN_DATA`)

- `pnpm run lint`: `Checked 2565 files in 696ms. No fixes applied.` at `5442df19e`.
- `pnpm run typecheck`: `tsc --noEmit`, no output, exit 0, at `5442df19e`.
- `squeal status --wait 60000` on every file `fa6079033..5442df19e` changed, `plugins/claude-code/skills/squeal/SKILL.md`, `references/reports.md`, `test/keys/key-format.test.ts` and `test/version-sensitive.test.ts`, at revision 38 (`5442df19 + 0`): 904 test files selected, all current: 899 pass, 5 fail. The whole worktree: all 1,327 test files current (the daemon's own catch-up of what these edits re-keyed; no full run was asked), 7 known failures, every one build drift the release build clears:
  - the bundles: `test/harness/plugin.test.ts` ("bundles are committed exactly as `npm run build` produces them"), `test/harness/pi/package.test.ts`, `test/harness/opencode/package.test.ts` and `test/harness/codex/packaging/runtime.test.ts` ("has the bundles exactly as `npm run build:plugin` produces them"), each `cli/squeal.mjs differs from the build`;
  - the skill copies (S1): `test/harness/pi/package.test.ts` and `test/harness/codex/packaging/runtime.test.ts` ("carries the skill exactly as its source in the Claude Code plugin, with the ... note"), `test/harness/shared/skill-pytest.test.ts` ("is the same text in both plugins but for Codex's paragraph on the CLI").
- `test/keys/key-format.test.ts`: failed at revision 32 (`f22f1e86f`'s lines, see B1), passes at revision 37 and after.
- `pnpm exec vitest run test/e2e/transitions.test.ts --maxWorkers=1` (outside Squeal, the committed bundles with this branch's `test/e2e/agree.ts`): `Tests 4 passed (4)`, 17.98 s, at `b44aaf3c6`'s tree. An earlier run with hand-edited Codex skill copies failed the two Codex cases (`skills/squeal/SKILL.md does not match its SHA-256`); those edits were not committed.
- Not run: `pnpm run build` (brief), a full suite (policy).

### For the coordinator

- Type changes: `ReconcileContext.ignored` is now `(paths) => Promise<ReadonlySet<RelativePath>>` (added by this row, internal); `KeyingOptions.ignored?` is new; `WorktreeKeys.isExtra` is replaced by `WorktreeKeys.ignoredAmong`. `FileChange`, `StatusHeader` and `CommitContext` are as before.
- The release build must carry `plugins/claude-code/skills/squeal` to the three copies, besides the bundles.
- Still open, not mine: C5's counts-owed "without the changed paths" (`spec.md:188`); the row for an extra file git stops ignoring to leave `#extra`.

