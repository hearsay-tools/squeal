# 001-157: every cached transform of a project file is checked against its own evidence

2026-10-09, Vitest 5.0.3 on Vite 8.3.2, Node 24.21.0, Linux.

## B1 (review wave-13c)

`SourceStamps` kept one stamp per physical path in each container and skipped every ID with `?` or `\0`. `mod.ts?variant` is a module of its own with its own transform, so a variant warmed on transient bytes was compared with no stamp, or with the plain module's.

Fix (`src/runners/vitest/sources.ts`):

- Evidence is kept per container and per module ID, each stamp with the project file the ID names (`sourceOf`: `\0`, query and hash set aside, as Vite's `cleanUrl`).
- `stale` walks every cached module (`idToModuleMap`, soft-invalidated ones included through `cachedTransform`) and checks each against its own stamp. A cached module of a project file with no stamp counts as moved, whenever it was read: it was cached before the container was wrapped, or by a path other than the container's `load`.
- `invalidateStale` invalidates `invalidateFile(file)` as before, plus every module that names a stale file. A `\0` ID is not among its file's modules in `fileToModulesMap`, so `invalidateFile` alone misses it.

The query is not stripped to one stamp per path, so one variant's read never overwrites another's.

## S1 (review wave-13c)

`test/integration/project-config-stamps.test.ts` now plants the slow instance's own cache. The slow factory (`withSlowLanes` in `test/integration/stamps-repo.ts`) creates the adapter, runs `closure(A)` on transient bytes, restores the disk, runs `closure(B)`, then hands the adapter to the scheduler's slow run. Observe on and off. Against `bc4ceb1`'s `sources.ts` and `adapter.ts`, it stores `a` current PASS. Now it stores `a` and `b` current FAIL.

## B1 regressions

`test/integration/query-stamps.test.ts` runs the real scheduler, store and adapter. Each of the following fails against the `sources.ts` before this row (38513bc) and passes now:

- One query import, observe on and off. At the first run boundary the same adapter runs the test while `src/mod.ts` holds `NEW`. The file is restored, then the scheduler's run follows.
- A plain/query pair in one container, observe on and off. The variant is warmed on `NEW`. After the restore, the plain test is run, so the plain module's read names the disk.
- The same pair planted in the slow instance itself, observe on and off.
- The fresh-adapter control fails both files on the restored disk.

## Inventory

Each way Vite 8 and Vitest 5 can hold a transform or module of a project file. The tests in `test/runners/vitest/variants.test.ts` share one shape: run on transient bytes, restore the file with no revision and no `invalidate`, run again, and expect the bytes on disk. "Checked" means `SourceStamps` compares it with its own stamp before each run, in `invalidate`, and after each run, where a moved file makes its importers unknown.

| Class | Holds project bytes | Status | Test |
|---|---|---|---|
| Plain module IDs, every environment of every project server | yes | checked, per container (001-146, 001-151, 001-154) | `sources.test.ts`, `project-config-stamps.test.ts` |
| Query variants (`?variant` or any query, `?raw`) | yes | checked per module ID (this row) | `variants.test.ts` "a query variant", "a ?raw import"; `query-stamps.test.ts` |
| `?url` | no: the transform is the path string (`"/src/mod.ts"`) | checked like any variant all the same | none needed |
| `?inline` of CSS | only with CSS processed (`css.include`); by default `""` | checked like any variant | `variants.test.ts` "a CSS ?inline import with CSS processed" |
| `\0` IDs naming a project file (`\0/abs/src/mod.ts?virtual`) | yes | checked: `sourceOf` drops the `\0`, and `invalidateStale` invalidates the module by ID | `variants.test.ts` "a \0 ID a plugin resolves to the file" |
| Virtual modules naming no file (`\0virtual:x`) built from project files | yes, what the plugin read | checked through the files the plugin declared with `addWatchFile`, which Vite records as imported nodes with no transform. Each is stamped at the first check after the load if its last change came before the load began (`changedBefore`); otherwise it counts as moved. A moved one invalidates the virtual module. Undeclared reads are not checked: Vite's own watcher cannot see them either | `variants.test.ts` "a virtual module built from the file" |
| A transform cached by a path other than `load` | yes | counts as moved (stale before a run; after it, the run's files are unknown) | `sources.test.ts` "counts a cached transform … no stamped load produced as stale" |
| Vitest `fsModuleCache` | yes: transforms are read back from `node_modules/.vitest-cache` without `load` | turned off: `fsModuleCache: false` in `createVitest`'s options. Vitest hands it to every project (`PROJECT_CLI_OVERRIDES`) | `variants.test.ts` "is off whatever the root config / a project's own config file says" |
| Forks pool tmp copies (`__vitestTmp`), `fetchWarmModules` snapshot | yes, copies of a transform | follow the transform: invalidation drops `transformResult` and with it the copy's entry (Vitest's own comment, `index.DpLw24bj.js` ~10565) | covered by every class above |
| SSR and client environments, `__vitest__` | yes | each environment's container is wrapped (001-151) | `variants.test.ts` "the client environment" (a custom environment with `viteEnvironment: "client"`) |
| `import.meta.glob` | yes, each match is a plain module | checked as plain modules. Which files match is structural (D4, `expandsFromDisk`) | `variants.test.ts` "an eager import.meta.glob" |
| `vi.mock` factory | the factory is the test file's own code; `importOriginal` loads the original as a plain module | checked | `variants.test.ts` "the original under a vi.mock factory" |
| Automock | the original module's transform | checked | `variants.test.ts` "an automocked module" |
| `__mocks__` files | yes, plain modules | checked | `variants.test.ts` "a __mocks__ file" |
| Workers' evaluated modules | yes | fed from the server's transforms. With `isolate: false` a worker serves several files of one run; a worker does not outlive a run (each adapter run got new PIDs in a probe, `isolate: false`, `maxWorkers: 1`). Within a run, the after-run check covers what was fetched | `variants.test.ts` "a worker reused across files (isolate: false)" |
| Config files (`vitest.config.ts`, project configs, their imports) | yes, read once per instance by Vite's config bundler, never through a container | stamped before `createVitest` reads them (`ConfigStamps`: the last instance's config files and the scripts at the root). A config file not stamped then is trusted only if it changed before. Checked at every run boundary and `invalidate`. A moved one leaves the instance unsure | `instance-inputs.test.ts` "runs the config on disk after an instance started on a reverted one" |
| Global setup and its closure | yes, executed once per instance | stamped as modules of `__vitest__`. A moved one is not undone by invalidating it, so it leaves the instance unsure | `instance-inputs.test.ts` "runs the global setup on disk after it ran reverted bytes" |
| An instance still unsure after one replacement | — | the run's files are not completed, and the reason names the files | `instance-inputs.test.ts` "stores no run of an instance that stays unsure of its config" |
| Dependency optimizer (`deps.optimizer.*`) | only for a worktree package that is linked under `node_modules` and named in `include`, with the optimizer turned on (off by default in Vitest) | not checked. The bundle is a file under `node_modules`, which is the environment hash's domain (D3), and Vite re-optimizes on its lockfile and config hash, not on sources. A normal edit of such a package is missed too, so this is not specific to stamps | none; see below |

