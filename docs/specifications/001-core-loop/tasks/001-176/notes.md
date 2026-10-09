# 001-176: Squeal's Vitest instances run with the dependency optimizer off

2026-10-09, Vitest 5.0.3 on Vite 8.3.2, Node 24.21.0, Linux. Repairs `reviews/wave-13f.md` B3, B4, S1, N1, N2 as the human decided: the optimizer off.

## Why no option does it

- `createVitest`'s second argument (CLI options) reaches a project with its own config file only through `PROJECT_CLI_OVERRIDES` (Vitest 5, `index.DpLw24bj.js` ~12437; Vitest 4.1.10's list in `cli-api.BK8pd4xc.js` ~11082). Neither list has `deps`. `fsModuleCache` is on Vitest 5's list, which is why 001-157's override reaches every project there.
- The third argument (Vite's inline config) is inherited only by inline projects extending the root (`inheritRootViteOverrides`, `resolveSingleProjectEntry` ~12904). That is wave-13f B3.
- Vitest turns `test.deps.optimizer[env]` into each environment's `optimizeDeps` in a `configEnvironment` hook of the project's own server (`ModuleRunnerTransform`, ~7925): enabled means `noDiscovery: true` with the `include` list; disabled means `noDiscovery: true, include: []`.
- Vite builds the optimizer in the `DevEnvironment` constructor (`node.js` ~36759) and `createServer` runs `environment.listen`, which runs `depsOptimizer.init()` and builds the bundles, before `createVitest` returns. The resolve plugin computes `depsOptimizerEnabled` when the plugin is made (~28940), so deleting `environment.depsOptimizer` afterwards breaks every import: `The environment should have a depsOptimizer` from `finalizeOtherSpecifiers`. Tried and dropped.
- Vitest 5 resolves every project's config (`config.resolvedProjects`) before it creates the project servers (`_attachProjectServers`), but no hook of Squeal's runs in between: a plugin given to `createVitest` is the root's only, and `configureVitest` runs after the servers exist. Mutating `resolvedProjects` from the root server's `configureServer` might work on Vitest 5 only; not tried.

## What the adapter does

`src/runners/vitest/optimizer.ts` `withoutOptimizer`, called in `#start` right after `createVitest` and `sources.attach`, before `standalone()`:

- every environment of every server (`vitest.vite` and each `project.vite`) with a `depsOptimizer` gets its `metadata` with `optimized`, `chunks`, `discovered` and `depInfoList` emptied. `tryOptimizedResolve` and the `optimizedDeps` load read the metadata at each call, so nothing resolves to a bundle and every import goes through the plugin container, which `SourceStamps` stamps. `metadata` is a field of Vite's public `DepsOptimizer` type.
- each project's `config.deps.optimizer.*.enabled` is set to false, which `serializeConfig` hands the workers.
- the projects whose config had it on are returned; the adapter notes `optimizerOffNote(projects)` once per process and worktree root (`noteOnce`), so the fast instance, each slow instance and each recreate add one note between them.

The explicit optimizer (`createExplicitDepsOptimizer`, what Vitest's `noDiscovery: true` makes) sets its metadata only in `init` and its `run` is a no-op, so the emptied metadata stays empty. A browser-mode project's `client` environment keeps Vite's discovering optimizer (Vitest skips its `configEnvironment` there), which can register imports and bundle again; not covered, stated in D4.

The bundles the start builds are still built (in `listen`) and never read; the start costs what it did with the optimizer on. `forceOptimizeDeps` (001-168) is gone.

## The note

`src/core/state/optimizer-note.ts` holds the text (`OPTIMIZER_OFF_NOTE` prefix). It is persisted through the adapter's `note`, the daemon's `#note`, so `squeal status` lists it among the daemon notes. `readHeader` finds the newest persisted note with the prefix and sets `StatusHeader.optimizerOff` (additive); `formatRegistration` prints it after the header lines. Only the registration message prints it: deltas and status do not repeat it. A note pushed out of the 20 persisted ones drops from the header until the next daemon start notes it again.

## Regressions

| Probe | Test | Without `withoutOptimizer` |
|---|---|---|
| B3: project `p` from `vitest.p.config.ts`, adapter built on NEW and closed, cache kept, OLD restored; a new adapter, then a scheduler and its forced checkpoint; observe on/off; uncached control | `test/integration/optimizer-off.test.ts` | fails |
| B3 through the slow-instance factory (`withSlowLanes`), same kept cache; observe on/off | same | fails |
| S1: root alias, baseline on NEW, ordinary edit to OLD and its batch; observe on/off; fresh control | same | fails |
| B4: real daemon (`src/cli/index.ts daemon` under tsx); a `git` shim on its PATH holds the first `rev-parse --show-object-format` until the start's bundle holds NEW, writes OLD; observe on/off (policy file); fresh control after | `test/integration/optimizer-start.test.ts` | stores `current pass` |
| effective setting: root, file-based and inline project; `optimizerInUse` lists `enabled` and `local-pkg` before, nothing after; `deps.optimizer.ssr/client.enabled` false | `test/runners/vitest/optimizer.test.ts` | n/a (tests the function) |
| the note once over two instances, per project kind; none when off | same | fails |
| registration header and status each carry the note once, after a recreate; none when off | `optimizer-off.test.ts` | n/a |

The counterfactuals ran by hand with `withoutOptimizer` skipped through a temporary environment switch, then restored. The B4 counterfactual first failed at the fresh control (the switch reached the test process's adapter too), so the stored state is asserted before the control.

The earlier probes (`touched-restart.test.ts`, `touched-caches.test.ts`) pass unchanged: their bundles are built and never read.

## Noticed, not fixed

With the optimizer removed outright (the dropped attempt), every run of the fixture reported `failure: null` and no results at all, though Vitest's module had a file-level error. A file whose import fails at module collection, with no checks known before, may leave no result; not this row's seam.
