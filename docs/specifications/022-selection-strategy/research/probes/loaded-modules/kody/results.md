# Kody: modules a test evaluated vs its import closure

Probe run 2026-11-14. Inputs: Validate run 43588774129 (push to `main`, success), artifacts
`test-module-map-{node-unit,workers-unit}-{1,2}`; every shard's `commit` is
518a02f027e5158df9384aa788837df289ae4c31, tree ad71b9b0ed2145fac5a7b95e968d43e4ae56dfb6, and the
clone at that commit has the same tree. Kody's Vitest is 4.1.12 and Vite 8.3.4 (package-lock.json).
Scripts and re-run steps: `README.md`. Tags: **[exp]** verified by this probe, **[src]** read in Kody's
source at 518a02f, **[inf]** inferred.

## Answer

- **node-unit (2,009 mapped tests): the closure is much larger than what tests load, and it covers
  what they load.** Per test, median 19 observed vs 43 in the static+dynamic+setup closure; mean 233
  vs 818; summed over tests 467k vs 1.64M pairs (3.5x). Half the tests (1,047) have a closure within
  10% of their observed set; the rest carry the lazy `import()` fan-out: p90 test has 1,528 extra
  modules. Only 30 observed (test, module) pairs fall outside the closure. **[exp]**
- **workers-unit (147 tests): the closure is not larger in a useful sense; it misses runtime reach.**
  116 of 147 tests evaluated the wrangler `main` (`packages/worker/src/index.ts`) and its graph, which
  no import edge in the test reaches: 59,007 observed pairs (1,304 distinct paths) in 117 tests sit
  outside the static+dynamic+setup closure. Adding the `main` closure to every test closes that gap
  (121 pairs left) but makes every test's closure ~2,100 files. **[exp]**
- **Replay of 50 real commits (one map): observed selection picks 43% of what the closure picks in
  node-unit (11,948 vs 27,956 test runs; median per commit 101.5 vs 946), and never picks a mapped
  test the closure misses. A graph without dynamic edges would pick 10,288 but miss observed tests in
  34 of 50 commits.** In workers-unit the closure picks fewer (2,868 vs 3,572) and misses observed
  tests in 30 of 50 commits; closure+`main` picks 147 on almost every commit (5,146). **[exp]**

## Method and caveats

- Static closure: esbuild `transformSync` (TS, `verbatimModuleSyntax` true as Kody's tsconfigs set
  it; false gives identical counts) then es-module-lexer on the output. Resolved: relative paths with
  `.js`→`.ts` twins, extensions and `index.*`; vitest-shared.ts aliases (`#app/`, `#client/`,
  `#universal/`, `#worker/`, `#mcp/`); node-unit's extra aliases (vitest.node.config.ts: `#start/server/`,
  og `.node.ts` swaps, `cloudflare:workers`/`cloudflare:workflows`/`@sentry/cloudflare` stubs,
  `.kody-generated` swaps); workers-unit's `harfbuzzjs` alias (tools/vite-harfbuzz-worker.ts);
  package.json `imports` (root `#*`, packages/worker); workspace packages by `exports`. Other bare
  specifiers stop. Template-literal `import()` globs expanded (4 sites, 0 targets). **[exp]**
- Setup closure: node-unit console-spies.ts, audit-log-spy.ts, cloudflare-global-stub.ts (3 files);
  workers-unit console-spies.ts (1 file) (vitest-shared.ts:71-77, vitest.node.config.ts:147-153).
  tools/vitest-module-map-setup.ts ignored. **[src]**
- Unresolved repo specifiers in files the closures reach: node-unit 3 of 30,546 (0.010%), workers-unit
  5 of 11,414 (0.044%): the two untracked generated files `packages/worker/src/generated/guide-*.mjs`,
  a virtual module path `../.__kody_virtual__/runtime.js` in a workers test, and one test fixture string.
  Over all tracked files (including files no test reaches) 6 / 27,427 node-unit and 435 / 27,129
  workers-unit, the latter all `#start/server/` specifiers that only node-unit aliases. **[exp]**
- One map and one graph (both at 518a02f) serve all 50 commits; a file's edges at an older commit
  may differ. The replay counts a test selected when a changed path is in its set or the test file
  itself changed; observed selection also always picks node-unit's 2 unmapped tests
  (`client/sentry-client.node.test.ts`, `client/sentry-init.node.test.ts`), as Kody's
  `selectObservedTests` does (tools/test-module-map.ts:168-194). **[src]**
