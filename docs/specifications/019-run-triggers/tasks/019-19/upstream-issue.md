# 019-19: the upstream report for closed Vitest instances

Worker 933b4fd1, 2026-11-04. Brief: `tasks/wave-6.md` 019-19, outcome (3). Nothing here is posted. The coordinator shows this to the human first.

## Decision: do not file a new issue

The coordinator decided (2026-11-04): no new issue; a comment on the existing issue stays a draft. The reasons:

- **The leak is already reported.** [rolldown/rolldown#10887](https://github.com/rolldown/rolldown/issues/10887), "Native callable builtin callbacks retain their released JS owner", reproduces it with Rolldown alone, pinned to 1.2.8. It names the same retainer path as 013-05 and 019-12: a native callback root, then an option callback, then the Vite environment, then the plugin, then the native callable builtin again.
- **It is fixed.** [rolldown/rolldown#10961](https://github.com/rolldown/rolldown/pull/10961), "fix: avoid retaining callable builtin callback owners", merged 2026-10-28, closes #10887. Rolldown 1.2.16, released 2026-10-29, ships it ("avoid retaining callable builtin callback owners (#10961)" in its release notes).
- **The reproduction below confirms it at the Vitest level.** With Rolldown 1.2.15 and older, every closed Vitest instance stays reachable. With 1.2.16, none does, with Vitest 5.0.3, 5.0.5 and 5.1.0.

So the fix reaches a project when its lockfile takes Rolldown 1.2.16 or later. Vite 8.3.2 and 8.3.5 accept it (`~1.2.11`, `~1.2.14`). Squeal's own lockfile took it in this row (`cad693ea3`).

## Reproduction without Squeal

`repro/` beside this file: a package with one test file, a config, and `repro.mjs`. `repro.mjs` makes, runs (`start()`) and closes Vitest instances through the Node API in one process. Each instance gets one reporter object, as a tool that embeds Vitest passes one. It keeps a `WeakRef` to each instance and each reporter, runs three full GCs, each in a later task, and prints how many are still reachable. As committed, `package.json` pins Vitest 5.1.0 and overrides Rolldown to 1.2.15, the last version that leaks.

```sh
cd repro
npm install
node --expose-gc repro.mjs 5                       # instancesAlive: 5
node --expose-gc repro.mjs 3 out.heapsnapshot      # a snapshot to open in DevTools
```

Change the override to `"rolldown": "1.2.16"` (or remove it), install again, and the count is 0.

Measured on this host (Linux 6.8.0-147, 24 CPUs, Node v24.22.1), 5 cycles each; every combination installed with npm under the task's scratch directory, with its own `HOME` and npm cache:

| Vitest | Vite | Rolldown | Instances reachable after 5 closes | Reporters reachable | Heap used, before → after (MiB) |
|---|---|---|---|---|---|
| 5.0.3 (Squeal's dev install before this row) | 8.3.2 | 1.2.12 | 5 | 5 | 16.6 → 20.5 |
| 5.0.5 | 8.3.5 | 1.2.15 | 5 | 5 | 16.7 → 20.6 |
| 5.1.0 (latest) | 8.3.5 | 1.2.15 | 5 | 5 | 16.9 → 20.7 |
| 5.0.3 | 8.3.2 | 1.2.16 | 0 | 0 | 16.3 → 19.1 |
| 5.0.5 | 8.3.5 | 1.2.16 | 0 | 0 | 16.4 → 19.2 |
| 5.1.0 (latest) | 8.3.5 | 1.2.16 (latest) | 0 | 0 | 16.6 → 19.3 |
| 5.1.0 | 7.3.7 (no Rolldown) | none | 0 | 0 | 15.7 → 18.4 |

The Rolldown version alone decides. In this repro each kept instance is about 0.3 MiB of heap, because the project has one test file; a project's module graphs make it larger (below).

**The retainer path** of each kept instance, from the snapshot of 3 cycles with Rolldown 1.2.12 (`tasks/019-12/retainers.mjs`, shortest path from the GC roots):

```text
(GC roots)
  → (Global handles)
  → resolveSubpathImports          (the callback Vite 8 gives Rolldown's native viteResolvePlugin)
  → its closure context → partialEnv (PartialEnvironment)
  → _options.plugins → Vitest's plugin → configResolved → its closure context → harness (PluginHarness)
  → vitest (Vitest)
```

`onWarn` is the other callback that roots the same context. Through the same `PartialEnvironment`, `_topLevelConfig.test.reporters` keeps the reporters the instance was created with. In Squeal, that reporter's `onInit` closure held `current`, which held the `SizedVitestAdapter` with its observer, widths, source stamps and gate (`notes.md`, "What was kept").

**The measured cost in Squeal**, with Rolldown 1.2.12: in a live daemon whose slow lane makes and closes one instance per pass, heap grew 0.33 MB and private memory 1.7 MB per pass over 20 passes on 019-12's fixture (120 chained modules, 10 test files), and did not level off (`notes.md`). 013-05 measured 111 to 126 MiB of heap per instance on a 771-file monorepo after a recreate. With Rolldown 1.2.16 the same daemon frees each closed instance (`notes.md`).

## Draft comment for rolldown/rolldown#10887 (not posted)

Optional. It adds a Vitest-level confirmation to a closed issue; it asks for nothing. The human decides whether to post it.

> Confirming the fix from a tool that embeds Vitest. We create and close Vitest instances in one long-lived process (one per test lane and pass). With Rolldown 1.2.12 to 1.2.15, every closed `Vitest` instance stayed reachable from `(Global handles)` → `resolveSubpathImports` → `partialEnv` → `_options.plugins` → Vitest's plugin → `PluginHarness` → `Vitest`, together with the reporters it was created with. With 1.2.16, none stays: 0 of 5 after five create, `start()` and `close()` cycles, with Vitest 5.0.3, 5.0.5 and 5.1.0 (Vite 8.3.2 and 8.3.5, Node 24.22.1, Linux x64). Thank you for #10961.

## If it comes back

013-05's issue text (`../../013-vitest-runner/research/vitest-close-leak.md`, section 4) and `repro/` are the starting point. Run `repro/` with the new versions first: a count above 0 after the closes is the regression.
