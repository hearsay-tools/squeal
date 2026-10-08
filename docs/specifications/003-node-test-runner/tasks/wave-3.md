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

## 003-32 review of wave 3

Outcome: `reviews/wave-3.md` in this spec folder.

Range: `edb5d35` (003-22) and `7112b39`, `c9641f9` (003-18, 002-24) on main, with the 0.1.31 bundles.

Questions: (1) Can a node:test file's per-package key be too narrow: a package reached through a preload, a loader, a workspace symlink, a `require.resolve` with a literal, a type-only import that tsx keeps, a JSON import, a package imported only by an observed path, `NODE_OPTIONS` from the project's `env` against the daemon's? Compare with 001-105's rules for Vitest. (2) Is `module` reported for every load the graph cannot name, and does that send the file to the whole fingerprint in the core? (3) Does the node:test e2e prove what its comments claim (only the affected file ran, inheritance with zero runs), on both plugins, and does copying the worktree's tracked plugin files keep the marketplace-install property? (4) Anything the cezarion dogfooding (003-19) should watch.

Rules as for 003-25. Use /reviewer.

## 003-19 dogfooding on cezarion

Outcome: a section in a new `lessons.md` in this spec folder, with evidence, of Squeal validating cezarion's node:test suites while a real agent works there.

Decided by the human: the `nodeTest` config lives only in a worktree of cezar, uncommitted; nothing reaches cezar's main checkout. Create a linked worktree with `git -C /home/agent/projects/cezar worktree add --detach /tmp/squeal-dogfood-cezarion-<yours> HEAD`, never edit or commit in `/home/agent/projects/cezar`, and remove the worktree with `git -C /home/agent/projects/cezar worktree remove` when done. In it: `npm ci` and cezar's build (a copy without `dist` fails 17 unit tests, `reviews/wave-2.md`), then `node /home/agent/projects/squeal/plugins/codex/dist/cli/squeal.mjs init` to seed `squeal.config.json` (expect `packages/cezar:test:unit` and `test:package`), and record the config it wrote.

The agent: `codex exec -C <the worktree>` with the installed Squeal Codex plugin (0.1.31 or later in the real `~/.codex`, trusted; the human approved it for dogfooding). Give it two or three small real tasks in cezarion that touch modules its node:test unit suites cover, including one that breaks a test and then fixes it, and one in a package the e2e suite covers. Never read `~/.codex/auth.json`; never pass `--dangerously-bypass-hook-trust`.

Record: start-to-ready time and daemon RSS; baseline duration and counts per project; for each edit, which node:test files ran (only affected ones?) and what reached the agent, when; whether the agent ran tests itself and why; closures marked incomplete and why (computed imports, child processes: open question 3); any false, late or missing report; Node version. Stop every daemon you started. The cezar repository's shared Squeal store (`/home/agent/projects/cezar/.git/squeal/`) will hold results from this worktree: say so, and do not delete them.

Owns: `docs/specifications/003-node-test-runner/lessons.md` and throwaway scripts under `research/probes/dogfood/` with a README. No product code: name defects, do not fix them.

Done when: `lessons.md` has a verdict against spec 003 goals 1 to 8, the measurements, excerpts, and numbered defects; the cezar worktree is removed and cezar's main checkout untouched.

Use /worker.

## 003-33 package identity from the resolved path; opaque loads fall back (wave 3.5)

Outcome: no installed package a node:test file reaches can change without changing the file's key.

Read: `reviews/wave-3.md` (B1, B2, their probes and one-worker repairs, "Inputs"); spec 001 D3 for per-package keys and Vitest's `src/runners/vitest/packages.ts` (`sourceLoads`, how a resolved path becomes a package); `src/runners/node-test/graph/modules.ts`, `parse.ts`, `packages.ts`.

Shape: repair. Test first: each probe of the review fails on `210d06c` before the fix. B1: derive the package (name, scoped and nested, and the lookup directory) from the resolved installed path, through the shared module collector, so test closures and preloads agree; the written bare specifier is the fallback only for an unresolved import; `manifest: true` for a package manifest load; an installed target that cannot be assigned a package reports `module`. B2: an unexpandable template import reports `module`; an expanded glob that reaches installed files records their packages or `module`; `createRequire` joins the conservative source scan as in Vitest, including through `process.getBuiltinModule`; an opaque load in a preload sends the project environment to the fallback. Raise `NODE_TEST_ADAPTER_VERSION` to `"6"`.

Owns: `src/runners/node-test/**`, `test/runners/node-test/**`, `test/integration/node-test*.test.ts`, fixtures under `test/fixtures/node-test/`. Leave alone: everything else.

Done when: the review's probes (alias, relative JS and JSON into `node_modules`, argv and `NODE_OPTIONS` preloads, template import, glob into `node_modules`, `createRequire` and `process.getBuiltinModule`) are tests on Node 22 and 24 that assert a re-key and re-run on the bump or the whole-fingerprint fallback; 003-22's existing package tests unchanged; lint, typecheck, full suite green on Node 22 and 24. Do not run `npm run build`. Keep scratch in one `/tmp` directory of your own and remove it; no CPU burners.

Use /worker.

## 003-34 re-review of 003-33

Outcome: `reviews/wave-3.5.md`: are `reviews/wave-3.md` B1 and B2 closed. Second round on this slice; a remaining blocker goes to the human. Range filled in at dispatch. Rules as for 003-32. Use /reviewer.
