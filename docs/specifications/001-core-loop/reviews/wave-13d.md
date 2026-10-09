# Wave 13 fourth review: cached project bytes

FAIL b36faa4

Two proven blockers (B1, B2), two proven should-fix notes (S1, S2), no nits. Prior wave-13c B1 and S1 are closed. The cache inventory is incomplete: a declared input can lose its virtual-module evidence, and processed CSS can retain another project file's bytes without evidence for those bytes.

Reviewed `65c280b..b36faa4`, the exact 0.1.58 bundle landing on `origin/main`. The starting checkout was `955b88a`, a later board-only commit. Verification and external probes ran after detaching at `b36faa41e9a2a3554b9ea0bc02f65452c862fb30`, with a clean tracked tree. Returned to the assigned branch only to commit this report. The intervening spec 003/004 landings are outside this review except at the slow-instance seam. No board or product files were edited.

## Verification

Node 24.21.0, Linux, Vitest 5.0.3, Vite 8.3.2. One full gate, at most four Vitest workers per command. The repository instructions and reviewer skill require the build check; the rebuilt bundles stayed byte-identical.

```text
$ npm ci
added 56 packages, and audited 57 packages in 2s
found 0 vulnerabilities
(exit 0)

$ npm run lint
> squeal@0.1.58 lint
> biome check .
Checked 643 files in 212ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.58 typecheck
> tsc --noEmit
(exit 0)

$ npm run build
> squeal@0.1.58 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.58 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0)

$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist
(no output, exit 0)
$ git status --short
(no output)

$ npx vitest run --maxWorkers=4
RUN v5.0.3
FAIL test/scheduler/backlog-tiers.test.ts > runs a 200-file backlog in at most a few tiers, within 2x a direct vitest run
AssertionError: expected 12376 to be less than 7968
at test/scheduler/backlog-tiers.test.ts:89:23
Test Files  1 failed | 270 passed | 1 skipped (272)
     Tests  1 failed | 2079 passed | 10 skipped (2090)
Start at  08:53:07
Duration  371.26s
(exit 1)

$ npx vitest run test/scheduler/backlog-tiers.test.ts -t 'runs a 200-file backlog' --maxWorkers=1
Test Files  1 passed (1)
     Tests  1 passed | 3 skipped (4)
Duration  16.14s
(exit 0)

$ npx vitest run test/harness/starting-daemon.test.ts --maxWorkers=1
Test Files  1 passed (1)
     Tests  10 passed (10)
Duration  8.83s
(exit 0)
```

The gate's failed cost comparison measured the direct run at 3,984 ms and the post-config backlog at 12,376 ms; both baseline and backlog used one tier. Its isolated repeat passed. This comparison predates the candidate range; the loaded full gate is not green, but this result does not establish another blocker of this slice. The complete gate passed the new query, separate-project, variant, instance-input and starting-daemon regressions. Install warned about the esbuild and @parcel/watcher script allowlist. The gate also printed fixture gitdir-repair notices and one earlier-run process-cleanup notice.

Separate background Squeal runs reported `test/cli/remove.test.ts`'s daemon-ready timeout and `test/scheduler/observed-growth.test.ts`'s preload-growth run-count mismatch. Both passed the direct candidate gate. Their background results are distinct evidence, not additional failures of this direct run; no claim of a clean background checkpoint is made.

All independent probes were `node_modules/.bin/tsx /tmp/squeal-review-158-*/<probe>.mts`. Fixtures, stores, slow-slot directories, dependency-cache copies and counterfactual source copies were external. Each adapter had one worker. No probe started a daemon or used this repository's store. Copied test harnesses had their scratch paths moved outside the repository and cleanup hooks replaced by explicit cleanup. Counterfactuals copied only the historical adapter/source pair and rewrote its relative imports to current dependencies, without changing product files.

## Blockers

### B1, proven: a virtual module loses its declared input's evidence when that input acquires a transform

`src/runners/vitest/sources.ts:156`, `:269`, `:272`.

D4 now promises that a virtual module is checked through the project files its plugin declared with `addWatchFile`. 001-158 explicitly asks whether that new inventory is complete and true. The input node starts without a transform, but Vite can later transform that same node for a normal import. `virtualInputs` then excludes it. Its virtual module's previous stamp remains in memory but is never checked. A newer plain-module stamp cannot describe the older bytes retained by the virtual transform.

Minimal fixture:

```ts
// Plugin in vitest.config.ts, using node:fs readFileSync and node:path resolve.
resolveId(id) {
  if (id === "virtual:which") return "\0virtual:which";
},
load(id) {
  if (id !== "\0virtual:which") return;
  const file = resolve(import.meta.dirname, "src/mod.ts");
  this.addWatchFile(file);
  return readFileSync(file, "utf8");
}
// test/virtual.test.ts imports which from "virtual:which".
// test/plain.test.ts imports which from "../src/mod.ts".
// Both expect which === "new"; disk exports "old".
```

Independent real-scheduler/store proof, observation off and on:

