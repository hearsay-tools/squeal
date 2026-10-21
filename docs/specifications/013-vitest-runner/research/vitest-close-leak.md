# 013-05: the Vitest instance a close leaves alive

Researcher, 2026-10-21. Brief: `vitest-close-leak-brief.md`. Host: 24 CPUs, Linux 6.8.0-147, Node v24.21.0. Squeal 0.1.238 bundle, copied (this worktree's version). cezar at `97ac340` as a shallow clone: Vitest 4.1.10, Vite 8.1.4, Rolldown 1.1.5. My own daemons ran with `HOME`, `XDG_*` and `TMPDIR` under `/tmp`, at 4 host slots. No live socket or store was opened, and no live process was signalled. Probes and logs: `probes/vitest-close-leak/` (throwaway, README there). Every run waited until the one-minute load was below 24; the load is given beside each number, and two readings rose above 24 during a run.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | In a daemon | Every close leaks the whole instance. Fixture: 14 instances created, 14 alive (1 in use, 13 leaked) after a baseline, 3 config edits, 3 touches and 3 slow passes. cezar: 7 created, 7 alive after 3 touches and 3 slow passes. One leaked recreate holds 111 to 126 MiB of live heap on cezar, and private memory rose 711 → 1,243 → 1,570 → 1,596 MiB over the 3 touches. A drained slow instance that ran one light file holds 1 to 2 MiB. | verified by experiment |
| 2 | Versions | Every Vite 8 combination leaks one instance per close: cezar's (4.1.10 / 8.1.4 / 1.1.5), Squeal's own (5.0.3 / 8.3.2 / 1.2.12), the latest (5.0.5 / 8.3.5 / 1.2.15) and 4.1.12 / 8.3.5 / 1.2.15. Vite 7.3.7 (no Rolldown) does not: the count stays at 1 with Vitest 4.1.10 and 5.0.5. Vite alone leaks the same way; Rolldown alone leaks whenever a callback's closure reaches the plugin. | verified by experiment |
| 3 | Fixes | Build an "empty the closed instance" step after each awaited close: on cezar it cuts the heap a close leaves from 110 to 114 MiB to 7 to 15 MiB, and a last-resort GC then frees the rest, in about 25 lines with no new process. Keep the slow instance across passes as a second, smaller change. A child process frees everything but is a large design. A restart after a bound costs 16 to 25 s and drops the triggering edit under `lookup-only` (011-53). | verified by experiment (the break); inferred (the rest) |
| 4 | Upstream | Rolldown owns the fix: its native vite-resolve plugin holds Vite's callbacks through N-API thread-safe functions, whose strong references are GC roots, and the callbacks' closures lead back to the plugin. That cycle is never collected. Vite can only narrow what the callbacks capture. Issue text below; not filed. | read in source code; verified by experiment |

## 1. In a daemon

`inside.mjs` is loaded with `--import` into the research daemon only. A `module.registerHooks` hook wraps the project's `createVitest`, so the probe keeps a `WeakRef` on each instance; a control file runs two full GCs and logs how many are still alive. No product code changes. *Verified by experiment.*

**Fixture** (`run-fixture.sh`, `logs/fixture-daemon/`, 15:00Z to 15:02Z, load 22.0 to 26.5). Four test files, `test/slow.test.ts` in the slow lane, Vitest 4.1.10, Vite 8.1.4, Rolldown 1.1.5.

| After | Created | Alive | heapUsed | Private |
|---|---|---|---|---|
| Baseline (the fast instance, and one slow pass) | 2 | 2 | 24.3 | 136 |
| 3 config edits (`vitest.config.ts`): a recreate and a slow pass each | 8 | 8 | 26.1 | 170 |
| 3 touches of a test file the instance read, each carried by an edit | 11 | 11 | 28.1 | 177 |
| 3 edits of the slow file: a slow pass each | 14 | 14 | 29.0 | 180 |

MiB. Every close the daemon made left its instance alive: the recreate (`#recreate`) and the slow-lane drain (`releaseLane` → `drop`) alike. On this fixture, a leaked instance is small: 0.4 MiB of heap and 3.7 MiB of private memory each.

**cezar** (`run-cezar.sh`, `logs/cezar-daemon/`, 15:02Z to 15:05Z, load 18.8 to 22.3). cezar's own `lookup-only` baseline; one light server test (`model-settings/shared.test.ts`) in the slow lane; touches of `core/effort.test.ts`, each carried by an edit of `core/cursor-cli-flags.test.ts`.

| After | Created | Alive | heapUsed | Private | The edit's wall time |
|---|---|---|---|---|---|
| Baseline (listed and keyed) | 1 | 1 | 182 | 694 | – |
| Warm edit | 1 | 1 | 190 | 711 | 4.7 s |
| Touch 1 | 2 | 2 | 317 | 1,243 | 15.6 s |
| Touch 2 | 3 | 3 | 437 | 1,570 | 16.8 s |
| Touch 3 | 4 | 4 | 548 | 1,596 | 15.8 s |
| Slow pass 1 / 2 / 3 | 5 / 6 / 7 | 5 / 6 / 7 | 550 / 552 / 553 | 1,611 / 1,603 / 1,611 | 4.3 to 5.8 s |

- **A recreate on cezar leaks 111 to 126 MiB of live heap**: the new instance's keying walk rebuilt the module graph of all 771 Vitest files, and the old one stays. Private memory grew 532, then 327, then 26 MiB: V8 reuses pages it pooled earlier, so private memory lags the heap. The edit after each recreate took 15.6 to 16.8 s against 4.7 s warm, as 011-53 found in a script.
- **A slow-lane drain leaks what the slow pass loaded.** Here 1.2 to 2 MiB, because the slow file is small. A slow pass over cezar's real browser e2e files was not measured: they need a served test environment.
- Run 3 of 011-53 held 452 MiB of heap mappings at most; the 011-52 daemons held 800 to 1,237 MiB. Three recreates take this daemon from 190 to 548 MiB of live heap, so recreates fit that gap. That the live daemons recreated that often is *inferred*: Squeal keeps no count.

## 2. Versions

`matrix-setup.sh` installs each combination from npm into `/tmp/vcl-matrix`; `run-matrix.sh` runs 3 close cycles of each probe (`logs/matrix.jsonl`, 15:00Z to 15:02Z, load 22.3 to 26.5). "Alive" is the count of instances still reachable after the third close and two GCs. *Verified by experiment.*

| Vitest | Vite | Rolldown | Vitest alive after 3 closes | Vite servers alive after 3 closes (`vite-repro.mjs`) | Rolldown plugin with a cycle / without (`rolldown-repro.mjs`) |
|---|---|---|---|---|---|
| 4.1.10 (cezar) | 8.1.4 | 1.1.5 | 3 | 3 | leaks 64 MiB / freed |
| 5.0.3 (Squeal) | 8.3.2 | 1.2.12 | 3 | 3 | leaks / freed |
| 5.0.5 (latest) | 8.3.5 | 1.2.15 | 3 | 3 | leaks / freed |
| 4.1.12 | 8.3.5 | 1.2.15 | 3 | 3 | leaks / freed |
| 4.1.10 | 7.3.7 | – | 1 | 1 | – |
| 5.0.5 | 7.3.7 | – | 1 | 1 | – |

- **The leak is Vite 8's, not Vitest's.** `vite-repro.mjs` (`createServer` with no config file, no watcher and no HMR, one SSR transform, `close`) keeps every server. With Vite 7, only the last instance stays reachable, and the count does not grow.
- **The retainer** (`snapshot.mjs`, `retainers.py`, `logs/retainers-fixture-plain.txt`): GC roots → global handles → `resolveSubpathImports` (or `onWarn`) → its closure context → `partialEnv` (a `PartialEnvironment`) → `_options.plugins` → Vitest's plugin → `transform` → its closure context → `ctx`, the `Vitest`. *Verified by experiment.*
- **Why it is never freed.** Vite 8 makes Rolldown's native `viteResolvePlugin` for each environment and passes it JavaScript callbacks: `resolveSubpathImports` always, `onWarn` in serve mode, `finalizeBareSpecifier` and `finalizeOtherSpecifiers` when the optimizer is on (`vite/dist/node/chunks/node.js:32031-32107` in 8.1.4, `:29253-29330` in 8.3.5, same shape). Rolldown keeps each one as a `JsCallback`, an `Arc<ThreadsafeFunction>` (`crates/rolldown_binding/src/types/js_callback.rs:104`, `binding_vite_resolve_plugin_config.rs`, both 1.1.5 and 1.2.15). Node's thread-safe function holds its function through a strong `v8impl::Persistent` (`src/node_api.cc:229`, `ref.Reset(env->isolate, func)`), released only when the function is released (`:389`). The native plugin is released only when its JavaScript wrapper is collected. The callbacks share one V8 closure context, which holds `partialEnv`, whose plugin list holds that wrapper. The strong reference makes the cycle a GC root. *Read in source code; the cycle verified by experiment* (`rolldown-repro.mjs`: with the path back, the 64 MiB stays; without it, it is freed).

## 3. Fixes Squeal can make

| Fix | What it saves | Cost | Risk |
|---|---|---|---|
| **a. Empty the closed instance** (`break.mjs`) | cezar, all files walked: the heap left per close falls from 110 to 114 MiB to 7 to 15 MiB, and a last-resort GC frees that too (table below). Fixture: no instance stays alive but the last, on all four Vite 8 combinations (`logs/matrix-break2.jsonl`), as with Vite 7. | About 30 lines, run once per awaited close. | It deletes the properties of objects that late work in the closed instance might still touch. The daemon has no `unhandledRejection` handler, so a throw there in a promise nobody awaits ends the process. It depends on Vite's and Vitest's shapes, but it only frees less when they change; it never changes a result. |
| b. Keep the slow instance across passes | The whole slow-drain leak: one slow instance stays instead of one leaked per pass. | A change to `withSlowInstance` and to 004 D2's "closed when it drains". | Low: pending invalidations already reach a living slow instance before its next run (`slow-instance.ts`). An idle slow instance holds memory, which a leaked one holds today anyway. |
| c. The slow lane's instance in a child process | Everything, Rolldown's native memory included. | A runner protocol over IPC, a process per pass (Node start, imports, `createVitest`); the larger design 011-53 named. | New failure modes: a dead child, IPC errors. |
| d. Restart the daemon after a bound of leaked instances | Everything. | 16 to 25 s on cezar before the new daemon takes an edit, and the edit that triggers it is not run under `lookup-only` (011-53, 3b). | A missed verdict. |
| e. Reuse instead of a recreate | Nothing for a config, install or exclusion change: Vitest has no in-place config reload, so a new instance is needed. A touch could invalidate the touched module instead (013-02 chose a new instance so the global setup reruns). | A redesign of 013-02. | 013-02's reasons. |

**The break, measured** (`break-cezar.mjs`, `logs/break-cezar-150.jsonl`, load 21.2 to 23.0, and `logs/break-cezar-full.jsonl`). One instance with the adapter's options, the keying walk over the first K test files, `close`, then the break:

| K files walked | heapUsed after each close, plain | with the break | Private after each close, plain | with the break |
|---|---|---|---|---|
| 150 (7,939 to 9,783 module visits) | 60 → 97 → 131 | 30 → 38 → 41 | 442 → 534 → 648 | 514 → 553 → 609 |
| all 771 (77,213 visits), plain load 26.1 to 31.7, break 21.5 to 23.4 | 144 → 258 → 368 | 44 → 59 → 68 | 658 → 769 → 897 | 701 → 719 → 774 |
| all 771, `break-noplugins`, load 21.7 to 25.0 | – | 44 → 58 → 65 | – | 798 → 803 → 816 |
| all 771, then one last-resort GC | 328 | 26 (noplugins: 28) | 595 | 293 (noplugins: 377) |

MiB. After the break, each closed `Vitest` is still reachable, as an empty shell: on cezar, `PartialEnvironment._options.plugins` holds plugin objects that the server's resolved config does not list (`logs/retainers-cezar-break.txt`). The plugin closures then hold empty shells. Private memory still grows while V8 keeps the freed pages pooled. A last-resort GC (011-53's idle GC) frees the shells' remains too: after 3 closes, heap 26 to 28 MiB with the break against 328 MiB without, and private memory 293 to 377 MiB against 595 MiB. The plain run's load rose above 24 during the run (it started below); heap counts do not depend on load.