"Unsure" (`src/runners/vitest/adapter.ts` `#unsure`): the next call to the adapter replaces the instance once. If the new instance is unsure too, its runs are not stored. In the suites of `test/runners/vitest`, `test/integration` and `test/scheduler`, replacement happened only in the tests that rewrite a config or global setup on purpose. The other 36 recreates were the existing `observe.runtimeInputs` ones.

## Decisions the spec did not settle

- `changedBefore` trusts a file whose last change (ctime, mtime) came at least 20 ms before a moment. A filesystem that keeps whole seconds gets two seconds. The kernel stamps writes from a coarse clock that lags by under one tick. A two-second margin everywhere would leave every config file or virtual-module input written in the two seconds before a load unsure, and would recreate the instance in nearly every adapter test.
- `ConfigStamps` stamps the scripts at the worktree root before the first instance. Without that, a first instance would have no stamps and would trust only the ctime rule. Project config files elsewhere fall to that rule on the first start, and are stamped from then on.
- `fsModuleCache` is overridden whatever a user's config says. The cost is cold transforms when an instance starts: a daemon keeps its instance warm, so it pays this once per start, recreate or slow pass. The alternative was results unknown at every run, because those transforms carry no stamp.
- The dependency optimizer is left unchecked (table above). Covering it would mean keying the environment on the sources of optimized worktree packages, which belongs to D3, not to stamps.

## For the next worker

- `src/runners/vitest/sources.ts` is stamps and `stale`. `stamp.ts` holds the disk reads and `changedBefore`. `moved.ts` holds what a run's report keeps (`mayHaveRun`, `withoutFiles`). `config-stamps.ts` holds the instance's config.
- `adapter.ts` is over 300 lines: 365 before this row, 415 after.