- The PR's "was 923 / 97" numbers came from `vitest related` at the PR's commit; ours are the
  emulated static+dynamic closure 27 first-parent commits later (946 / 100). search-tool-runner matches exactly
  (12 vs 89 node-unit, 8 static workers-unit); workers observed 116 vs the PR's 114. **[exp]** for ours,
  the PR text for theirs.

map commit 518a02f027e5158df9384aa788837df289ae4c31 (tree ad71b9b0ed2145fac5a7b95e968d43e4ae56dfb6); verbatimModuleSyntax=true

## Per test file: set sizes (repo modules)

| project | mapped tests | measure | median | p90 | max | mean |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| node-unit | 2009 | observed (CI map) | 19 | 644 | 2410 | 232.5 |
| node-unit | 2009 | static closure | 10 | 631 | 2408 | 202.6 |
| node-unit | 2009 | static+dynamic closure | 40 | 1587 | 3342 | 815.1 |
| node-unit | 2009 | static+dynamic+setup | 43 | 1589 | 3345 | 818 |
| node-unit | 2009 | closure minus observed | 2 | 1528 | 2024 | 585.5 |
| node-unit | 2009 | observed not in closure | 0 | 0 | 2 | 0 |
| workers-unit | 147 | observed (CI map) | 1307 | 1323 | 1901 | 1084.6 |
| workers-unit | 147 | static closure | 305 | 678 | 1008 | 354.3 |
| workers-unit | 147 | static+dynamic closure | 1567 | 1591 | 2012 | 1099.2 |
| workers-unit | 147 | static+dynamic+setup | 1567 | 1591 | 2013 | 1099.7 |
| workers-unit | 147 | closure minus observed | 586 | 607 | 1514 | 416.6 |
| workers-unit | 147 | observed not in closure | 329 | 1290 | 1302 | 401.4 |
| workers-unit | 147 | static+dynamic+setup+wrangler main | 2104 | 2110 | 2116 | 2104 |

- node-unit: setup closure 3 files; tests with closure within 10% of observed: 1047/2009; closure/observed ratio median 1, p90 30.2; tests with an observed path outside the closure: 26 (30 pairs, 3 distinct paths); observed pairs reached only through dynamic edges: 74319 in 418 tests; unmapped on-disk tests: 2 (packages/worker/client/sentry-client.node.test.ts, packages/worker/client/sentry-init.node.test.ts)
  - resolution over files the closures reach: 3 unresolved of 30546 specifiers (0.010%) in packages/worker/src/guide-catalog-modules.ts, packages/worker/src/repo/checks-bare-imports.node.test.ts
  - top observed paths outside the closure: packages/worker/src/generated/guide-metadata.mjs (25); packages/worker/src/generated/guide-catalog.mjs (4); packages/cli/src/defaults.ts (1)
- workers-unit: setup closure 1 files; tests with closure within 10% of observed: 54/147; closure/observed ratio median 1.2, p90 1.3; tests with an observed path outside the closure: 117 (59007 pairs, 1304 distinct paths); observed pairs reached only through dynamic edges: 48273 in 94 tests; unmapped on-disk tests: 0 ()
  - resolution over files the closures reach: 5 unresolved of 11414 specifiers (0.044%) in packages/worker/src/guide-catalog-modules.ts, packages/worker/src/package-runtime/package-secret-authority.workers.test.ts
  - top observed paths outside the closure: packages/worker/src/generated/guide-metadata.mjs (117); packages/worker/src/index.ts (116); packages/worker/src/files/store.ts (116); packages/worker/src/files/catalog.ts (116); packages/worker/src/mcp-client/hub.ts (116); packages/worker/src/mcp-client/read-snapshot.ts (116)
  - with the wrangler main closure (2096 files) added to every test: 121 pairs still outside, in 117 tests: packages/worker/src/generated/guide-metadata.mjs (117); packages/worker/src/og/harfbuzz-worker.ts (2); packages/worker/src/og/harfbuzz-callbacks.wasm (2)

## Per source file: test files selecting it

