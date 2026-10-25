# Wave 1: the rest of the kit, and three seams

Four rows, in parallel, on disjoint files. The three product rows integrate as one candidate with one version raise, agreed with 011's and 015's coordinators at integration. Workers do not run `npm run build`.

## 016-14 kit scenarios K4 to K9 and the replay

Use /worker. Shape: slice. Outcome: K4 to K9 run through every pack, and the kit fails each of goal 3's three past defects when it is replayed.

Read: `spec.md` goals 1 to 3, D1 (scenarios, variants, determinism); `reviews/016-12.md` "Inputs for the next wave"; `research/runner-kit.md` findings 4 and 6; the driver's `Gap` (`test/kit/driver.ts`).

Starting seam: `test/kit/scenarios/`. First edit: K4, with its precondition that the read path is missing from the static closure.

- Each pack's variants live in its pack (node:test `--import`, `--require` and quoted `NODE_OPTIONS`; pytest `-p` and `conftest.py`).
- A gap is listed with its spec line and the assertions it fails (Vitest's computed `import()`, 011 C12). Fix no adapter. A new defect goes in your final message as a candidate row.
- node:test and pytest keep observations in the adapter until D4 lands. K4 and K5 hold one adapter per scenario.
- Replay on a scratch branch, never pushed: 007-29's shared bytecode cache, 003 wave 2 B1's computed `import()` in a preload, 011 `reviews/0.1.287.md` B1.

Owns: `test/kit/**`; `squeal.config.json` `inputs` entries for `test/kit/**`; `tasks/016-14/replay.md`.

Leave alone: `src/**`, `test/runners/**`, the docs beyond that file.

Done when:
- every scenario is PASS or KNOWN on every runner;
- each replayed defect fails its kit file, recorded in `replay.md` with the commit and the failing line;
- `squeal run --all --wait` is green.

## 016-15 a check knows its runner (row 007-45)

Use /worker. Shape: slice. Outcome: attribution reads the runner stored with each check and never infers it.

Read: `spec.md` goal 4 and D3; board row 007-45; 007 `reviews/wave-5.875.md` B1; 011 C7 (the `user_version` rule); `src/core/delivery/attribution.ts:287-310`; `src/core/store/schema.ts`.

Starting seam: where a check is first recorded in the store. First edit: a test that writes a check with an older daemon's schema, then reads it with the new code.

The store step is one of two. Either a nullable column with no `user_version` raise, or a `meta` map from project to runner. Probe both against an older daemon on the same store. Then send me a request with your pick and the evidence before building it. A `user_version` raise goes to the human, so do not build one.

Owns: `src/core/delivery/attribution.ts`; the store step under `src/core/store/`; the line that records the runner; their tests; `tasks/016-15/notes.md`.

Leave alone: `src/core/scheduler/**` beyond that one line (tell me first: 011 owns it), `src/harness/**`, `src/runners/**`.

Done when: row 007-45's done-when holds, with a test for each part; `squeal run --all --wait` is green.

## 016-16 runner descriptions for `harness/shared`

Use /worker. Shape: slice. Outcome: `src/harness/shared` names no runner. Each runner describes itself, and one registry serves the deny, the primer and coverage.

Read: `spec.md` goal 7 and D5; 005 D8; 011 C8.

Starting seam: `src/harness/shared/primer.ts`. First edit: `src/runners/descriptions.ts` with the Vitest entry, and the primer reads its name from it.

- The test-command parsers (`test-command*.ts`) move to each runner's `describe.ts`, and the pytest environment discovery used at `deny.ts:21` is reached through the registry.
- Do not move node:test's process and recorder helpers. Row 016-20 does that.

Owns: `src/harness/shared/**`; `src/runners/<runner>/describe.ts` (new); `src/runners/descriptions.ts` (new); their tests.

Leave alone: every other file under `src/runners/**`; `src/core/**`.

Done when:
- a test fails if a source file under `src/harness/shared` names a runner;
- the harness suites pass with no assertion changed;
- `squeal run --all --wait` is green.

## 016-20 shared runner helpers out of node:test's folder

Use /worker. Shape: slice. Outcome: no runner's folder imports another runner's folder, so an edit in one re-runs only its own kit file (goal 8).

Read: `spec.md` goal 8; `reviews/016-12.md` B1; `reviews/probes/016-12/key-probe.ts`.

Starting seam: `src/runners/node-test/run/process.ts`. First edit: move `startGroup` and `ProcessExit` to a new folder under `src/runners/` (for example `src/runners/process/`) and point `pytest/run/{run,batches}.ts` at it.

Then do the same for `ownNodeOptions` and `UNOBSERVED` (`node-test/recorders.ts`), and for `holdsRequire` and `quoteNodeOption` (`node-test/run/node-options.ts`). Their importers are `vitest/observe.ts` and `observe/runtime.ts`. No behaviour changes.

Owns: the moved helpers and the new folder; the import lines that change; `test/runners/boundaries.test.ts` (new).

Leave alone: `src/runners/*/describe.ts` and `src/runners/descriptions.ts` (016-16); `test/kit/**`; `src/harness/**`; `src/core/**`.

Done when:
- the boundaries test fails if a file under one runner's folder imports another runner's folder;
- the key probe re-keys only the edited runner's kit file;
- `squeal run --all --wait` is green.

## Review of candidate `cand/0.1.303`

Use /reviewer. Candidate `cand/0.1.303`, pinned to the SHA named in the spawn. The range is `origin/main..<SHA>`. It holds 016-14, 016-20, 016-16 and 016-15 (one cherry-picked range each), one coordinator commit that exempts the registry in `test/runners/boundaries.test.ts`, and the build commit (bundles, version 0.1.303). It has no key-format change. Write `docs/specifications/016-extensions/reviews/0.1.303.md` and commit it on your branch.

Read `spec.md` goals 1 to 4, 7 and 8, D1, D3 and D5 (with the 2026-10-25 store decision); the four briefs above; `tasks/016-15/notes.md`; `tasks/016-14/replay.md`; `reviews/016-12.md`.

Check, with proof where you can:
1. **016-15.** Row 007-45's done-when. An older daemon on the same store opens it, writes NULL runners, prunes as before and fails nothing. The column step runs only while the column is missing. A busy opener fails as during a busy migration, and that happens only once per store. 011's two checks: `test/keys/key-format.test.ts` passes with no version moved, and its edited-constant mutations still fail; the release side's output carries `runner` through the fallback, so the field shows no difference while a real key change still does.
2. **016-16.** No runner name in `src/harness/shared`. The deny, primer and coverage lines say what they said, with no assertion changed. The deny's live-policy read changes no result.
3. **016-20 and the exemption.** No behaviour change. An edit under one runner's folder re-keys only that runner's kit file (`reviews/probes/016-12/key-probe.ts`). The registry may import each runner's `describe.js` and nothing else of a runner's, and no adapter imports it.
4. **016-14.** Each scenario is PASS or KNOWN on every runner, with no sleep and no load dependence. Each listed gap names only the assertions it fails. Replay one defect of `replay.md` and show its kit file fails.
5. The version raise is complete, and the bundles match the build.

Run the independent full suite under the host lock: `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`, and paste the result. Name each failing file and whether it changed in the range. Label every finding as proven, plausible or unverified. Only a proven break blocks. Verdict: PASS or FAIL.

## Re-review of `cand/0.1.303-r2`

Use /reviewer. Narrow re-review of `reviews/0.1.303.md` on `cand/0.1.303-r2`, pinned to the SHA named in the request. The candidate is the reviewed range rebased onto main (docs only moved), one repair commit for B2 (`test/kit/steps.ts`), four for B1 (the 016-15 repair: three code commits, each compiling, and its notes) and a new build commit (bundles, version 0.1.303). Append a section `## Re-review` to `reviews/0.1.303.md` and commit it on your branch.

Check, with proof:
1. **B1.** Replay your probe in both directions (pytest here with Vitest in another worktree, and the reverse) through the tool boundary and a registration: the other worktree's run never changes this worktree's runner sentence. The runner is stored per result row (`results.runner`, added in `columns.ts` with no `user_version` raise); attribution reads it at the key this worktree's failure state holds. A setup check's runner is kept per worktree (meta row `setup-runners:<wt>`). An older daemon on the same store writes NULL there and fails nothing. The scheduler change is the one `ledger.ts` line.
2. **B2.** K8 fails when no run was cut: a cut step asserts that its run reached the marker and was aborted. Replay your early-crash probe.
3. 011's two key-format checks still hold, and the bundles match the build.

Run the full suite under the host lock (the store changed): `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`. Name each failing file and whether it changed in the range. Verdict: PASS or FAIL.

## 016-15 third round (re-review of `cand/0.1.303-r2`, B1)

Use /worker. Shape: repair. The human chose a third round on 2026-10-25. Outcome: attribution reads a runner that each worktree records per project, and no table gains a column.

Read: `reviews/0.1.303.md` (B1 and its Re-review), `reviews/probes/0.1.303/r2-columns.mjs`, `tasks/016-15/notes.md`.

The cause: on Node 22, a statement an older daemon prepared before `ALTER TABLE results ADD COLUMN` returns one field fewer from `all()` after it, so `SELECT r.*, …, f.errors` loses `errors`.

- Drop `results.runner`, `ADDED_COLUMNS` and `columns.ts`; `putMany` loses its runner argument.
- One per-worktree `meta` row, `runners:<wt>`, maps project to runner, written only when it changes. It replaces `setup-runners:<wt>`. `withDependencies` reads the failing check's project there.
- Scheduler: the `store-results.ts` line and the `ledger.ts` line only, in one commit. Each commit compiles.
- A store test fails when any table's columns differ from a committed list at the current `user_version`.

Owns: as before. Done when:
- the collision tests pass in both directions and through both callers;
- the two Node 22 failures pass: `PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH npx vitest run test/daemon/step-down.test.ts test/store/check-runner.test.ts`;
- `squeal run --all --wait` is green, bundle drift excepted.

Decided during the round (2026-10-25, the worker's request): `store-results.ts` stays as on main. The runners are recorded in `Ledger#write`, for the projects of rows, applied results and setups, so a worktree that only looks results up records them too (lookup-only is the default). That one statement replaces the setup line and is the only scheduler diff. A collision case covers a worktree that only looks up its failing result.
