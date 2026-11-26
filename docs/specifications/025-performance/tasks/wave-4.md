# Wave 4: hook latency creep (rows 025-16 to 025-20)

Approved by the human 2026-11-26: rows 025-16, 025-17, 025-18 and 025-20, and option A for 025-19 (the latency
test measures what users run). The 80 ms p95 budget stays; no tolerance. Evidence: `research/hook-bundles.md`
(025-14) and `research/hook-runtime.md` (025-15); read the sections each brief names. All five rows run in
parallel on disjoint files. Peers own `src/core/presence/`, `src/core/store/store.ts`, `src/core/delivery/stopped.ts`
(row 021-39) and `src/core/scheduler/`, `src/core/daemon/{daemon,run-group}.ts`, `src/core/runner-host/remote/`
(spec 026): no row edits them. No row edits `docs/board.md` or runs `pnpm run build` in its tree; `plugins/*/dist`
is rebuilt by the coordinator. Any direct `vitest` run gets `timeout 600`; verify with
`squeal status --wait 60000 <changed-path>...`. Timings name the load average. Final message: measured before/after
p50/p95 per hook, decisions the brief did not settle.

## 025-16: load `node:` builtins through `process.getBuiltinModule` (slice; opus medium)

Outcome: no Node bundle pays the ESM facade for builtins. Read `hook-bundles.md` sections 2 and 4 (`builtins`;
its probe `probes/hook-latency/bundles/build-variant.ts` holds a working plugin). Start in `src/harness/build.ts`
`bundleOptions`: an esbuild plugin that turns each `node:` import into `process.getBuiltinModule` reads, each
export a pure call so unused ones drop. OpenCode's Bun `plugin.mjs` keeps its own options (check
`src/harness/opencode/build.ts`). Owns `src/harness/build.ts`, one new module beside it, and one new test under
`test/harness/`. Done when: a test builds to a temp dir (reuse an existing build helper, e.g. the one
`test/harness/bundle-helpers.ts` or `plugin-data-claude-code.test.ts` uses) and fails on any static `node:`
import in a Node bundle; hook outputs unchanged (existing hook tests pass); a scratch build is byte-identical on
Node 22.19 and 24.x; hooks measured faster than the current build, interleaved.

## 025-17: load the status snapshot builder and the code store only when used (slice; opus high)

Outcome: hooks that do not deliver those parts do not load them. Read `hook-bundles.md` sections 1 and 5 item 2.
Start in `src/harness/shared/context.ts`: its imports of `createStatusBuilder` (`status/snapshot`, which pulls
`status/outstanding`, `status/imports`, `node-pin`) and `codeSource` (`delivery/code-source` → `code/store/store`,
`code/coverage/parts`, `node:zlib`). Use `await import()` where the call is already async, or narrower imports;
do not turn on esbuild `splitting` (measured slower). Leave `keys/*` and `store/*` alone. Owns `context.ts`,
`src/core/status/snapshot.ts`, `src/core/delivery/code-source.ts`, `src/core/lint/surface/source.ts`. Done when:
the scratch-built `pre-tool-use` and `stop` lose 70 KB or more each; hook tests pass; hooks measured.

## 025-18: cut the hooks' own repeated work (survey then slice; opus high)

