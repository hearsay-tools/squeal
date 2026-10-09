# Wave 13 third review: stale transforms

FAIL b4ad590

One proven blocker (B1), one proven should-fix note (S1), no nits. The prior wave-13b B2 and S2 are closed. Reviewed `6418a6b..b4ad590`, including 001-148, 001-150 and 001-154, plus S2's `248723c`. The starting checkout was `65c280b`, documentation after the landing; verification and probes ran after detaching at the exact 0.1.54 landing `b4ad590`. Other spec 003/004 work in the range is outside this review except at these seams.

## Verification

Node 24.21.0, Linux, Vitest 5.0.3. All commands below ran at exact candidate `b4ad590180e3bd720b2b87a41de1d51e0fa15dde` with a clean tracked tree. AGENTS.md and the reviewer skill require the build check; rebuilding changed neither plugin bundle. One full gate ran, with the brief's worker cap.

```text
$ npm ci
added 56 packages, and audited 57 packages in 5s
found 0 vulnerabilities
(exit 0)

$ npm run lint
> squeal@0.1.54 lint
> biome check .
Checked 625 files in 1126ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.54 typecheck
> tsc --noEmit
(exit 0)

$ npm run build
> squeal@0.1.54 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.54 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0)

$ git status --short
(no output)

$ npx vitest run --maxWorkers=4
RUN v5.0.3
Test Files  263 passed | 1 skipped (264)
     Tests  2020 passed | 10 skipped (2030)
  Start at  07:46:02
  Duration  685.35s (tests 98%, transform 1%, import 1%)
   Isolate  264 workers spawned · ~216ms startup each
(exit 0)

$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist
(no output, exit 0)
```

Install warned that esbuild and @parcel/watcher install scripts were not yet allowlisted; subsequent checks completed. The gate printed two fixture worktree-repair notices and a notice about one process an earlier suite run left. It ended with no test or global-teardown failure. No second full proof or timing repeat was needed. This gate includes the separate-config stamp regressions, root/inline source-stamp controls, overlap/recreate/mid-run-stamp cases, scheduler lane cases, first-observation/link-target cases and process-identity cases.

Separate background Squeal messages reported a 5 s Codex CLI timeout (load average 70.83) and a bootstrap-heartbeat timeout. The direct candidate gate passed both files. They are distinct runs and were not established as new breaks of this slice. No background full-suite checkpoint is claimed.

The independent probes ran with `node_modules/.bin/tsx /tmp/squeal-review-155-*/<probe>.mts`, on this exact candidate. Each used an external fixture Git repository, its own store, a symlink to this worktree's installed dependencies and at most one Vitest worker per instance. No probe started a daemon or changed this repository's store. Counterfactuals copied `sources.ts` and `adapter.ts` from pre-154 `bc4ceb1` into the external directory, replacing only relative import paths; product files stayed unchanged.

## Blockers

### B1, proven: query-suffixed module transforms can still execute other bytes under a current key

`src/runners/vitest/sources.ts:103`, `:132`, `:133`, `:290`.

001-155 explicitly asks whether any Vitest configuration can cache a transform whose bytes differ from its stored result's key. D4 says "each project file Vite loads is stamped" and each container's cached transforms are checked against its own stamps. Vision principle 2 and spec goal 3 require honest current state. The repaired two-server case holds, but a normal query-suffixed import still escapes this promise:

```ts
// src/mod.ts on disk before keying and at result storage
export const which = "old";
// test/mod.test.ts
import { expect, it } from "vitest";
import { which } from "../src/mod.ts?variant";
it("disk bytes", () => expect(which).toBe("new"));
```

No custom plugin is needed. Vite accepts this module ID and caches its transform separately. `#stamp` skips every ID containing `?`, although these loads go through the wrapped container. `cachedFiles` then collapses the module variants to their physical file. A plain closure transform stamped the restored disk bytes, so `stale()` either sees no stamp for the queried transform or compares it with the plain variant's stamp. The per-container repair does not retain evidence for that separate cached module.

Independent proof with the real adapter, scheduler, store and state sink:

1. Start with `OLD` above. The scheduler scans and keys that disk state, and its ordinary closure walk includes `src/mod.ts`.
2. At the first scheduled run boundary, warm the same adapter through its public `run()` while `mod.ts` temporarily exports `"new"`. The query import caches those bytes; this warm-up passes.
3. Restore `OLD`, then let the scheduled run use the same adapter. Disk does not change during this recorded run. No revision names the transient rewrite; hashes before keying and at storage both name `OLD`.
4. The scheduler stores the queried test's PASS as current. A fresh adapter on the restored fixture fails that same test.

```text
observe=true:
  public warmup: completed test/mod.test.ts, PASS
  scheduler stored: [["", "current", "pass"]]
  fresh restored-disk adapter: [["", "fail"]]
observe=false:
  public warmup: completed test/mod.test.ts, PASS
  scheduler stored: [["", "current", "pass"]]
  fresh restored-disk adapter: [["", "fail"]]
```

