# Wave 87: row 011-336 (tests wait for their writers before they remove a folder)

Coordinator cdd216e5, 2026-11-14. The human approved the tests-only row from `research/enotempty-cleanup.md` (row 011-333) on 2026-11-14 ("Approve the row"). Tests only: no product code, no version raise, no bundle change.

Host policy, as in `wave-85.md`. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version, any file under `src/`.

## W1: row 011-336

Use /worker. Shape: repair, test first.

Outcome: the node:test run test and the OpenCode dispose test remove their folders without `ENOTEMPTY` on Node 22, 24 and 26, because the removal repeats as a whole or waits for the processes that still write there.

Read: `research/enotempty-cleanup.md` (all of it: findings 1 to 3 and the recommendation); its probes under `research/probes/enotempty-cleanup/`; board rows 011-333, ci-43472769648 and ci-43160803419.

Steps, one commit each:

1. **`removeTree(dir, { timeoutMs })`** in `test/helpers/`: repeats the whole `rmSync(dir, { recursive: true, force: true })` until the folder is gone, or fails at the deadline and names what is left. A unit test with a second process that keeps adding files for a short time, as `rmsync-retry.mjs` does, passes on the Node it runs on.
2. **node:test run test** (`test/runners/node-test/run.test.ts:257`): rename the checkout away in one step (`renameSync`), so it disappears at once, which is the test's subject; remove the renamed folder with `removeTree` once the run has ended.
3. **OpenCode helper** (`test/harness/opencode/real.ts`, `runOpenCode` and its cleanup): before the folder is removed, wait for the plugin's bridge processes (`<built dir>/hooks/*.mjs`, started with `detached: true`), with a deadline, and kill them after it, as `stopStrays` and `awaitRunnerHosts` in `test/daemon/helpers.ts` do; on the error path, kill OpenCode's process group and wait for it before the removal; `removeTree` last.

The eight other test files that pass `maxRetries` to `rmSync` (listed in the research) keep it; name them in your notes as candidates for the helper.

Owns: the new helper and its test under `test/helpers/`, `test/runners/node-test/run.test.ts`, `test/harness/opencode/real.ts`, `test/harness/opencode-dispose.test.ts` if it needs the helper.

Leave alone: `src/**`, `test/daemon/helpers.ts` (read it, do not change it), the eight other files.

Done when: the three steps hold; both tests pass several times in a row on the host's Node and, where available, on Node 22 (`nvm`'s Node 22, if installed, through `node_modules/.bin/vitest` directly); lint and typecheck pass; affected results through `squeal status --wait 60000 <paths>`. Notes in `tasks/011-336/notes.md`: what each step changed, the runs and their Node versions, and the eight candidates. CI is the final evidence: a Node 22 shard where both tests pass, then 20 main runs without this `ENOTEMPTY`.

## R1: review of cand/011-336

Use /reviewer (codex gpt-6.1-sol high). Candidate CI: run 43585566919. Pinned to `cand/011-336` at `401fed822c90b6ec0f5a77b49f39686599e85a37`; range `a3d37199e..401fed822`: four commits of worker 398af59b, cherry-picked. Tests only: no product code, no version raise, no bundle change. Read: board rows 011-333 and 011-336, `research/enotempty-cleanup.md`, `tasks/011-336/notes.md`, this file's W1.

Check, each as proven, plausible or unverified:

1. **`removeTree` removes against a live writer** on Node 22 as on 24 and 26 (Node 22.19's `rmSync` retries only the last `rmdir`), fails at its deadline naming what is left, and its test fails without it.
2. **The node:test run test keeps its subject**: the checkout disappears at once during the run (the rename), and the renamed folder is removed only after the run ended.
3. **`runOpenCode`** (`test/helpers/opencode.ts`) kills OpenCode's process group and waits for it before any removal, on the success and the error path; `settle()` waits for the plugin's bridges with a deadline; callers that pass no `settle` behave as before (the notes list them). `test/helpers/process-groups.ts` cannot kill or wait on a process the test did not start.
4. **Scope**: nothing under `src/`; `test/daemon/helpers.ts` unchanged; the eight other `maxRetries` files unchanged.

Host policy as in `wave-85.md`; never the real `HOME`. Write `reviews/011-336.md` and commit it on your branch.
