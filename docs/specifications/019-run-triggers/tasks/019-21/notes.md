# 019-21 notes: commit lint evidence needs the committed config (review 0.1.396 B2, S3)

Worker 9d2bed9d, 2026-11-03. Commits `aad497513` (the lint pass records its key inputs) and `27618c344` (the commit report reads them; S3).

## What changed

- `src/core/lint/pass/keys.ts`: `keyInputs(basis, blobOf)` gives `KeyInputs`: each config file and closure file with the blob the keys read (`null` for no file), and `installed` (the keys hold the install fingerprint: the config loaded a package). `lintKey` and `environmentOf` read the same path list (`configInputs`), so no key and no environment hash changes.
- `src/core/lint/pass/records.ts`: the record `lint-inputs:<scope>` (`LintInputs`: `KeyInputs` plus the cursor's `environment`), `readInputs`, `writeInputs` (writes only a changed value), and `forgetRecords` deletes it.
- `src/core/lint/pass/rekey.ts`: one `writeInputs` in the keying transaction, beside `writeCursor`, with `plan.environment`. Agreed with the coordinator on 2026-11-03 (request 32a8a999): these two files joined the row's ownership for this write.
- `src/core/commit/lint.ts`: `LintView.inputs(state)`; `lintCounts(view, side)` with `CommitSide` (`committed`, `differing`, `environment`). A check counts only when its tool's record exists, its `environment` equals the cursor's, and each recorded blob is the commit's (a `null` blob equals a path the commit lacks). Keys with `installed` also need no differing environment input. A pending check is running only under the same condition. `readLintCounts(commonDir, lint, worktreeId, side)`.
- `src/core/commit/compute.ts`: `environmentDiffers(view, differing)`; `deletedTestFiles(view, committed)`; `testCounts(view, differing, deleted)` counts each deleted test file in `files` and `notDetermined`. `CommitView` gained `knownTestFile(ref)` and `onDisk(path)`.
- `src/core/scheduler/head-move.ts`: builds the side, calls `deletedTestFiles`; the view's `knownTestFile` is `store.testFiles.get(ref) !== null`, `onDisk` is an `lstat`.

## Why the record is sound evidence

- A non-pending, non-stale, judged lint state was keyed under the environment of its tool's cursor. One pass uses one `Keyer`: the keying transaction writes the cursor (and now the record) from it, and the pass's lint parts write results under the same keyer. An edit keying requires an unchanged environment, and the environment hash holds every config and closure blob, so the record's blobs hold for states keyed at earlier edit keyings too. A config keying that the provider refuses makes its candidates `unknown` and keeps the cursor: those are not counted.
- The record is compared with the commit, never with the working tree: a config edit not yet linted still counts against the commit that holds the old config (tested).
- An older daemon (before 019-21) moves the cursor without the record: the record's `environment` then differs from the cursor's, so it is no evidence. A store with no record (the first report after an upgrade, before any edit keying) reports lint as not determined until the next keying writes it.

## Decisions the spec did not settle (my choices)

1. `installed`: the install fingerprint (011 C11) is read from the installed lockfile and `patches/`; `.pnp.cjs`, `bun.lock` and `patches/*` are committed files. When the keys hold it and any differing path is an environment input of the worktree's tests (`isEnvironmentInput`, which covers installed lockfiles and patches but also runner files), lint is not determined. This is conservative: a lint config that loads packages and an unstaged `vitest.config.ts` together make lint not determined.
2. Tool, provider and Node versions and keyed variables are the machine's, not the commit's; they are not compared.
3. A recorded input the commit does not hold but the key read as a file (a git-ignored file in the config's closure) is not determined: the commit says nothing of it.
4. S3: "a test file of the commit" is a committed path that `test_files` (repository-wide, never pruned) holds for one of the projects the worktree lists now, that no listed test file has, and that has no file in the working tree (the stat cache's known absence, else `lstat`). The report counts it in `files` and `notDetermined`.

## Known limits

- S3 needs at least one listed test file of the same project, and Squeal must have resolved the deleted file's closure once (in any worktree of the repository). A test file added and deleted while no daemon ran is not seen.
- S3 asks `test_files` once per committed path that is not listed and has no blob in the stat cache (absent or untracked). In a 50,000-file repository that is up to 50,000 primary-key lookups per `HEAD` move; measured cost not taken.
- Review S2 (no completion update of a stored report) is untouched: 019-16 and the commit-group trigger own it.

## Tests

- `test/commit/lint.test.ts`: unit cases for a record at another config blob, no record, a `null` blob, `installed` with an environment input; through `readLintCounts` from a store, a cursor moved without a record; through the real lint pass (`FakeProvider`, `FakeWorktree` with real git commits): an unchanged config counts, a config edit not yet linted still counts, a rule change left unstaged and linted is not determined, the config committed counts again; a store without the record is not determined.
- `test/commit/compute.test.ts`: `deletedTestFiles` (known absent, untracked and looked up on disk, still on disk, at another blob, listed, unknown path, the listed project).
- `test/scheduler/commit-report.test.ts`: the lint case writes the record as the pass does and adds the unstaged rule change; the S3 case deletes `test/b.test.ts` unstaged, the runner lists only `a`, and the report counts `b` as not determined.
