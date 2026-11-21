# 018-60 notes: `ci record` ignores an inherited `SQUEAL_CI_NODE_TEST_FILE`

Repair of review `reviews/0.1.580.md` S1 (the decision 018-54's notes left open: "ci record does not clear an inherited `SQUEAL_CI_NODE_TEST_FILE`"). Wave 21.

## Seam map

- **The env each recording builds** is the only change: `commandEnv`'s merge in `startRecording` (`src/runners/vitest/ci-record.ts`) and `aloneEnv` (`src/runners/node-test/ci-record.ts`). Each drops `SQUEAL_CI_NODE_TEST_FILE` and `SQUEAL_CI_NODE_TEST_PROCESS` from the env of the command it starts. `startFor` (`src/cli/ci.ts`, row 018-61's) only spreads `addition.env` (the reporter variable) over the vitest recording's env, so the strip survives composition; the "command runs unchanged" path still passes the caller's env untouched.
- The names are defined in both files (a runner folder may not import another's, `test/runners/boundaries.test.ts`): exported as `NODE_TEST_FILE_VARIABLE` / `NODE_TEST_PROCESS_VARIABLE` from node-test's, private in vitest's, matching the literals in `node-test-ci.cjs`.
- Everything downstream is untouched: the hook still sets both in a test file's process (D24 rule 1), `children.cjs` still carries them into an env of the caller's own (D24.2), and the reporter and `vitest-ci.cjs` still trust them there. Only the inheritance across a recording boundary is gone.

## Decisions the brief did not settle

1. **`NODE_TEST_CONTEXT` stays (coordinator, this wave).** A test that starts another `ci record` around a `node --test` command still records nothing: the inner `node --test` inherits `NODE_TEST_CONTEXT` from the outer test file process and Node itself skips the files ("node:test run() is being called recursively within a test file. skipping running files.", verified with `NODE_TEST_CONTEXT=1 node --test` on Node 26). Stripping it would change what the command does (D8, D22 fidelity), so the row keeps to the two `SQUEAL_CI_` markers. An inner `node --test` inside a node:test test is skipped by Node, not by Squeal.
2. **The same leak leaves one empty node:test part in an inner recording** (observed, not fixed): with `NODE_TEST_CONTEXT` inherited, the node:test CI hook's rule 1 (`node-test-ci.cjs:78`) reads a Vitest CLI process of that command as a test file process and writes a `<graph>/<pid>.json` for it, so `readNodeTestRuns` adds an empty node:test part and the "names no Squeal reporter" note. Fixing it means either decision 1 or the hook's rule (`src/runners/*/ci-runtime/`, outside this row's ownership); left for a row that takes it.
3. **The inner recording around a Vitest command works** and is the covered case: the markers never reach its command, so its run is a part.

## Test

`test/runners/node-test/ci-record-inherited.test.ts` (under `test/runners/node-test/`, already selected by `test/version-sensitive.txt`):

1. node:test alone (`tsx`): both markers set in the env `ci record` runs with → the part is written. Before: zero parts.
2. Both runners, one command: both markers set in the outer env → both parts written, export keeps both files. Before: "no Vitest run in this command: nothing recorded", zero parts — review S1's reproduction.
3. A node:test test starts another `ci record` around `vitest run`: the inner recording writes its own Vitest part; the outer command keeps its two parts; the export leaves every file of the outer command out (the withholding is the recording's, review of 018-23 B2) and writes nothing. Before: `inner-parts` never written.

Red before, green after, all three (the stash trick for 3: the run holds while the src fix is stashed).

## Checks

- `timeout 600 pnpm exec vitest run test/runners/node-test/ci-record-inherited.test.ts --maxWorkers=1` → 3 passed.
- `timeout 900 pnpm exec vitest run test/runners/node-test/ci-record-nested.test.ts test/runners/vitest/ci-record-nested.test.ts --maxWorkers=1` → 2 files, 8 tests passed (rows 018-27 and 018-54 still green).
- `timeout 900 pnpm exec vitest run test/runners/node-test/ci-record.test.ts test/runners/vitest/ci-record.test.ts test/runners/boundaries.test.ts test/cli/ci-record.test.ts --maxWorkers=1` → 4 files, 15 tests passed.
- `squeal status --wait 60000 <the three changed paths>`: revision 0, no daemon running in this worktree, no affected verdict — the direct targeted runs above are the evidence, per CLAUDE.md.
- `pnpm run typecheck` → exit 0. `pnpm run lint` fails only on `test/ci/endpoints.test.ts` (`__proto__` findings, commit `4bcee3d3d` of row 018-57, pre-existing on this branch base, 018-61's area); my three files pass `biome check` clean.

No type changes. No bundle owned (`plugins/claude-code/dist` not rebuilt; no file under it changed).