An independent variant preloaded the queried transform through the real Vite environment while the first closure call held transient bytes, then restored the file before returning to the scheduler. It produced the same false current PASS with observation on and off. A plain-import control with the identical public warm-and-restore sequence stores current FAIL for both observation settings, agreeing with a fresh adapter. This excludes cumulative reporter results or warm-up alone as the explanation.

This is also reproducible in the slow instance itself: its factory warms that very adapter through public `run()` on transient bytes, restores `OLD`, and returns it to `withSlowInstance`. The ensuing real slow tier stores current PASS, while a fresh adapter fails, with observation both on and off.

This query exclusion predates 001-154; it is a remaining break of the end-to-end stamp guarantee explicitly examined by 001-155, not a claim that the patch introduced query imports. It is not the previously accepted separate-read interval or `fsModuleCache` bound: the queried load reaches the wrapped Vite plugin container and its transform is in the module graph.

Fix sized for one worker: preserve source evidence per cached module ID within each container, including query variants of physical project files. Associate the physical path with each ID so one variant's later load cannot overwrite another's evidence. Compare every executable cached variant with its own evidence; an uninstrumentable physical-file transform must be invalidated or make its result unknown. Invalidate all variants for a mismatching path. Merely stripping the query while keeping one stamp per physical path recreates the overwrite problem within one container. Add a scheduler regression with observation on and off, a plain/query pair for one file in one container, a fresh-adapter control, and the same cache planted in the slow instance itself. Preserve the repaired two-server controls and 001-150's mid-run movement log.

## Should-fix

### S1, proven: the committed slow regression warms the fast cache, so it passes without the repair

`test/integration/project-config-stamps.test.ts:168`, `:177`, `:183`, `:195`.

The test's `probe(h)` plants its transient transform through `h.runner.closure`, which `withSlowInstance` routes to the fast adapter. `createSlow` then returns a fresh slow adapter after restoration. Its own cache never held the transient bytes. The test therefore proves that a fresh slow instance reads disk, not that its per-container stamps prevent this defect. The brief already identifies this limitation; the independent review closes the evidence gap, but the committed regression still cannot guard it.

Replace or extend that test with a slow-factory barrier that creates the slow adapter, plants A's transient transform through that adapter's own `closure`, restores disk, warms B's restored transform through the same adapter, then returns it for the real scheduler slow run. Keep observation on/off and a fresh-adapter control. The review ran precisely this discriminating probe:

```text
slow instance's own cache, observe=true and observe=false:
  pre-154 bc4ceb1: A current PASS, B current FAIL
  candidate b4ad590: A current FAIL, B current FAIL
  fresh adapter: A FAIL, B FAIL
```

## Nits

None.

## What fits

- **Prior B2 closed, proven:** the original two-separate-config-project scheduler probe now stores A and B current FAIL with observation on and off. A fresh adapter fails both. Copies of the pre-154 source pair reproduce A current PASS/B current FAIL for both settings. The distinct containers no longer overwrite one another's plain-module evidence.
- **Slow repair closed, proven for the original B2:** the cache is planted in the slow adapter itself, not only the fast adapter. The same scheduler probe fails before the repair and passes after it, as recorded under S1.
- **Prior S2 closed, proven by a controlled two-target table:** signalling pid 10 replaces pid 11's start time. Candidate `terminate()` sends only `10 SIGTERM` and reports only pid 10. It neither signals nor names the replacement pid 11. This verifies the exact window wave-13b found; the acknowledged kernel check-to-signal interval remains.
- **001-150, proven by independent public-interface probe:** a real worker stays held while all six runner-part calls (`invalidate`, `affected`, `closure`, `enumerate`, `testFiles`, `environment`) answer. An unrelated math edit selects math, not the held file. A recreate requested during that run stays pending; the run requested after it starts after the recreate, and both tests pass. The gate's unit cases also cover exclusive sections requested by both lanes.
- **001-148:** adds the target spelling of an observed missing file behind an in-scope directory link before the next run can first observe it. It retains the first-seen discard instead of weakening the stability check. The complete candidate gate passed `first-observation.test.ts`, including the linked-file bound that failed in wave-13b, and `link-target.test.ts`.
- The prior review's settled store, recorder, process-marker overlap and handover findings, and its explicitly accepted source-read/`fsModuleCache` bounds, were not re-prosecuted.

## Inputs for the next wave

1. B1 needs a source-stamp slice in `src/runners/vitest/sources.ts`, with only the adapter wiring required. Keep both container identity and module identity; unknowns and `loadedSince` evidence must follow the cached variant they describe. Keep conservative invalidation across projects for one physical path.
2. Preserve 001-150's two queues and exclusive recreate/close sections, plus its movement log for transforms invalidated while a run is in flight. A query fix must not reintroduce serialization of the runner part behind the run.
3. Retain S2's per-target identity check immediately before SIGTERM. Only identities actually signalled may enter the grace/KILL list and the stop note.
4. Replace the nondiscriminating slow regression with the slow instance's own transient cache, tested before and after the source-stamp change.

All probe files, fixture repositories, stores, copied counterfactual sources and external gate logs were removed after recording the outputs. Only this report is committed.