| source | project | observed | static only | static+dynamic | +setup | +wrangler main |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `…/mcp/capabilities/execution-contexts/capabilities.ts` | node-unit | 16 | 2 | 946 | 946 |  |
| `…/mcp/capabilities/execution-contexts/capabilities.ts` | workers-unit | 7 | 0 | 100 | 100 | 147 |
| `…/mcp/capabilities/packages/publish-external-push.ts` | node-unit | 16 | 1 | 946 | 946 |  |
| `…/mcp/capabilities/packages/publish-external-push.ts` | workers-unit | 7 | 0 | 100 | 100 | 147 |
| `…/mcp/tools/search-tool-runner.ts` | node-unit | 12 | 10 | 89 | 89 |  |
| `…/mcp/tools/search-tool-runner.ts` | workers-unit | 116 | 0 | 8 | 8 | 147 |

- node-unit: 3900 sources selected by something; sum over sources of selected tests: observed 465073, static+dynamic 1635511, +setup 1641300; median per JS/TS source observed 73 vs +setup 82; sources where observed selects more tests than the closure: 3
  - biggest closure-minus-observed gaps: packages/worker/src/identity/disposable-email-domains-module.ts 10 vs 977; packages/worker/src/identity/disposable-email-domains.ts 10 vs 977; packages/worker/src/email/postal-mime-module.ts 1 vs 966; packages/worker/src/repo/isomorphic-git-module.ts 0 vs 946; packages/worker/src/mcp-client/package-subscriptions.ts 1 vs 946; packages/worker/src/run-records/package-subscriptions.ts 1 vs 946
- workers-unit: 2176 sources selected by something; sum over sources of selected tests: observed 159283, static+dynamic 161436, +setup 161512; median per JS/TS source observed 116 vs +setup 100; sources where observed selects more tests than the closure: 1304
  - biggest closure-minus-observed gaps: packages/worker/src/resource-events/dispatch.ts 0 vs 100; packages/worker/src/mcp-client/package-subscriptions.ts 0 vs 100; packages/worker/src/og/resvg-wasm-init.ts 3 vs 101; packages/worker/src/og/og-resvg-wasm.ts 3 vs 101; packages/worker/src/mcp/secrets/pending-package-secret-approvals.ts 6 vs 100; packages/worker/src/mcp/secrets/collect-package-secret-refs.ts 6 vs 100

## Replay: first-parent commits before the map commit, one map for all

| project | commits | measure | total selected | median per commit | commits where observed ⊄ closure |
| --- | ---: | --- | ---: | ---: | ---: |
| node-unit | 50 | observed (incl. unmapped) | 11948 | 101.5 |  |
| node-unit | 50 | observed, mapped only | 11848 | 99.5 |  |
| node-unit | 50 | static+dynamic+setup | 27956 | 946 | 0 |
| node-unit | 50 | static only (no dynamic edges) + static setup | 10288 | 91 | 34 |
| node-unit | 50 | observed (mapped) but not static-only | 2222 | 14 |  |
| node-unit | 50 | observed but not closure (incl. unmapped) | 100 | 2 |  |
| node-unit | 50 | closure but not observed | 16108 | 308 |  |
| workers-unit | 50 | observed (incl. unmapped) | 3572 | 117 |  |
| workers-unit | 50 | observed, mapped only | 3572 | 117 |  |
| workers-unit | 50 | static+dynamic+setup | 2868 | 100 | 30 |
| workers-unit | 50 | static only (no dynamic edges) + static setup | 1652 | 1 | 31 |
| workers-unit | 50 | observed (mapped) but not static-only | 1920 | 30 |  |
| workers-unit | 50 | observed but not closure (incl. unmapped) | 970 | 23 |  |
| workers-unit | 50 | closure but not observed | 266 | 5 |  |
| workers-unit | 50 | static+dynamic+setup+wrangler main | 5146 | 147 | 0 |
| workers-unit | 50 | observed but not (closure+main) | 0 | 0 |  |


## Changed files outside every observed set that could still change results

| category | commits | examples |
| --- | ---: | --- |
| D1 migrations (workers-unit reads them in config) | 1 | daa81735be (packages/worker/migrations/0266-guest-claim-code-hash.sql) |
| patches/ | 1 | daa81735be (patches/@cloudflare+workers-oauth-provider+1.2.1.patch) |
| other non-code not observed (json/md/sql/css/yaml...) | 12 | daa81735be (tools/migration-ledger/0266-guest-claim-code-hash.sql.sha256); e2f5e3e0e8 (tools/ci/durable-object-baseline.json); da779909de (.github/workflows/desktop-release-watch.yml, packages/desktop/README.md) |
| wrangler config | 2 | e2f5e3e0e8 (packages/runtime-worker/wrangler.jsonc); 1df043a365 (packages/worker/wrangler.jsonc) |
| vitest/vite config or plugin (main process) | 1 | 2b3a0035ad (tools/vitest-module-map-reporter.ts, tools/vitest-module-map-setup.ts, tools/vitest-related-capped.node.test.ts, …) |
| package.json / package-lock.json | 3 | eea8593a4a (package-lock.json, packages/worker/package.json); 53e23ff1dd (package-lock.json, package.json); 0384eca5ce (packages/api-docs-worker/package.json, packages/api-worker/package.json, packages/highlight-worker/package.json, …) |

