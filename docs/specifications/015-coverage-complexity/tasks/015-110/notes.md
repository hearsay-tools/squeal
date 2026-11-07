# Row 015-110: import from the defining module, not a barrel (worker notes)

Worker 1b02f036, 2026-11-07. Brief: `tasks/wave-28.md`, section 015-110.

## How the change is made

`rewrite-imports.mjs` is the rewrite. It uses TypeScript 6 from `test/fixtures/lint/toolchain` for parsing and module resolution, because the repository's TypeScript 7 has no stable JS API.

- **Barrel:** a module under `src/` or `test/` (not `test/fixtures`) whose statements are only import and export declarations, with one export or more. `src/cli/index.ts` and `test/keys/validity/entries/*.ts` never count.
- **The rewrite:** each name a module re-exports and does not define moves to the module that defines it, from any module, barrel or not. This covers `import { … }`, `export { … } from`, `import()` with destructured names, and `typeof import(…).Name`.
- **Reported, not rewritten:** `vi.mock`, `vi.importActual`, namespace imports, `export *` of a barrel, and `import()` forms it cannot read. It also lists mocks of modules that define code and re-export (`to check`).
- **`--skip <path>`:** leaves a file another row owns as it is. The barrels that file names stay.
- **`--delete`:** removes a barrel that nothing names any more.

Re-run after 015-111 lands (the coordinator):

```sh
node docs/specifications/015-coverage-complexity/tasks/015-110/rewrite-imports.mjs --write --delete
pnpm exec biome check --write $(git diff --name-only --diff-filter=M)
```

Then drop the second override in `biome.json`: the 8 barrels it names go with the re-run. The re-run must report `hand fixes (0)`. A hand fix it reports is a mock or a dynamic import of a barrel in 015-111's new files.

## Barrels left

- **Kept on purpose (first override in `biome.json`).**
  - `src/core/keys/index.ts`: `test/keys/validity/entries/global.ts` re-exports it as the `keys` namespace. The alarm compares that emitted code with the last release. `harness.ts` imports `environmentHash` through it: its module, `keys/environment-hash.ts`, is from v0.1.388, and `compare-refs.ts` bundles the harness against releases back to v0.1.232. `harness/assemble.ts` reads it as a namespace (`observedStartupMetaKey?.`, which is newer than v0.1.313).
  - `src/runners/observe/index.ts`: `test/keys/validity/entries/recorder.ts` re-exports it as the `observe` namespace.
  - `evals/**` keeps its own `lib/index.mjs` barrel. It is outside this row.
- **Until 015-111 lands (second override).** `test/scheduler/helpers.ts`, 015-111's file, still names these: `src/core/{delivery,fs,hash,revision,scheduler,store,types}/index.ts` and `src/runners/vitest/paths.ts`.

The other alarm harness files (`harness/observe.ts`, `reported.ts`, `store-input.ts` and all named imports in `test/keys/validity/**`) now name defining modules. Those modules export the names at every release back to v0.1.232: each changed value import was checked by `git show` at v0.1.232 and v0.1.413.

## Mocks that changed, and what each mocks now

Every mock replaces the same function as before, now at the module that defines it.

| Test file | Was | Now | Replaced names |
|---|---|---|---|
| `test/cli/failures-active.test.ts` | `core/store/index.js` | `core/store/open.js` | `openStore` |
| `test/cli/wait-reads.test.ts` | `core/store/index.js` | `core/store/open.js` | `openStore` |
| `test/daemon/open-recovery.test.ts` | `core/store/index.js` | `core/store/open.js` | `openStore` |
| `test/daemon/open.test.ts` | `core/store/index.js` | `core/store/open.js` | `openStore` |
| `test/presence/registration-order.test.ts` | `core/store/index.js`, `core/fs/index.js` | `core/store/open.js`, `core/fs/git-layout.js` | `openStore`, `linkedWorktreeDir` |
| `test/status/torn-read.test.ts` | `core/store/index.js`, `core/delivery/index.js` | `core/store/open.js`, `core/state/header.js` | `openStore`, `readHeader` |
| `test/harness/register-race.test.ts` | `core/delivery/index.js` | `core/delivery/delivery.js` | `createDelivery` |
| `test/harness/stop-retry-bound.test.ts` | `core/delivery/index.js` | `core/delivery/delivery.js` | `createDelivery` |
| `test/state/revision-commit.test.ts` | `core/fs/index.js` | `core/fs/git-layout.js` | `gitDirOf` |
| `test/watcher/committed-add.test.ts` | `core/fs/index.js` | `core/fs/git-layout.js` | `gitDirOf` |
| `test/scheduler/claims-slow.test.ts` | `core/slow/index.js` | `core/slow/slot.js` | `acquireSlowSlot` |
| `test/scheduler/slow-slot-fair.test.ts` | `core/slow/index.js` | `core/slow/slot.js` | `slowSlotHeld` |
| `test/harness/codex/runtime-update/publication.test.ts` | `runtime-release/index.js`; `adapter/store.js` for both | `runtime-release/release.js`; `adapter/publish.js` and `adapter/store.js` | `prepareRuntimeUpdate`; `publishRuntime`, `runtimeReadiness` |
| `test/runners/pytest/group-lane.test.ts` | `pytest/environment/index.js` | `environment/states.js`, `environment/fingerprint.js` | `syncNote`; `readEnvironmentFiles`, `environmentFingerprint` |

The `importOriginal<typeof import(…)>` and `vi.importActual` paths follow the same targets.

