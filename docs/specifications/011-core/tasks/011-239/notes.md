# 011-239 notes: one HEAD reader, and the idle pass reads HEAD in reftable repositories

Worker W1 of wave 48, 2026-10-26. From main `9622b9ed0`. Commits `18ea7283d` (slice 1) and `c4bf93954` (slice 2).

## Slice 1: the idle pass (`18ea7283d`)

- `gitHead(root, options)` is new in `src/core/status/git-head.ts`, beside `readGitHead`. It returns `readGitHead(root)` when that is not `null`. Otherwise it runs `git rev-parse --verify -q HEAD` (exit 1 is an unborn `HEAD`) and returns the commit, or `null` for empty output. `options.timeoutMs` goes to `runGit`.
- `recordHeadMove` (`src/core/scheduler/head-move.ts:19`) compares `gitHead` with the known `HEAD`, where it compared `readGitHead`. In a reftable repository `readGitHead` gives `null`, so each idle pass ran `context.head()` (`git rev-parse` and `git status`) and wrote the `head-move.` `meta` row, about every 30 s, against task 001-412. Now that pass spawns one `rev-parse` and writes nothing while `HEAD` stays.
- `readGitHead` and `statusIdentity` did not change. They stay synchronous and spawn nothing.

## Slice 2: one reader (`c4bf93954`)

- `passHead` left `src/core/watcher/candidates.ts`. `Feed#reconcileNow` (`change-feed.ts`) calls `gitHead` in its place, still before `git status` (the 011-199 rule).
- `readHead` (`src/core/daemon-loop/head.ts`) calls `gitHead` in place of its own `rev-parse`. It now reads the git dir first, so in an ordinary repository a revision spawns one git process fewer. `readGitHead` is synchronous, so `HEAD` is read before `git status` starts, as before.
- `treePrint` (`src/core/delivery/stopped.ts`) calls `gitHead(root, options)`, so its time bound still covers the `rev-parse`. It hashes `head ?? ""`, which is the bytes the old `rev-parse` output gave after `trim()`: a commit, or the empty string while `HEAD` is unborn. A stop mark written by an older version still matches.
- `grep -rn "rev-parse --verify -q HEAD" src` finds one place: the comment of `gitHead`, directly above its one command.

## Decisions the brief did not settle

1. **`gitHead` is in `src/core/status/git-head.ts`, not `src/core/fs`.** The brief's lead names `git-head.ts`; scan b's slice 9 names `src/core/fs`. `gitHead` calls `readGitHead`, which lives in `status`, and `fs` imports nothing from `status`. Moving `readGitHead` to `fs` would touch `identity.ts`, which is not this row's.
2. **The tests fake the git dir reader at `gitDirOf`** (`src/core/fs/index.js`), not at `readGitHead`. `vi.mock` replaces a module's exports for its importers only. `gitHead` calls `readGitHead` inside the same module, so a mock of `readGitHead` does not reach it: 011-201's null-reader case would have passed without testing the fallback. With `gitDirOf` faked to `null`, the real `readGitHead` gives `null`. Each null-reader case asserts that it does (`expect(readGitHead(root) === null).toBe(nullHead)`), so the case cannot pass on a fake that has no effect.
3. **`src/core/watcher/change-feed.ts` changed outside the five files**: its import and the one call of `passHead`, because `passHead` moved. The parent was told (progress message, 2026-10-26).
4. **The reftable probe is shared**: `reftableUnsupported` moved from `test/watcher/committed-add.test.ts` to a new `test/hash/reftable.ts`, which both tests import. A new file, so no shared helper changed.

## Tests

