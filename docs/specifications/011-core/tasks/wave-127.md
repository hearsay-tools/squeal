# Wave 127: a version raise stops re-running 74% of this repository's tests

The human, 2026-11-21 (task c57d5feb, card "Version bump"): "Fix our repository (recommended)". Coordinator c57d5feb. One worker, one candidate `cand/011-425`, no version raise, no key format change. Users see no change.

## Row 011-425 (worker; shape: survey, then slice)

**Outcome.** An edit of only the `version` line of the root `package.json` re-runs the test files that need the real version, not 911 of 2,105.

**Evidence.** `squeal reach package.json` at `c17b74435`: 911 test files, 5,484 of 7,370 recorded seconds; 910 through a runtime read, 1 through a declared input (`test/harness/plugin.test.ts`); 57 such edits from 2026-10-07 to 2026-11-21. Found in `specifications/022-selection-strategy/research/function-selection.md` section 1.

**Cause, as read; confirm it first.** `squealVersion()` (`src/core/daemon/version.ts`) reads the nearest `package.json` named `squeal` when no build defined `__SQUEAL_VERSION__`. Tests run Squeal from source, in the Vitest worker or in a child process, so Squeal's recorder puts `package.json` in their observed reads. Rows 011-85 to 011-90 took own versions out of the installed-packages fingerprint; they did not cover this read (`tasks/011-85/design.md`: "a test that reads one reads a project file").

**Read.** `docs/styleguide.md`; spec 011 C3 and C4 on observed reads; `tasks/011-85/design.md`; `src/core/daemon/version.ts`; `vitest.config.ts`; `test/global-teardown.ts`; the helpers under `test/` that start a daemon or the CLI.

**Step 1, survey (write `tasks/011-425/notes.md`).** From a store copy (`VACUUM INTO`, read-only, into `$TMPDIR`) or `squeal reach`, sort the 910 files by how the read happens: `squealVersion()` in the worker, `squealVersion()` in a child process, another reader of `package.json` (Node's own `type` lookup, a build, a test's own read), several. Count files and recorded seconds per kind. Name the test files that must see the real version (bundle and plugin version checks, release files, `test/harness/plugin.test.ts`).

**Step 2, slice.** Lead: a Vitest `define` of `__SQUEAL_VERSION__` to a fixed test version removes the read in the worker with no product change. For child processes, prefer a seam in test helpers. If the survey shows that the saving needs a change under `src/` (for example an environment override that `squealVersion()` honours), stop and ask the coordinator with the counts for each choice before writing it: a version override in product code is a decision. Tests that need the real version read it on purpose and keep the dependency.

**Owns.** `vitest.config.ts`, files under `test/`, `squeal.config.json` if a declared input is the right record, `specifications/011-core/tasks/011-425/`. Not `docs/board.md`, not `package.json`'s version, not `src/` without the coordinator's answer.

**Done when.**
- A probe on a copy of this tree shows the count of test files a version-only edit of `package.json` re-keys, before and after; the notes hold both numbers and the command.
- Every test that asserts the real version still fails when the version it reads is wrong (show one such failure in the notes).
- `pnpm run lint`, `pnpm run typecheck` and `squeal status --wait 60000 <changed-path>...` are read and reported. The config change re-keys the suite once; do not run the full suite to compensate. Any direct `vitest run` names its files and has a `timeout`.
- One commit on the worker branch; the final message gives the before and after counts first.
