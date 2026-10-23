# 011-134: `retry` on a test file the daemon has not listed yet (gh-76)

Worker W1 of wave 22, 2026-10-23, from main e81754965. Design accepted by coordinator 04a258b0 (reply to request 356105ac): the default below, no daemon protocol.

## The row's first question

Can the CLI test a path against the configured test patterns without the daemon? Partly.

- **node:test and pytest: yes, exactly.** Their `include`, `exclude` and `cwd` are in `squeal.config.json`. The CLI reads them with `readPolicy` and matches them as the adapters do (`createInputMatcher` on the path from the project's `cwd`; `src/runners/node-test/adapter-files.ts:22`, `src/runners/pytest/adapter-files.ts:43`). Read in source code.
- **Vitest: no.** Only Vitest resolves its `include`, `exclude`, `dir` and projects from the config module. The daemon stores no pattern in the store (no `meta` key holds one; read in source code). `squeal setup` reads the root config's `include` literals as text (`src/cli/setup/repo.ts`, `listTestFiles`, source `config-text`). That misses gh-76's own case: in cezarion the e2e file belongs to a Vitest project named by a file in the root config's `projects` (`./packages/web/e2e/vitest.config.ts`; read in `/home/agent/projects/cezar/vitest.config.ts`).
- **011-63's named selection** (`selectNamedFiles`, `src/cli/status-wait-paths.ts:96`) matches the listed key rows and stored closures, not patterns. It is no pattern reader. Its wait does sync with the daemon first (the `sync` pass), so `status --wait <file>` finds a file written just before it: that is why the reply names it.

An exact Vitest check needs the live daemon: a protocol message answered with Vitest's `TestProject.matchesTestGlob`. Not done here: it is daemon and protocol code, outside this row (coordinator, 2026-10-23).

## What was built

`notKeyed` moved from `src/cli/retry.ts` to `src/cli/retry-unlisted.ts` (retry.ts stays at about 300 lines). A path with no key, after the failed-global-setup case (001-382) as before:

1. **No file there:** `Not retried: <path> does not exist in this worktree.` Exit 1.
2. **A file that a runner built here may list** (`mayList`), **and no listed revision holds its current content** (`unkeyedPath`): `Not listed yet: <path> has no key because <clause>, so it has nothing to retry; a new test file is queued once its revision is listed, without a retry. squeal status --wait 60000 <path as given> waits for that listing and its result.` Exit 3. Nothing is stored and no daemon is told.
3. **Otherwise:** the old `Not retried: <path> is not a test file Squeal has keyed in this worktree.` Exit 1.

Exit status over several paths: 1 when any was refused, else 3 when any is not listed yet, else 0. Usage errors stay 2.

`mayList`: a node:test or pytest project's `include` minus `exclude` from its `cwd`; or, when Vitest is built (no node:test or pytest project, or `vitestDetected`), any file policy `vitest.exclude` does not drop.

"No listed revision holds it": the daemon has not listed the worktree's test files (`testFilesListed` false), or the file's ctime is after both the newest listed revision's `createdAt` (the refined revision while the runner part is pending, else the newest) and the start time of the daemon that finished its start scan (`bootstrappedMetaKey`, which covers revision 0, which has no revision row). With neither time known, the file reads as listed: the old refusal.

The clause names the revision:

- runner part pending: `revision N is not listed yet` (N the newest);
- the file changed after the newest listed revision: `it changed after revision N, the newest the daemon listed` (gh-76's case: revision 0, the daemon had not recorded the change);
- nothing listed: `the daemon has not listed this worktree's test files yet`.

The command's path goes through `shellWord` from `src/core/delivery/index.js`. W2 moves that function to `src/core/text.ts`; the import in `src/cli/retry-unlisted.ts` and in `test/cli/retry-unlisted.test.ts` moves with it. The test builds its expected command with `shellWord` too, so it pins no quoting rule.

## Known limits

- **The Vitest check is a heuristic:** a file exists and policy `vitest.exclude` does not drop it. So an existing non-test file whose newest edit is not listed yet (a source file just written or edited, retried by mistake) reads "not listed yet" until the listing; after it, the old refusal. The named wait the reply prints then says no path selects a test file.
- A file whose ctime moves with no content change (`touch`, `chmod`) makes no revision, so it reads "not listed yet" until the next listed revision.
- A gitignored file just written reads the same until the next listed revision.
- The existing `waitText` in `retry.ts` names the root-relative path, not the path as given (pre-existing; from a subdirectory that command resolves wrong). Not changed here: its texts are pinned by `retry.test.ts` and `retry-no-reason.test.ts`, and W2 owns the quoting of printed commands.

## Drafted C5 sentence (for the coordinator)

Amended 2026-10-23 (the human, gh-76, digest group B, row 011-134): `squeal retry <file>` given a path with no key answers by what it is. A missing path is refused as missing. A file a runner built here may list, whose current content no listed revision holds yet, is answered `Not listed yet`, naming that revision and `squeal status --wait 60000 <file>`; nothing is queued, since a new test file is queued once its revision is listed, and the command exits 3. Any other path keeps the `not a test file` refusal. "May list" is exact for node:test and pytest projects (their globs in `squeal.config.json`); for Vitest, whose patterns only Vitest reads, it is any file policy `vitest.exclude` keeps, so a non-test file edited since the last listing reads `Not listed yet` until that listing. A file is held by a listed revision when it last changed (its ctime) before that revision was recorded or before the daemon that listed it started. Exit 1 when any path is refused, else 3 when any is not listed yet, else 0.

## Tests

`test/cli/retry-unlisted.test.ts`:

1. a new matching file while revision 4 is not listed: the reply, exit 3, nothing stored; from a subdirectory the command names the path as given;
2. gh-76's case: revision 0 listed by the daemon's start scan, the file written after: "it changed after revision 0";
3. a missing path: its own refusal, exit 1 over another path's 3;
4. a path no pattern selects keeps the refusal before its listing: a pytest-only config (pytest, not node:test, so that `test/version-sensitive.test.ts` does not take the file for a node:test caller; `mayList` reads both alike), and a file `vitest.exclude` drops;
5. a file in a listed revision (ctime before `createdAt`): the old refusal, exit 1.

`test/cli/retry.test.ts`: `src/x.ts`, which does not exist, now gets the missing-path refusal.