Outcome: `stop`'s work after load moves back toward 0.1.364's 13 ms (now about 20 ms p50 on boat.dev, 26 to
32 ms by 025-14's split). Read `hook-runtime.md` "Runtime work" and its `results/trace-summary.json`. First edit:
read the policy once per hook process (`stop` reads `squeal.config.json` 7 times, `session-start` 9), likely a
per-process memo in `src/core/daemon/config-file.ts` `loadConfigFile` or its callers. Then profile `stop` and
`session-start` (`--cpu-prof`, the probe's SQL counter) and remove repeated SQL and file reads without changing
what a hook delivers. Owns `src/core/daemon/config-file.ts`, `src/harness/shared/stop*.ts`, and other files on
the Stop/SessionStart path except 025-17's and the peers' files above; ask the coordinator before touching one of
those. Done when: `stop` p50 at least 5 ms lower, interleaved against the current build; hook and policy tests
pass; a config edit during a session is still seen by the next hook process.

## 025-19: the latency test measures the path users run (slice; opus medium)

Outcome: `test/harness/latency.test.ts` asserts the 80 ms p95 on hooks started through
`plugins/claude-code/hooks/run node <bundle>` with a warm compile cache in a temp directory, as users run them
since 025-07; the uncached direct run is still printed in the table but not asserted. Read `hook-runtime.md`
"Choice of test path". Add a helper beside `runBundle` in `test/harness/bundle-helpers.ts`; do not change
`runBundle` (other tests use it). Warm the cache with one untimed run per hook. Owns those two files. Done when:
the test passes on this host at load <= 4 three times in a row against the committed `dist`, budget unchanged,
and the uncached line still shows.

## 025-20: OpenCode's bridge uses the compile cache (slice; opus medium)

Outcome: OpenCode hook bridge processes start with Squeal's own `NODE_COMPILE_CACHE` when the user set none,
marked `SQUEAL_OWN_COMPILE_CACHE=1` as `plugins/claude-code/hooks/run` does, so test processes still strip it.
Read `hook-runtime.md` "Startup paths". Start in `src/harness/opencode/bridge-client.ts` `bridgeStart`. Owns that
file and its test. Done when: a test shows the bridge's environment carries the cache when unset and keeps a
user's value; `test/harness/opencode/latency.test.ts` passes; `test/keys/launchers.test.ts` still passes.

Use /worker.

## 025-21: the other harness latency tests measure what users run (slice; opus medium; coordinator's call, test-only, 2026-11-26)

Outcome: the 80 ms p95 budget in `test/harness/{codex,antigravity,opencode,pi}/latency.test.ts` holds on the path
each harness really starts, as 025-19 did for Claude Code (the human's option A). On candidate 0.1.641 at load 1.2
to 1.7, Codex and Antigravity `stop` read exactly 80 ms p95 in one of three sequential rounds, on uncached direct
`runBundle` runs over fixture stores without write markers. Read `hook-runtime.md` "Startup paths". Changes:
(1) every `seeded()` store calls `ensureWriteMarkers` after seeding, as `test/harness/latency.test.ts` does;
(2) Antigravity starts each hook through `plugins/antigravity/hooks/run` with a warm compile cache (reuse
`runLaunched` from `test/harness/bundle-helpers.ts`, adding a plugin-dir parameter if needed); (3) Codex runs its
runtime bundles with the compile cache warm in a temp dir, as its adapter does (`src/harness/codex/adapter/index.ts`
`enableCompileCache`), or through the adapter if that is practical; (4) the uncached direct run stays printed, not
asserted. Budget, load gate and CI gate unchanged. OpenCode's margin check against Codex must compare like with like.
Owns those four test files and `test/harness/bundle-helpers.ts`. Done when: the four tests pass three sequential
rounds in a row on this host at load <= 4 against the committed `dist`.

## Wave 4.5: repair of review `reviews/0.1.641.md` (FAIL on `f529511fd`)

### 025-16 repair (repair; opus high)

Fix B1 to B3 of `reviews/0.1.641.md` in `src/harness/builtins.ts` and its callers; fold in S1. CI `45813103996`
confirms B2 (every `cli/squeal.mjs` drifts between Node 22 and 24) and B3 (`test/e2e/spec-026-{tiered,remote}`
fail to load: `Cannot use plugins in synchronous API calls`). Lead for B1 and B2: make each virtual builtin
module CommonJS, `module.exports = process.getBuiltinModule("node:x")`, so esbuild reads properties off the live
object at use and enumerates no exports at build time; or another design with the same two properties. Then
measure it against the base (`bb99751b5`) and the current plugin, interleaved: the gain must stay. If no design
keeps both the semantics and the gain on every Node bundle, restrict the plugin to the hook entries and say why.
B3: the synchronous caller `test/e2e/spec-026-build.ts` moves to the async `build`, or the plugin is applied
where every caller is async; shipped bundles and what the e2e suites build must stay alike. S1: the OpenCode
latency test prints an uncached diagnostic line like the other three. Owns `src/harness/build.ts`,
`src/harness/builtins.ts`, `test/harness/builtins-bundle.test.ts`, `test/e2e/spec-026-build.ts`,
`test/harness/opencode/latency.test.ts`. Done when: the review's B1 probe (named, namespace and dynamic imports
see a replaced `fs.readFileSync` after `syncBuiltinESMExports`) passes as a test; a scratch build is
byte-identical on Node 22.19, 24.21 and 26.13 for every bundle, `cli/squeal.mjs` included; both e2e files load;
hooks are measured faster than the base. Do not run `pnpm run build` in your tree. Use /worker.