1. The scheduler prepares its keys on restored `OLD` bytes.
2. At its first run boundary, the same adapter runs only the virtual test with `src/mod.ts` temporarily exporting `"new"`. This warm-up passes and stamps the declared input for the virtual module.
3. Restore `OLD`. Call the same adapter's public `closure(plain)`; this loads the plain module's restored transform without a pre-run stale check.
4. Let the original scheduler run continue. Nothing changes on disk during that recorded run.

```text
observe=false and observe=true:
  warm virtual run: PASS
  stored: plain current FAIL; virtual current PASS
  fresh restored-disk adapter: plain FAIL; virtual FAIL
```

Control: replacing the virtual import with `mod.ts?variant` under the identical sequence stores both current FAIL on this candidate. The copied pre-157 pair from `65c280b` stores the queried test current PASS. The remaining false pass is the new declared-input classification, not cumulative reporter state or the already-repaired query case.

Fix sized for one worker: keep a virtual transform's declared input evidence attached to that transform's identity and load, irrespective of whether an input node also has a cached transform. A normal load must neither replace nor hide that evidence. When an input moves, invalidate its dependent virtual transform as well as the normal variants; do not infer declared inputs solely from the current absence of a transform. Add the sequence above as a scheduler regression, observation on/off, fresh control, and a repeat planted in the slow adapter's own cache. Retain the query/plain and per-container controls.

### B2, proven: processed CSS holds imported project bytes that the stamp inventory never checks

`src/runners/vitest/sources.ts:151`, `:156`, `:269`; `test/runners/vitest/variants.test.ts:67`.

The inventory calls processed CSS `?inline` checked like any variant, but the committed test changes only the directly named CSS file. A cached CSS transform can also hold the bytes of a stylesheet it processed through `@import`. Its physical module ID causes `virtualInputs` to skip it; its direct-file stamp covers only the unchanged outer stylesheet. There is no evidence tying the imported bytes to that cached transform.

Independent fixture, no custom plugin:

```css
/* src/style.css */
@import "./base.css";
.x { color: red; }
/* src/base.css, restored disk */
.base { content: "old"; }
```

The config sets `test.css.include: [/.+/]`; the test imports `../src/style.css?inline` and expects the processed string to contain `"new"`. At the first scheduler run boundary, warm that same test on transient `base.css` containing `"new"`, restore `"old"`, then continue the recorded run. The outer stylesheet never changes.

```text
observe=false and observe=true:
  warm CSS run: PASS
  scheduler stored: CSS test current PASS
  fresh restored-disk adapter: CSS test FAIL
```

Repeated with policy `inputs: ["src/base.css"]`: the same false current PASS, both observation settings. This control explicitly makes the key name the restored imported bytes, independent of the pre-existing static-closure omission. A separate closure probe returned `style.css`, the test and its snapshot, but omitted `base.css`; declaring it solves that key omission and still does not solve the cached-output mismatch.

This is a remaining break of the cache guarantee and the specific processed-CSS inventory required by 001-157, rather than a request to repair all CSS dependency discovery. Vision principle 2 and goal 3 forbid presenting the transient output as current for the restored input key.

Fix sized for one worker: include declared transform/load inputs for physical modules in the evidence checked before runs, not only inputs of virtual IDs. Cover Vite's processed CSS dependency edges, with evidence belonging to the outer transform that consumed them. If that evidence cannot be established, drop/reload that derived transform before execution or withhold its result. Add the `@import` scheduler regression with declared inputs, observation on/off and fresh control. The same declared-input slice can own B1 and B2; extending it must preserve container/module identity and the mid-run movement log.

## Should-fix

### S1, proven: the optimizer exclusion also covers an ordinary source alias

`docs/specifications/001-core-loop/tasks/001-157/notes.md:54`; `src/runners/vitest/adapter.ts:141`, `src/runners/vitest/sources.ts:252`.

The worker explicitly leaves optimizer output unchecked and limits project-byte retention to a worktree package linked under `node_modules`. A normal `resolve.alias` can also direct an included optimizer name to `src/mod.js`, with no linked package. Configuring `test.deps.optimizer.ssr` and `.client` with `enabled: true, include: ["local-pkg"]` and aliasing `local-pkg` to that file builds cached `local-pkg.js` under the fixture's `.vite/vitest/.../deps_ssr` and `deps` directories.

```text
alias to src/mod.js: warm PASS; restore source: PASS
linked workspace control: warm PASS; restore source: PASS
each after closing the adapter and removing only that fixture's .vite cache:
  fresh optimizer rebuild on restored source: FAIL
```

`fsModuleCache: false` does not disable this separate cache. This is a proven pre-existing optimizer limitation, explicitly left out by the worker, so it is a note rather than an additional blocker of this bounded re-review. Expand the inventory's exclusion to aliases and optimizer inputs generally, and make the product boundary explicit. A later worker can either disable optimization of project sources, invalidate/rebuild its output on source evidence, or include optimizer source inputs in keys and validity. Merely keying by the installed lockfile does not represent these source bytes. Add an alias control alongside the linked-package control.