- `test/state/revision-commit.test.ts`, "a quiet reconciliation pass records HEAD's move (task 001-406)":
  - The case "runs git status only when HEAD moved, and records the move once" runs twice: `HEAD` from the git dir files, and from git when the git dir reader gives `null`. The second is the done-when. Red before slice 1's source change: Squeal's run at revision 5 failed it at `expect(heads).toBe(0)`, `expected 1 to be +0` (the pass ran `git status` while `HEAD` stayed). Green at revision 6 (`FAIL -> PASS`).
  - New: "records no move while HEAD stays in a reftable repository, and the commit after". Skipped where `git init --ref-format=reftable` fails. This host has Git 2.43.0, so it was skipped here and is **unverified on a real reftable store**, as 011-201's case is.
- `test/watcher/committed-add.test.ts`: the mock moved from `readGitHead` to `gitDirOf` (decision 2), with the assertion. The reftable case uses the shared probe.

## Evidence

- `npm run lint`: `Checked 2227 files in 708ms. No fixes applied.`
- `npm run typecheck` (`tsc --noEmit`): exit 0, no output.
- `squeal status --wait 60000 test/watcher/committed-add.test.ts test/state/revision-commit.test.ts` at revision 13 (all edits): `Named test files at revision 13: no known failures; 2 test files, each with a current result, after 1.6 s.`
- `squeal status --wait 60000` on the changed paths at revision 13: 36 test files current, all pass (`test/cli/stop-mark.test.ts` and `test/harness/stopped.test.ts` among them); 683 queued for Squeal's catch-up, which waits 120 s of quiet.
- At revision 14 (this notes file only), Squeal's selection found no test file for the changed source paths ("no test file's closure holds src/core/status/git-head.ts", and so on for each), the gap row 011-233 names. So the test files were named:
  - The watcher and delivery tests, `squeal status --wait 60000 test/watcher/*.test.ts test/delivery/*.test.ts`: `Named test files at revision 14: no known failures; 58 test files, each with a current result, after 15.1 s.`
  - Every test file that imports a changed module directly (`grep` for `status/git-head`, `watcher/candidates`, `watcher/change-feed`, `watcher/index`, `scheduler/head-move`, `daemon-loop/head`, `daemon-loop/index`, `delivery/stopped`, `hash/reftable`; `test/e2e` left out): `Named test files at revision 14: no known failures; 38 test files, each with a current result, after 49.4 s.` They include `test/scheduler/daemon-loop.test.ts`, `test/code/pass/daemon-loop.test.ts` and the scheduler tests that read `readHead`.
  - None of the 57 test files Squeal never ran here (lookup-only baseline) imports a changed module directly, so no direct run was needed.
- Worktree-wide at revision 14, catch-up still running: `Affected checks: 9622 passed (8563 tests, 1059 test files loaded), 8 running, 55 queued, 11 skipped`; known failures 4, all the drift below. The final count is in the worker's report.
- Expected drift, 4 tests: the bundle checks of `test/harness/plugin.test.ts`, `test/harness/codex/plugin.test.ts`, `test/harness/opencode/package.test.ts` and `test/harness/pi/package.test.ts` fail with `cli/squeal.mjs differs from the build`. This row does not own the bundles and ran no build; the integration rebuilds them.
- `squeal code --told` lists `reftableUnsupported` (`test/hash/reftable.ts`) as reached by no in-process test. Both changed test files call it when they load; the note is about how coverage is recorded for a test helper, not dead code.

## Limits and leads

- Status's `HEAD` (`statusIdentity`, `src/core/status/identity.ts:34`) still reads `readGitHead` alone, by design (synchronous, no spawn). In a reftable repository its `live` is `null`, so status shows the recorded `HEAD` and cannot say that `HEAD` moved since the revision until a pass records the move. The idle pass now records it within one pass.
- Cost: where the git dir reader gives `null`, the idle pass spawns one `rev-parse` (011-199's benches put a `git diff` spawn at about 5 ms; `rev-parse` does less). That includes an ordinary repository whose `HEAD` is unborn, where the pass spawned nothing before. Where `HEAD` resolves from files, nothing new is spawned, and a revision spawns one fewer.
- A CI job on Git 2.45 or later would run both reftable cases.
