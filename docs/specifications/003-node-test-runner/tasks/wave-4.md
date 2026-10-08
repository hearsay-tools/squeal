# 003 wave 4 briefs

Two rows in parallel on disjoint files, beside 004-12 (scheduler). Read `docs/vision.md`, `docs/styleguide.md`, spec 003 as amended, `status.md`, and `lessons.md` (the 003-19 dogfooding) first. Do not run `npm run build`; the coordinator builds at integration. Keep scratch in one `/tmp` directory of your own and remove it; no CPU burners; never delete or kill what you did not start. Run the node:test tests on Node 22 and 24 (nvm is installed). Load on this host is high: re-run a failing file alone before calling the failure yours.

## 003-36 the agent is told node:test is covered

Outcome: with `nodeTest` projects configured, the primer and the skill tell the agent Squeal runs those tests too, and `squeal init`'s printed template never collides with an entry it seeded.

Read: `lessons.md` defects 1 and 7; spec 003 goal 8; `reviews/wave-2.md` N1.

Shape: slice. Test first. Seam: `src/harness/shared/primer.ts:15`, the sentence "Squeal runs this repository's Vitest tests [...]; do not run Vitest [...]": name the runners the loaded policy configures (Vitest alone without `nodeTest`, both with it); find how both harnesses build the primer and give it what it needs. Then the skill, identical by hand in `plugins/claude-code/skills/squeal/SKILL.md` and `plugins/codex/skills/squeal/SKILL.md` (lines 3, 8, 12, 16): static text, so it names node:test as covered where `squeal.config.json` lists `nodeTest` projects. Then `src/cli/init.ts` (seed and templates, about lines 127 to 190) and the seeding it calls: a printed template's name is never a seeded entry's name.

Owns: `src/harness/shared/primer.ts` and its tests, both `SKILL.md`, `src/cli/init.ts` and the node:test seeding it calls, `test/cli/init*`. Leave alone: `plugins/*/skills/squeal/references/**`, `src/cli/run*.ts`, `src/runners/node-test/run/**` (003-37), `src/core/scheduler/**` (004-12). If a recorded hook fixture under `test/harness/recorded/` must change, say so in the report.

Done when: primer tests with and without `nodeTest`; the skill text; an init test whose template name differs from the seed; lint, typecheck, full suite.

Use /worker.

## 003-37 with 004-19: what a test file's process loads belongs to that file

Outcome: a module loaded through `createRequire(<non-module>)`, or by a process the test spawns, joins that test file's observed closure instead of the project's preloads; a slow node:test project's spawned processes are recorded; a closure that reaches nothing beyond the file names itself in a note.

Read: `lessons.md` defects 3 and 6; `docs/specifications/004-slow-suites/tasks/004-13/notes.md` (why a spawned CLI is not observed, three places); spec 003 D3, D5; spec 004 D5's recorder sentence; `test/integration/slow-spawn.test.ts`, which pins today's gap.

Shape: slice. Test first. Seam: `observedClosure` in `src/runners/node-test/run/observed.ts:33`: an edge whose parent is `null` or not a loaded module is a preload root only when it is one of the process's actual preloads (the `--require`/`--import` the run or its environment passed); otherwise it belongs to the test file, since one process runs one test file. Graph files of the same run from other processes (`graph-<i>-<pid>`) belong to the test file too. Then `childEnv` in `run/run.ts:165`: for a project with `slow: true` (004-10's `nodeTest[].slow`) the recorder always goes into `NODE_OPTIONS`; fast projects unchanged. Then defect 6: one note per project naming files whose observed closure is only the file and a manifest, suggesting `inputs`. Resolving `readFileSync(new URL(<literal>, import.meta.url))` statically: report whether it is a small change; do not build it here. Raise `NODE_TEST_ADAPTER_VERSION` if keys change, and say so.

Owns: `src/runners/node-test/**`, `test/runners/node-test/**`, `test/integration/slow-spawn.test.ts`, new fixtures under `test/fixtures/node-test/`. Leave alone: `src/runners/observe/**` and `src/runners/vitest/**` (001), `src/core/scheduler/**` (004-12), `src/harness/**` and `src/cli/**` (003-36).

Done when: probes as tests (a `createRequire(package.json)` load re-runs only its file; a slow project's spawned CLI helper edit re-runs its file and `slow-spawn.test.ts` flips; a fast project is unchanged); the note test; lint, typecheck, full suite on Node 24 and 22.

Use /worker.