### S2, proven: the heartbeat test measures a scheduling budget as a wall-clock upper bound

`test/harness/starting-daemon.test.ts:71`, `:78`, `:83`.

The first case expects the entire hook, including opening/seeding context and timer scheduling, to finish below `SPAWN_SETTLE_MS` (750 ms). The next case includes fixture setup and bounds everything below 1,250 ms. `settle` bounds polling; it cannot bound event-loop suspension. These assertions remain load-sensitive although the starting-daemon behavior passes.

An external copy of the first case, using its own store and a simulated heartbeat at 100 ms, gave:

```text
no injected stall: elapsed 144.49 ms; elapsed < 750: true
850 ms event-loop stall at 50 ms: elapsed 908.01 ms; elapsed < 750: false
both hook outputs: SQUEAL · registered at revision 1
```

The delayed case still registered with a heartbeat and finished within the 2 s hook budget. This proves the assertion's scheduling sensitivity, not a product liveness failure. The complete file passed 10/10 in the full gate and in an isolated repeat; the observed host load around the isolated repeats ranged from 46 to 70. Replace the strict total-time assertion with controllable clock/poll evidence for the settle deadline and assertions about the rendered state; if retaining a wall-clock smoke bound, measure the operation separately from fixture setup and give it the actual hook-budget headroom.

## Nits

None.

## What fits

- **Prior B1 closed, proven independently:** the real query/plain scheduler sequence stores both current FAIL with observation off/on; the same copied pre-157 source pair stores query current PASS/plain current FAIL. A fresh adapter fails both. The required gate also passes the query cases planted in the slow instance itself.
- **Prior S1 closed, proven independently:** the slow adapter itself performs A's transient `closure`, restores disk and performs B's restored `closure` before the real slow run. Copied `bc4ceb1` stores A current PASS/B current FAIL; this candidate stores both current FAIL, observation off/on. Fresh controls fail both. The committed replacement follows this discriminating sequence.
- **Checked inventory classes:** external warm/restore probes pass the expected disk-state check for arbitrary query, `?raw`, direct processed CSS `?inline`, a `\0` ID naming a physical file, a virtual module whose input remains untransformed, eager and lazy `import.meta.glob`, `vi.mock` with the original, automock, `__mocks__`, client environment, default forks, explicit threads, `vmForks`, `vmThreads`, and `isolate: false` worker reuse. The VM pools are absent from the written inventory but their plain-module controls hold.
- **`?url` control:** the import remains `/src/mod.ts` before and after a content rewrite. It retains a path string, not the source bytes tested here.
- **Instance inputs:** an imported config helper restored after instance creation is re-read by a replacement and fails the disk-state test; a global-setup helper restored after its first run is re-read and fails too. The gate's self-rewriting-config case withholds all results when the replacement stays unsure.
- **Filesystem transform cache:** root and separate-project configs requesting `fsModuleCache: true` still create no configured filesystem cache; their restored-source runs fail. This holds independently as well as in the committed cases. It does not establish optimizer-cache coverage (S1).
- **Unstamped transforms and temporary fork copies:** the gate's synthetic cached-without-load case marks the file moved; the fork controls exercise actual cached output and its invalidation. Source inspection confirms Vitest's temporary copy is tied to the transform result. No claim is made that this rules out every optional browser/provider mode.
- **001-156:** starting grace, silent first heartbeat, delayed heartbeat, never-started timeout and genuinely stopped daemon cases passed. The identified remaining concern is the test's wall-clock assertion (S2), not a new liveness blocker.
- The prior review's settled lane, process-identity and per-container findings were not re-prosecuted. Neither was the previously accepted interval between Squeal's separate source read and Vite's read.

## Inputs for the next wave

1. A single declared-transform-input slice can repair B1/B2 in `sources.ts`, with minimal adapter wiring if needed. Keep evidence per container, module ID and consuming transform; keep input relationships after an input gets its own transform, and cover physical consuming transforms too. Do not replace this evidence with a path's latest normal-load stamp.
2. The pre-run check must invalidate dependent virtual/physical transforms as well as all variants of the moved file. If input evidence is missing or cannot be tied to the cached output, invalidate before execution or return no completed result with a reason. Preserve post-run unknowns and 001-150's movement log when another call invalidates during a run.
3. Regressions must plant the consuming adapter's own cache, restore disk before the recorded run and compare with a fresh adapter. Include observation off/on, explicit declared inputs for the CSS case, a normal import alongside the virtual input, and the slow adapter itself. The query/plain and two-project controls remain required.
4. Treat optimizer coverage as a separate declared boundary or key/invalidation slice; the current inventory's linked-package-only description is too narrow. Resolve S2 with test-clock evidence, without changing working liveness behavior merely to satisfy a wall-clock assertion.

All probe scripts, repositories, stores, caches, copied counterfactual sources and external logs were removed after their outputs were recorded. No probe daemon was started. Only this report is committed.
