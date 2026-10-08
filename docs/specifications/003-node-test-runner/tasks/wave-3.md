# 003 wave 3 briefs

Two rows in parallel on disjoint files. Read `docs/vision.md`, `docs/styleguide.md`, spec 003 as amended, `status.md`, and the reviews `wave-2.md` to `wave-2.7.md` for the closed findings first. Do not run `npm run build`; the coordinator builds at integration. Keep scratch in one `/tmp` directory of your own and remove it; no CPU burners; never delete or kill what you did not start. Run the node:test tests on Node 22 and 24 (nvm is installed).

## 003-22 node:test package entries, and the programmatic-loader note

Outcome: a node:test file's key holds only the installed packages its closure imports, as a Vitest file's does since 001-105, instead of the whole installed-dependency fingerprint; and a loader a preload registers with `module.register()` gets the same note as a `--loader`.

Read: spec 001 D3 as amended for per-package keys (001-105, 001-109, 001-117) and `src/core/types/runner.ts` (`RunnerClosure.packages`, `RunnerEnvironment.packages`, `PackageImport`, `RunnerPackages`, the `runner` field); `src/runners/vitest/packages.ts` as the reference implementation; `src/runners/node-test/graph/` (resolver, parse, modules); `reviews/wave-2.7.md` S1.

Shape: slice. Test first. Seam: the graph's resolution step, where a bare specifier resolves into `node_modules`: record a `PackageImport` (`from`: the importer's directory, `name` without subpath, `manifest: true` for a `<name>/package.json` import) and every builtin specifier (`node:` or bare, without subpath), per module; aggregate the first hop of each test file's closure into `RunnerClosure.packages`; the preload closures' imports into `RunnerEnvironment.packages.imports`; and the loader chain's packages (`tsx`, a `--loader` or `--require` package) into `RunnerEnvironment.packages.runner`. A closure the graph marks incomplete still reports what it saw; the core decides the fallback (`child_process`, `worker_threads`, `module` send a file to the whole fingerprint). Then `reviews/wave-2.7.md` S1: the note `adapter-project.ts` gives a `--loader` is also given for a preload, in `argv` or `NODE_OPTIONS`, whose static closure imports `node:module` and calls `register` (the existing "may register module hooks" detection), saying what it loads enters no key and to declare it in `inputs`. Raise `NODE_TEST_ADAPTER_VERSION` to `"5"`.

Owns: `src/runners/node-test/**`, `test/runners/node-test/**`, `test/integration/node-test*.test.ts`, new fixtures under `test/fixtures/node-test/` (a small installed-package fixture as `test/fixtures/vitest/packages/` is for Vitest). Leave alone: `src/core/**` (read only; ask if a core change seems needed), `test/e2e/**` (003-18).

Done when: in a fixture, bumping a package one node:test file imports re-keys exactly that file; bumping `tsx` re-keys every file of the project; a file importing `child_process` keeps the whole fingerprint; a file importing nothing installed keeps its key across an unrelated install; the `module.register` preload probe of `reviews/wave-2.7.md` S1 gets its note in `argv` and in `NODE_OPTIONS`; lint, typecheck, full suite green on Node 22 and 24.

Use /worker.

## 003-18 node:test end to end; e2e results follow the worktree (002-24)

Outcome: the end-to-end suite runs a node:test project through both shipped plugins the way they ship, and an e2e result can no longer disagree with the worktree Squeal keyed it by.

Read: `test/e2e/` (harness, plugins, install, support, the suites), `test/fixtures/e2e/README.md`, `test/fixtures/node-test/reference/`, spec 003 Testing, the board row 002-24.

Shape: slice. First 002-24: `test/e2e/plugins.ts` `archivePlugin` copies the files `git ls-files plugins/<name>` lists, from the worktree, instead of `git archive HEAD`, so what runs is what Squeal keys by (`squeal.config.json` declares `plugins/**` for `test/e2e`); say in the harness comment that untracked files still do not ship, as a marketplace install would not have them. Then a node:test e2e suite (`test/e2e/node-test.test.ts`, parametrized over both plugins as the others are): a fixture repository shaped like `test/fixtures/node-test/reference` with `tsx` installed by the e2e install cache, `squeal.config.json` written by `squeal init` from its scripts, then: baseline with checks current; an edit that breaks one node:test file delivers `PASS -> FAIL` through the post-tool hook and runs only the affected files; the fix delivers `FAIL -> PASS`; a second worktree inherits with zero runs; `squeal stop` stops the daemon; a Vitest file beside it keeps validating. Give settles the integration test's budget and assert ratios, never wall-clock bounds.

Owns: `test/e2e/**`, `test/fixtures/e2e/**`. Leave alone: everything under `src/`, `plugins/`, `test/fixtures/node-test/` (copy what you need into `test/fixtures/e2e/`).

Done when: every e2e file passes for both plugins on Node 22 and 24 at calm load (the committed bundles of the branch are what run; the coordinator rebuilds at integration, so run against bundles you build into a temp directory if needed and say how); a version raise followed by an e2e run before its commit leaves no e2e failure; lint, typecheck, full suite green.

Use /worker.
