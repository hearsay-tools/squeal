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