- commits touching a path Kody's pre-push treats as a global test input (isGlobalHookTestPath): 8/50
- commits whose non-code changes sit in an observed set (md/css/json loaded as modules): 8: 246812dbc1 docs/guides/secrets.md; 72f2c453d6 docs/guides/publish-large-packages.md; 8802c60883 docs/guides/execution-contexts.md; 719a8e4efd packages/worker/src/blog/posts/kody-weekly-2026-11-13.md; d91d94f2a9 docs/guides/package-apps.md,docs/guides/package-lifecycle.md; c97a55bd8e docs/guides/api-tokens.md; b6042028b1 docs/guides/api-tokens.md,docs/guides/connect-your-agent.md; 516fbb5a89 docs/guides/package-authoring.md,docs/guides/package-export-jsdoc.md
- docs-only commits (Kody's hook skips unit tests) that change an observed path: 0

## What the static graph misses (observed outside static+dynamic+setup)

| kind | node-unit pairs | workers-unit pairs | example |
| --- | ---: | ---: | --- |
| wrangler `main` loaded by @cloudflare/vitest-pool-workers at runtime | 0 | 58,886 | `packages/worker/src/index.ts` and its graph in 116 tests |
| untracked generated module (built before tests) | 29 | 117 | `packages/worker/src/generated/guide-metadata.mjs` |
| `import()` of a computed URL | 1 | 0 | `api-tokens/legacy-scope-rewrite.node.test.ts:11` imports `new URL('../../../cli/src/defaults.ts', import.meta.url).href` |
| a node_modules package importing back into the repo through an alias plugin | 0 | 4 | satori → `harfbuzzjs` → `packages/worker/src/og/harfbuzz-worker.ts` + `.wasm` |

Not a miss: `.md` (blog posts, `docs/guides/*.md`), `.css?raw`, `.json` and `.wasm` that are
imported by a literal specifier are in both sets; node-unit observed sets hold 141 such markdown
paths (up to 86 tests per file). **[exp]** Neither set sees files a test reads through `fs`: e.g.
`tools/check-migrations.node.test.ts:403-407` copies `packages/worker/migrations` and
`tools/migration-ledger` at runtime **[src]**; workers-unit reads D1 migrations in its config
(vitest.workers.config.ts:49 `readD1Migrations`) **[src]**.

## Escapes and Kody's own guards

- 8 of 50 commits touched a path Kody's pre-push treats as a global test input and answers with a
  full `test:push` (`isGlobalHookTestPath`, tools/git-hook-checks.ts:438-449: package(-lock).json,
  `vitest*.ts`, vite.config.ts, tsconfig*, wrangler*.jsonc, nx.json, project.json,
  tools/vitest-global-setup*, patches/, migrations/). The probe's own categories: package.json or
  lock 3 commits, wrangler config 2, D1 migrations 1, patches/ 1, vitest config/plugin 1, globalSetup 0,
  .env 0 (packages/worker/.env is untracked and loaded by vitest-shared.ts:23). **[exp]** / **[src]**
- Latent escape: Kody's hook skips unit tests when every pushed path is docs-only, and any `.md`/`.mdx`
  or `docs/` path counts (tools/git-hook-checks.ts:89-98, :790, :836-841) **[src]**, yet node-unit tests
  import 68 `docs/` markdown files and 73 blog posts (up to 86 tests each) **[exp]**. A push that
  only edits `docs/guides/secrets.md` would run none of the tests that load it **[inf]**. In this
  window every commit that changed a loaded markdown file (8 commits) also changed code, so it did
  not happen. **[exp]**
- 12 commits touched other non-code files outside every observed set (workflow YAML, READMEs,
  release PNGs, plugin JSON, `tools/ci/durable-object-baseline.json`, a migration-ledger `.sha256`);
  the ledger file is read through `fs` by tools/check-migrations.node.test.ts, so a ledger-only change
  would select nothing under either method. **[exp]** / **[src]**