**Plugin objects.** The full break also empties plugin objects. A config that imports a ready-made plugin object from a package (not a factory call) shares that object with the next instance, because packages are not re-imported. Emptying it would break the live instance. `break-noplugins` leaves plugins alone and empties 27 objects instead of 265; it frees as much (the rows above). The closed `Vitest` shells then stay reachable through the plugins' closures (`logs/matrix-break2.jsonl`: 3 alive after 3 closes on every Vite 8 combination, load 24.6, empty), and what they hold is gone. *Verified by experiment; plugin sharing inferred from how Vite loads configs, not observed in cezar.*

## Recommendation for Squeal

1. **013-06 builds the break (fix a) in its `noplugins` form:** after every awaited close of a Vitest instance (`#recreate`, a failed `#start`, `closeBroken`, `closeRejected`, and the slow instance's close), delete the own properties of the closed `Vitest`, its logger, its projects, its Vite servers (root and per project) and their environments. Leave plugin objects alone. Do it after the close resolves, never in `abandon`, whose close is not awaited and may hang, and guard each delete so nothing throws. On cezar it turns a 110 to 114 MiB leak per close into 7 to 14 MiB, which the idle last-resort GC of 011-53 frees. It needs no new process and no upstream change, and it keeps working, with less effect, if Vite fixes the cycle.
2. **Count what leaks.** Keep a `WeakRef` on every closed instance and report the number still alive in the ping. That shows whether the break still works after a Vite, Vitest or Rolldown upgrade, and when an upstream fix lands. It is the recreate count 011-53 asked for.
3. **Keep the slow instance across passes** (fix b) in the same row or the next: it removes the slow-drain leak at its source, and it saves the slow instance's start at each pass.
4. A child process (c) and a restart bound (d) stay for a later row: (c) is the only fix for Rolldown's native memory, and (d) the only backstop if a future version leaks past the break.

The saving: about 100 MiB of heap per recreate on cezar, more once the idle GC runs. On the 011-52 population, where daemons held 800 to 1,237 MiB of heap mappings, against 452 MiB for one instance, that gap is room for 3 to 7 leaked instances per daemon at 110 MiB each. How many each held is not determined.

## 4. The upstream report

Owner: **Rolldown** (the native binding makes the uncollectable root). Vite can narrow what its callbacks capture, but all callbacks of one closure share a V8 context, and Vitest's logger leads back to the `Vitest` too, so only Rolldown can end the cycle. Two reproductions: `rolldown-repro.mjs` (Rolldown alone) and `vite-repro.mjs` (Vite alone). The snippet in the text below is `issue-repro.mjs`, run as given: `leaked: true` with Rolldown 1.1.5 and 1.2.15, `leaked: false` without the path back. *Verified by experiment. Not filed: the human decides.*

> **Title:** `viteResolvePlugin` keeps every closed Vite 8 dev server alive: its JS callbacks are GC roots that close a cycle
>
> **Versions:** rolldown 1.1.5 through 1.2.15, vite 8.1.4 through 8.3.5, Node 24.21.0, Linux x64.
>
> **What happens.** Each Vite 8 dev server (or Vitest instance) that is created and closed in the same process stays reachable forever, with its module graphs and transform results. A tool that recreates its server on a config change grows by one whole server per recreate (about 120 MiB of heap on a 770-test-file monorepo under Vitest). Vite 7 does not.
>
> **Why.** `viteResolvePlugin(config)` takes JS callbacks (`resolveSubpathImports`, `onWarn`, `onDebug`, `finalizeBareSpecifier`, `finalizeOtherSpecifiers`) and stores each as a `JsCallback`, an `Arc<ThreadsafeFunction>`. A thread-safe function holds its JS function through a strong persistent reference (Node `src/node_api.cc`, `ThreadSafeFunction::ref`), which is a GC root until the TSFN is released. The TSFN is released when the native plugin drops, which happens only when its JS wrapper (`BindingCallableBuiltinPlugin`, held by the object `makeBuiltinPluginCallable` returns) is collected. Vite's callbacks close over the environment they were made for (`vite:resolve-builtin`, `oxcResolvePlugin`), whose plugin list holds that wrapper. So the wrapper is reachable from a GC root through its own callbacks, and nothing in the cycle is ever collected. A heap snapshot after two closed servers shows, for each: `(Global handles) → resolveSubpathImports → context → partialEnv (PartialEnvironment) → _options.plugins → … → the server`.
>
> **Reproduction, Rolldown alone** (`node --expose-gc repro.mjs`):
>
> ```js
> import { viteResolvePlugin } from "rolldown/experimental";
> let ref;
> (() => {
>   const holder = { big: new Uint8Array(64 * 2 ** 20), plugin: null };
>   holder.plugin = viteResolvePlugin({
>     resolveOptions: { isBuild: false, isProduction: false, asSrc: true, preferRelative: false,
>       root: process.cwd(), scan: false, mainFields: ["main"], conditions: [], externalConditions: [],
>       extensions: [".js"], tryIndex: true, preserveSymlinks: false, tsconfigPaths: false },
>     environmentConsumer: "server", environmentName: "ssr", builtins: [], external: [],
>     noExternal: [], dedupe: [], resolveSubpathImports: () => undefined,
>     onWarn() { holder.big; },
>   });
>   ref = new WeakRef(holder);
> })();
> for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 100)); gc(); }
> console.log("leaked:", ref.deref() !== undefined); // true; false without `holder.plugin = …`
> ```
>
> **Reproduction, Vite alone:** create and close a dev server three times (`createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })`, one `environments.ssr.transformRequest`, `close()`), keeping a `WeakRef` on each. After `gc()`, all three are alive with vite 8.1.4 to 8.3.5; with vite 7.3.7, at most the last.
>
> **Possible fixes.** Release the callbacks' TSFNs when the plugin is done with (an explicit `dispose()` on the callable builtin plugin, which Vite calls when an environment or server closes), or hold the JS callbacks where V8 can trace them (for example on the wrapper object, looked up at call time) instead of as strong persistent references. On the Vite side, closing a server could call that `dispose()` for each environment's `vite:resolve-builtin` plugin.

## Open questions

- The leak with cezar's real slow files (browser e2e): needs a served test environment; not measured.
- Whether `PartialEnvironment` objects can be reached from a closed instance, so the break could empty them too and free the last few MiB: not found.
- How often live daemons recreate: Squeal keeps no count (recommendation 2).
- Rolldown's native memory (mimalloc) per leaked instance: not separated from V8's pooled pages here.
- macOS: not examined.

## Sources

- Squeal source at `60d695f8a`: `src/runners/vitest/adapter.ts` (`#start`, `#instance`, `#recreate`, `#invalidate`, `close`), `broken.ts` (`closeBroken`), `run.ts` (`abandon`), `startup.ts` (`closeRejected`), `src/core/daemon/slow-instance.ts`, `runner.ts`, `src/core/scheduler/refinement.ts`; spec 013 V1, V5, V8; 004 D2.
- Research: `../../011-core/research/daemon-memory.md` 3 and its probes.
- Vite 8.1.4, 8.3.5 and 7.3.7 from npm (`npm pack`): `dist/node/chunks/node.js` (`perEnvironmentOrWorkerPlugin`, `oxcResolvePlugin`).
- Rolldown tags `v1.1.5` and `v1.2.15`, https://github.com/rolldown/rolldown: `crates/rolldown_binding/src/options/plugin/config/binding_vite_resolve_plugin_config.rs`, `crates/rolldown_binding/src/types/js_callback.rs`, `crates/rolldown_binding/src/options/plugin/binding_callable_builtin_plugin.rs`, `packages/rolldown/src/builtin-plugin/constructors.ts` and `utils.ts`. napi 3.14.2 (`Cargo.lock`, 1.2.15).
- Node v24.21.0 `src/node_api.cc` (https://raw.githubusercontent.com/nodejs/node/v24.21.0/src/node_api.cc), lines 203-232 and 380-392.
- npm registry, 2026-10-21: vitest 5.0.5, vite 8.3.5 (rolldown `~1.2.14`), rolldown 1.2.15, vite 7.3.7 latest.
- Probes: `probes/vitest-close-leak/` (README lists each script and log).
