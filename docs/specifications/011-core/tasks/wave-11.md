# Wave 11 of spec 011

Three quality rows from `quality/2026-10.md`, on disjoint seams, in parallel. Each starts from main after 0.1.253 lands. 005-76 is a spec 005 row; its brief is here so that the wave has one file.

## W1: 011-101, one repository for `squeal failures`

Use /worker. Shape: slice.

Outcome: the dead `ResultRepo` failure queries are gone, and `ResultRepo` and `FailureRepo` share one `toResult`.

Read board row 011-101, the quality file's row text, and 011-64 section 4 on the key-format alarm.

Seam: `src/core/store/repos/results.ts:99-114` and `:184-209`. A lead: move `toResult` into `src/core/store/codec.ts` first, import it in both repositories, then delete `listFailures`, `countFailures`, `FAILURE_WHERE`, `failureParams` and `FailureFilter` (`src/core/types/store.ts`).

Owns: `src/core/store/repos/results.ts`, `src/core/store/repos/failures.ts`, `src/core/store/codec.ts`, `src/core/types/store.ts`, their tests. Not yours: the slot and connection code (W2), `src/harness/` and `plugins/` (W3), the board, spec text, bundles, version.

Done when: the row's done-when holds; `test/keys/key-format.test.ts` reports no differing output and `KEY_FORMAT_VERSION` is unchanged; lint, typecheck and `squeal run --all --wait` pass, their output in your summary.

## W2: 011-102, the workarounds for Node below 22.19

Use /worker. Shape: survey, then repair.

Outcome: the permit read and the rollback use the Node 22.19 API where 22.19 has it, and each remaining workaround names the version that needs it.

Read board row 011-102 and `status.md` (011), the 2026-10-21 wave 8 line.

Seam: `heldPermits` and `permitRecord` in `src/core/slow/slot.ts:150-203`, and `rollback` in `src/core/store/connection.ts:156-168`. There is no Node 22.19 on this host and no container runtime. Do not install one. The probe has two parts. First, the Node changelogs from 22.13 to 22.19 (`node:sqlite` URL paths and `immutable`, `isTransaction`), cited in `tasks/011-102/notes.md`. Second, CI's `node22` job, which runs v22.19 on the coordinator's candidate. So make each change its own commit, with a unit test that exercises the new path on Node 22. If CI fails one, the coordinator reverts that commit. Put the comment text that would replace it in the notes.

Owns: `src/core/slow/slot.ts`, `src/core/store/connection.ts`, `test/slow/slot-holders.test.ts`, `test/status/slot-holders.test.ts`, `test/store/opening.test.ts`, the notes. Not yours: the recorders under `src/runners/`, W1's and W3's files, the board, spec text, bundles, version.

Done when: the row's done-when holds, except "CI's Node 22 shards are green", which the coordinator checks on the candidate; lint, typecheck and `squeal run --all --wait` pass, their output in your summary.

## W3: 005-76, the launcher has one source

Use /worker. Shape: slice.

Outcome: `plugins/claude-code/bin/squeal-launcher` is the only launcher anyone edits, and the build writes the other three.

Read board row 005-76, spec 005 D3 on the launcher, and `buildPlugin` in `src/harness/build.ts:211-219`.

Seam: the `copies` entries in `src/harness/codex/build.ts:26` and `src/harness/pi/build.ts:24`. Two traps. The OpenCode build calls `writePluginVersions` itself (`src/harness/opencode/build.ts:83`), so `copies` does not reach it: copy there too. And the Claude Code build must get no entry, because `buildPlugin` removes the target before it copies. Check that `cpSync` keeps mode 0755, and set it if not.

Owns: `src/harness/build.ts`, `src/harness/{codex,pi,opencode}/build.ts`, `.github/workflows/ci.yml`'s two `Bundles match the build` steps, `test/cli/launcher.test.ts`, `test/harness/opencode/package.test.ts`, a build test of the copy. Not yours: the launcher's text, `install.sh`, W1's and W2's files, the board, spec text, bundles, version. Do not run `npm run build` or `npm run build:plugin` in your tree: a rebuilt bundle there makes the worker's destroy fail. Prove the copy with a test that runs the copy step into a temporary directory. The coordinator runs the build at integration.

Done when: the row's done-when holds, except the `npm run build:plugin` run, which the coordinator does; lint, typecheck and `squeal run --all --wait` pass, their output in your summary.

## R1: review of cand/0.1.254

Use /reviewer. Shape: review. Pinned to the `cand/0.1.254` SHA named in the spawn; the range is `origin/main..<sha>`: W1 (011-101, two commits from `cez/02c7e199`), W2 (011-102, three from `cez/5721e776`), W3 (005-76, one from `cez/205eb9a9`), the release commit (0.1.254, bundles) and one `status.md` commit.

Read W1 to W3 above, `tasks/011-101/notes.md`, `tasks/011-102/notes.md`, board rows 011-101, 011-102, 005-76 and 011-105, and `tasks/011-64/design.md` section 4. Check that:
- 011-101: one `toResult` serves both repositories and reads every column as before; the five unused names stay, as decided, and `key-format.test.ts` passes with `KEY_FORMAT_VERSION` unchanged;
- 011-102: `heldPermits` reads a held permit without a copy and without writing to the permit's directory, also while its holder writes; the Node 22.15 and 22.16 claims in the notes match their sources; `rollback`'s code is unchanged; CI's Node 22 shards run v22.19.x and pass the slot-holder tests;
- 005-76: the build writes the three launcher copies from the Claude Code source with mode 0755, the Claude Code build has no copy entry, and CI's drift step fails a hand edit to a copy;
- the version is raised in all eight places and the bundles match the tree.

Run `npm ci`, then `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` once in the candidate tree. A file that fails loaded and passes alone is named; row 011-99 lists the known load-flaky files. Write `reviews/0.1.254.md` with a PASS or FAIL verdict and commit it.
