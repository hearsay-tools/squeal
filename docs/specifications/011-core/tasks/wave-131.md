# Wave 131: repair the causes of the intermittent CI failures (rows 011-429 to 011-435)

The human, 2026-11-27 (coordinator 9d95aa57, decision card on row 011-428): all seven repairs ("1 and 2", "4 and 7", "3", "5 and 6") and the boat.dev experiment ("Yes, run it"). Findings: `specifications/011-core/research/ci-flake-census.md` (groups G1 to G7). Goal: fewer CI re-runs before a release. A repair that only raises a time limit is out of scope.

Two candidates: A = 011-429 to 011-432 (tests, CI, the store process's start order); B = 011-433 and 011-434 (product behaviour). 011-435 is research. Rows run in parallel.

## Rules for every code row

- Read `docs/styleguide.md`, the findings file's section for your group, and the sources it names. The findings name files and lines at `5fca81f09`.
- Owns only the files listed. A file another row owns is left alone; if you need a change there, name it in your final message. Row 011-431 may change only the clean-up lines of other rows' test files.
- Done when: each changed test shows the old failure cannot recur, by reading (no wall-time or first-sign check remains) or by a test that forces the bad order and fails before the fix. `pnpm run lint`, `pnpm run typecheck`, and `squeal status --wait 60000 <changed-path>...` read and reported. A direct `vitest run` names its files and runs under `timeout 600`. No loops of repeated runs on this host, no build, no full suite. Commits on your branch. Not `docs/board.md`, `package.json`, `plugins/*/dist`, `spec.md`.
- Final message: per changed file, the old check and the new one; decisions the findings did not settle.

## 011-429 (G1, time checks on a shared runner; worker, slice)

Replace each fixed time bound in G1's files with a check on counted work, event order or an injected clock the code already accepts. Files: those in the findings' G1 paragraph (`writer-turns`, `chain-load`, `keep-early`, `busy-requests`, `departure`, `backlog-slots`, `prune-vacuum`, `ci-map-client-clock`, `graph-cost`, `retry/records`, `not-current`, `why-unknown-standing`, `status-paths`, `status-at-now-daemon`, `warmup`, `status-wait-paused`, `run-group`, `stop-slow-wait`, `stop-group-mixed`, `environment-growth-siblings`, `slow-node-test`), and `test/code/coverage/turns.ts`, `test/code/pass/turns.ts`. A bound that measures product speed and has no other check is removed and named in the final message with the `bench/` cell it belongs in; do not edit `bench/`. Not `test/daemon/helpers.ts` (011-431; name the `LOADED` gate change you want there). Use /worker.

## 011-430 (G2, state read too early; worker, slice)

Wait for the finished state, not its first sign. Product: in `src/cli/store-process.ts` and `src/core/store-process/server.ts`, the SIGTERM handler is registered before `store process: serving` is written; a test forces SIGTERM right after the line and finds the `stopping` line. Tests: `test/store-process/logs.test.ts`, `test/harness/hand-off.test.ts` (marker written by temp file and rename), the pyrun `test_hang.py` fixture (pid written whole), `test/cli/stop-at.test.ts` (wait for the child's exit), `test/daemon/handover.test.ts`, `test/daemon/handover-gap.test.ts` and the keeper tests (re-read `/proc/locks`), `test/code/store.test.ts` (busy timeout), `seed-failed`, `group-lanes-moments`, `tier-yields-overrun` (settle on the row write). `optimizer-start` stays out; `scratch-children` only if its line is decided. Use /worker.

## 011-431 (G3, folder removed while a process writes; worker, slice)

One test-fixture scratch folder that awaits its process groups (`test/helpers/process-groups.ts` `awaitGroups`), then removes the tree (`test/helpers/remove-tree.ts`); it replaces `runtimeDir`, `tempDir` and the 11 `maxRetries` helpers (findings G3). Owns those helpers, `test/harness/bundle-helpers.ts`, `test/daemon/helpers.ts` (with `stopStrays`, and the `LOADED` gate scaled by CPU count), and the clean-up lines of about 14 call sites. Use /worker.

## 011-432 (G4 and G7, small; worker, repair)

G4: `test/runners/node-test/run.test.ts` premise asserts `signalled`; `test/runners/node-test/fixtures.test.ts:206` accepts a SIGTERM `test:complete` for the busy loop. G7: in `.github/workflows/ci.yml`, one step before Test fills all four e2e install recipe kinds, and `test/e2e/install.ts` joins the cache key; show with `actionlint` or the workflow's own lint if present. Owns those three files. Use /worker.

## 011-433 (G5, a slow machine loses owed news; worker, product slice)

A Pi or OpenCode wait that ends empty without a cancel re-arms, a bounded number of times (row 009-30 step 2, never built). Read `specifications/009-pi-adapter/research/idle-wake-not-armed.md`, `specifications/011-core/research/ci-opencode-continued.md`, row 009-30. Owns `src/harness/pi/extension.ts`, `src/harness/opencode/turns.ts`, `src/harness/opencode/hooks.ts` and their unit tests. Test: a wait whose first deadline passes empty still delivers the PASS -> FAIL that arrives after it; a cancelled wait does not re-arm. The Pi `tool_call` gate's 2 s miss (row ci-43528167215) and the 1 s busy-store silence are named, not changed, unless the same re-arm covers them. Final message: the spec 008 and 009 text this changes. Use /worker.

## 011-434 (G6, two successors for one handover; worker, product repair)

`handOver` reports "claimed" only after the claim is stored (`src/harness/shared/ensure.ts:198-199`); or `squeal start` finds a live lock waiter before it spawns one (`src/cli/start.ts:303-326`); pick the smaller and say why. Test first: a forced throw in the claim write leaves exactly one `--await-lock` successor. Owns those two files and their tests. Use /worker.

## 011-435 (fewer Vitest workers per CI shard; research)

On one boat.dev sandbox of 4 vCPUs (GitHub's runner size), run one Node 22 shard as `scripts/ci-shard.mjs` runs it, with the default workers and with `--maxWorkers=2`, alternating, at least three pairs. Report per run: duration, failed tests, and which G1 files failed. Cost under about $5; stop at the budget. Writes `specifications/011-core/research/ci-shard-workers.md` and `research/probes/ci-shard-workers/`. No repo edits beside those. Read `~/projects/notes/topics/boat-dev.md` first. Use /researcher.