**Discriminating check.** `publication.test.ts` and `group-lane.test.ts` mocked a module that defines code and also re-exports the mocked names. After the script rewrite, their code under test imported those names from the defining modules, so the mocks no longer applied. With the old mock paths, 11 tests fail: `mockImplementationOnce is not a function`, and a path error in the pytest test. With the new paths, all pass.

**Where a mock now reaches more callers.** Before, a barrel mock replaced a name only for the files that imported it through the barrel. Before the rewrite, only `openStore` had callers that imported its defining module directly: `src/cli/remove.ts`, `src/cli/wait-liveness.ts` (`freshRecord`) and `src/core/daemon/ensure.ts` (`recordedDaemon`).

- The `store/open.js` mocks now wrap those callers' stores too.
- A probe found this in `test/cli/wait-reads.test.ts` only: `recordedDaemon` opens 1 or 2 extra stores in two tests (`status --wait <path>` and `status --wait <slow file>`). The counting store records each as a session with no reads. Those tests filter by reads, or check only that no poll reads every state, so their assertions hold.
- In the other store mocks, the wrapper acts only on `checkIntegrity`, on `testFileKeys.list` with files, on `knownStates.list`, or on meta reads behind a trace flag. `recordedDaemon` does none of these.

The other mocked names (`createDelivery`, `readHeader`, `linkedWorktreeDir`, `gitDirOf`, `acquireSlowSlot`, `slowSlotHeld`, `prepareRuntimeUpdate`, `syncNote`, `readEnvironmentFiles`, `environmentFingerprint`) had no direct importer before. Each mock reaches the same callers as before.

There are two exceptions:

- `publishRuntime`: the `publish.js` mock also wraps the call inside `adapter/store.ts` `chooseNew`, the seed copy. That mock passes through until a test sets `mockImplementationOnce`, and the tests call `selectRuntime` before they set it.
- `readEnvironmentFiles` and `environmentFingerprint`: the mock also reaches `environment/index.ts`, which `group-lane.test.ts` does not run.

## Other hand fixes

- `src/core/daemon/daemon.ts` loads the heavy modules late, with one `Promise.all` of `import()` calls. Each entry now names the defining module: `state/sink.js`, `state/fingerprint.js`, `runners/vitest/version.js`, `scheduler/install.js`, `code/pass/source.js`, `code/crap/sink.js`, `hash/git-index.js`, `code/coverage/{runtime,pace,writer}.js` and `lint/pass/idle.js`. The modules it loads are still loaded late. A few more modules are imported, and only after the socket is up.
- `scripts/package-codex-runtime.ts`: changed by the coordinator's agreement. The runtime-release barrel is deleted.
- 44 dead value re-exports are deleted from 29 modules that define code. After the rewrite, no file in `src`, `test`, `scripts` or `evals` imports them, and no bundle entry is among these modules. The `entries/` directories hold the bundle entries.

## Import cycles

- **The check:** strongly connected components of the static value-import graph over `src/` and `test/`. Type-only imports do not count; re-exports do. The graph was built at the base (`2fc4ad13f`) and at this branch.
- **The result:** the same 4 cycles of the same 18 files, before and after, and none passes through a barrel:
  - `src/core/scheduler/{backlog,focused,promoted-tier,quiet,record-tier,revision,slots,tiers}.ts`;
  - `src/cli/{named-print,status-wait-ask-store,status-wait-lines,status-wait-paths,status-wait,store-writes}.ts`;
  - `src/cli/run-group{,-narrow}.ts`;
  - `src/runners/pytest/adapter-{environment,files}.ts`.
- **Why the rewrite adds no cycle:** an edge to a defining module replaces a path through a barrel to that module. No module becomes newly reachable, so no cycle can appear.
- **Load order:** it changes only where a file had imported a barrel. Such a file loaded every module behind the barrel, and now loads only the modules it names. The script found no re-export cycle: it throws on one.

## Effects outside this row

- The committed bundles (`plugins/*/dist`) will drift: module order and the `// src/...` markers change. The rebuild belongs to integration.
- **The key alarm fires on all five components.** Each component's entries bundle differs from squeal--v0.1.413's. The probe bundled them in memory with the alarm's own `bundleEntries` and `extractTree`, and no case ran. Bundle lines: global 5,945→5,851, vitest 4,888→4,886, node:test 3,012→3,010, pytest 3,564→3,544, recorder 322→313. Dependency lines are the same.
- **The alarm asks for no raise.** `test/keys/key-format.test.ts` ("moves only when the validity path's outputs differ from the last release's") passed at revision 7 (`a98ee3a0a`), which holds every `src/` change. It took 33 s, against 9 to 12 s elsewhere: it ran the cases, every case agreed and every changed line ran.
- **Files the alarm reads.** Each entries bundle now reads fewer files: global 155→86, vitest 104→81, node:test 90→57, pytest 91→54, recorder 36→9. An edit now fires fewer components.
- **`test/keys/key-format.test.ts` changed, import lines only.** The brief lists this file as leave-alone. The pin and the test body are unchanged. Its `failures` import now names `validity/verdict.ts`, because `compare.ts`'s re-export of it was deleted with the dead re-exports.
- **`test/keys/validity/compare.test.ts` changed, by the coordinator's agreement.** Its "holds no component to its changed lines … (011-105)" test edited a line of `keys/check-key.ts` as a line every component's bundle holds. That was true only through the barrels. The probe line is now in `ReverseIndex.below` (`keys/reverse-index.ts`). Only that module and `fs/compare.ts` are read by all five bundles now.
- `test/scheduler/ordering.test.ts` line 88 still names `src/core/state/index.ts`, in a comment that describes review wave 4.5. That barrel is now deleted.
