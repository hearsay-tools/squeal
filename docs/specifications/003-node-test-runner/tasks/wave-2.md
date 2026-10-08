# 003 wave 2 briefs

Three rows in parallel; 003-20 and 003-16 land together. Another coordinator's 001 wave 11 runs 001-104 and 001-105 in `src/core/keys/`, `src/core/scheduler/lockfiles.ts` and `src/runners/vitest/`: stay out of those. Read `docs/vision.md`, `docs/styleguide.md`, the spec as amended (D1, D3 on 2026-10-07), `status.md` and `reviews/wave-1.md` ("Should-fix", "Nits", "Inputs for the next wave") first. Do not run `npm run build`.

## 003-20 graph follow-ups

Outcome: the static closure equals what tsx loads in the three shapes the review proved it missed.

Shape: repair. Seam: `src/runners/node-test/graph/resolver.ts:106` (S1: read the `extends` chain, rebase each `paths` entry onto its defining file's directory, hand enhanced-resolve explicit `baseUrl`/`paths` or `alias`), then the condition set per edge (S2, D3 as amended: `require` conditions for `.cts`, `.cjs`, and `.ts`/`.js` under a nearest `package.json` without `"type": "module"`), then `loader-chain.ts:62-63` (S3: resolve every non-tsx preload from `cwd`, bare ones included; inside the worktree it roots `preloads()`; under `node_modules` it is left to the dependency fingerprint). Then N3, N6, N7.

Owns: `src/runners/node-test/graph/**`, `test/runners/node-test/graph*.test.ts`, new fixture directories under `test/fixtures/node-test/` and additions to `edge/` (keep existing files' behaviour; update `test/runners/node-test/fixtures.test.ts` only if a listing changes). Leave alone: `adapter.ts`, `run/`, `enumerate.ts`, `identity.ts` (003-16).

Done when: each of the review's three probes is a fixture test whose static closure equals the recorder's observed closure and whose `affected` of the missed file is non-empty; a workspace-package preload appears in `preloads()`; N7's memory at 10,000 modules is measured and reported for `status.md`; lint, typecheck, full suite green on Node 22 and 24.

Use /worker.

## 003-16 adapter assembly and observed inputs

Outcome: the daemon validates node:test projects: only the affected files run, and only the delta reaches the agent.

Shape: slice. Seam: `src/runners/node-test/adapter.ts`, replacing the stub with `createNodeTestAdapter(project, options)` over `createNodeTestGraph`, `runNodeTest` and `enumerate`, in the call order of the review's "Inputs" (invalidate before affected, `setTestFiles` after a listing change, one `logDir` subdirectory per project, `env.TMPDIR` as 001 D10 sets it, observed paths minus the static closure recorded). `environment()` per project: runner name `node-test`, the project's `node --version`, canonical config (node, argv, env, cwd, include, exclude), files from `preloads()`, root the project `cwd`. Observed-only paths per D3 as amended: a `meta` key `nodeTest.observed.<project>` (merged in a transaction on write, read at start), entering `closure()` with `complete: false`; the daemon passes the adapter a small read/write pair, so the adapter never opens the store. A missing project Node is a runner failure (every check of the project `unknown`, one note), as `createRecoveringRunner` does for Vitest. Also: `enumerate.ts` uses `identity.ts`'s suffix and stops at skipped suites, and a function-only first argument is named by the function (N1, N2); `WorktreePaths` moves to `src/core/fs/` with `src/runners/vitest/paths.ts` re-exporting it (N4); the deadline test asserts the group is gone (N5); the `stripTypeScriptTypes` warning never reaches the daemon's stderr.

Owns: `src/runners/node-test/adapter*.ts` and new adapter modules, `enumerate.ts`, `run/**`, the runner construction and the observed read/write in `src/core/daemon/` (one new module plus the call site in `daemon.ts`), the new `src/core/fs/` module, the re-export line in `src/runners/vitest/paths.ts`, `test/runners/node-test/adapter*.test.ts`, `enumerate.test.ts`, `run.test.ts`, `test/integration/node-test*.test.ts`. Leave alone: `graph/**` (003-20), `src/cli/**` (003-23, 002-18), `src/core/keys/**`, `src/core/scheduler/**`.

Done when: an integration test on a repository with a Vitest suite and two node:test projects runs a baseline, inherits it into a second worktree with zero runs, and delivers a `PASS -> FAIL` in a node:test file through the Claude Code hooks; an edit to one module runs only the node:test files whose closure holds it; an observed-only path edited in one worktree re-runs its file there and makes the other worktree's lookup miss; lint, typecheck, full suite green on Node 22 and 24. Report every type change.

Use /worker.

## 003-23 `squeal init` seeds `nodeTest`

Outcome: `squeal init` configures a project's node:test suites from its own scripts.

Shape: slice. Seam: a new `src/cli/node-test-seed.ts` called from `src/cli/init.ts` when it writes a new `squeal.config.json`: for the root and each workspace package, a script whose whole text is `node [flags...] --test <globs...>` (flags as in spec 003 D1, quotes allowed, no `&&`, `|`, `;`, redirection or environment assignment) becomes one entry named after the script, with `cwd` the package directory, `argv` the flags in order, `include` the globs. Anything else that mentions `--test` prints a template entry and a note.

Owns: `src/cli/node-test-seed.ts`, the seeding call in `src/cli/init.ts`, `test/cli/init-node-test.test.ts`. Leave alone: `src/cli/codex/**` (002-18), everything outside `src/cli/`.

Done when: cezarion's two scripts (`node --import ../../scripts/test-git-env.mjs --import tsx --test test/unit/*.test.ts` and the same over `test/e2e/*.test.ts`) seed two entries with the right `cwd`, `argv` and `include`; a piped or chained script is refused with a note; an existing config is never overwritten; lint, typecheck, full suite green.

Use /worker.

## 003-17 review of wave 2

Outcome: `reviews/wave-2.md` in this spec folder, with a verdict on the node:test runner as the daemon now runs it (0.1.21).

Range: the 003 commits of `8c58e12..6fde336` on main: 003-20 (graph follow-ups), 003-23 and the Codex init seeding, 003-16 (adapter, daemon wiring, observed store). The 001 and 002 commits in the range are other rows'.

Questions: (1) Can an inherited node:test result pose as current: the observed meta key and the stored-closure write (two daemons writing at once, a worktree started before the write, a path observed in one worktree and absent in another), the first result stored under the pre-observation key, a preload edit? (2) Two runners in one store: can a Vitest and a node:test project with the same test path or project name collide, and does the composite keep one adapter's crash or missing Node from making the other's checks unknown? (3) Do 003-20's fixes hold on a real monorepo layout (cezarion's: `packages/<name>`, a root `tsconfig.base.json`, `--import ../../scripts/...`)? Read it at `/home/agent/projects/cezar` without changing it, or copy it under `/tmp`. (4) Is `squeal init` seeding right for cezarion's scripts, and does it never overwrite a config? (5) Daemon start cost with the node:test modules in the bundle, and the first `affected` after a start on a large project.

Rules: change no code; label every finding proven, plausible or unverified, and only a proven break blocks; probes under `/tmp`, never this repository's store or the cezar repository's.

Use /reviewer.

## 003-24 review fixes (wave 2.5)

Outcome: no node:test pass can pose as current through a preload's run-time import, a broken project, or another worktree's observation.

Read: `reviews/wave-2.md` (Blockers, Should-fix, Nits, Inputs), spec 003 D1, D3, D7 as amended, `status.md`.

Shape: repair. Seam: `record` in `src/runners/node-test/adapter.ts:102-122` (B1: each completed file's `preloadPaths` minus `graph.preloads().paths`, persisted per project with the same transactional merge as the observed key, read at start, added to `environment().files` and treated by `affected` as preload paths; each `preloads().incomplete` reason noted once). Then S1 (a project whose `cwd` is absent, or whose graph build throws, degrades inside `createNodeTestAdapter` like a missing Node: no files, `runnerVersion` `unavailable`, one note, recreated when the directory appears). Then S2: the adapter re-reads the observed key on every `invalidate` and when asked for `closure` or `affected`; a test file whose stored observed set grew is reported affected so it re-keys within the next batch, and a periodic re-read (at most the 30 s reconciliation interval, or `recreatedProjects` if that is the only sound path) closes the case with no local edit. Name in a test the rule that makes "B applies A's pass under a key lacking A's observed path" impossible or bounded. Then N1 and N2 (`src/cli/node-test-seed.ts`, `src/cli/init.ts`), N3 (`graph/parse.ts`), N4 (surface a closure's `incomplete` reasons as notes, one per project with a count and the first reasons), and give `enumerate.test.ts`'s 200 ms bound a ratio or a load guard.

Owns: `src/runners/node-test/**`, `src/core/daemon/node-test-runners.ts`, `src/cli/node-test-seed.ts`, the seeding lines of `src/cli/init.ts`, `test/runners/node-test/**`, `test/integration/node-test*.test.ts`, `test/cli/init-node-test.test.ts`, new fixtures under `test/fixtures/node-test/`. Leave alone: `src/core/watcher/`, `src/core/delivery/`, `src/harness/shared/` (001-111, 001-112, other session), `src/harness/codex/` (002-21), `src/core/keys/`, `src/core/scheduler/`.

Done when: the review's three probes (preload computed import, missing `cwd` beside Vitest, two adapters over one store) are tests that fail on `faa202d` and pass; an edit of the preload's helper re-runs the file and a worktree with a different helper misses; lint, typecheck, full suite green on Node 22 and 24. Do not run `npm run build`.

Use /worker.

## 003-25 re-review of 003-24

Outcome: `reviews/wave-2.5.md` in this spec folder: are `reviews/wave-2.md` B1, S1 and S2 closed, and did the fixes open anything.

Range: the 003-24 commits on main: `b11ee2b`, `07310ab`, `5e2d00d`, `edc5d48`, `2ed5f49`, `9fc408a`, `917ba99`, and `d63887b` (0.1.24, landed at `cf0f21f`). The 002 and 001 commits around them are out of scope.

Questions: (1) B1: can a preload's run-time import still escape every key (a preload of a preload, a preload under `node_modules` that loads a worktree file, two worktrees observing different helpers at once)? Does adapter version 2 re-run exactly the passes stored before preload observation? (2) S1: does any other build failure (a bad `argv`, an unreadable `tsconfig`, a symlink loop) still reject composite calls? (3) S2: is the accepted bound (re-key at the next revision) what the code does, with two real daemons on one store, and is there a case where a pass applied under a key lacking an observed path survives a local edit? (4) The new `observedPreloads` key: merge safety, an older daemon reading it, size growth. (5) Start cost and the enumeration ratio test under load.

Rules: change no code; label findings proven, plausible or unverified; only a proven break blocks; probes under `/tmp`; never this repository's store, never `/home/agent/projects/cezar`. This is the second and last review round on this slice: a remaining blocker goes to the human, not to a third round.

Use /reviewer.

## 003-27 the node:test graph drops resolver caches after a build

Outcome: the node:test graph keeps less memory after it builds, at the same build and re-resolve cost.

Read: spec 003 D3, D4 and goal 6; `status.md` (the 003-20 line: at 10,000 modules and 2,000 test files the module table and enhanced-resolve caches retain about 140 MB, 123 MB of it resolver caches); `src/runners/node-test/graph/resolver.ts`, `graph.ts`, `modules.ts`; `test/runners/node-test/graph-cost.test.ts`.

Shape: slice. Seam: `resolver.ts`, where the `CachedInputFileSystem` and the per-`(tsconfig, condition)` resolvers live. First measure retained heap after a cold build at 1,000 and 10,000 modules (`test/fixtures/node-test/gen-big.mjs` scaled, or 003-20's method), then drop or bound the resolver caches once a build or re-resolve has finished, keeping what a plain edit needs so it stays under five percent of a cold build.

Owns: `src/runners/node-test/graph/**`, `test/runners/node-test/graph*.test.ts`. Leave alone: everything else.

Done when: retained heap after a build at 10,000 modules is measured before and after and reported, with the resolver share reduced; the graph tests and the cost ratios pass; lint, typecheck, full suite green. Do not run `npm run build`.

Use /worker.

## 003-28 the recorder runs before every preload (wave 2.6)

Outcome: whatever a project preload loads at run time, `--require` or `--import`, is observed and keyed, so editing it re-runs the files and a worktree with different content misses.

Read: `reviews/wave-2.5.md` (B1 and its probe, "Inputs for the coordinator"), `reviews/wave-2.md` B1, spec 003 D1, D3, D5, `status.md`; `src/runners/node-test/run/run.ts:74-86` (the command line), `runtime/recorder.mjs`, `runtime.ts`, `adapter-observed.ts`.

Shape: repair. Test first: the review's probe (argv `["--require", "./scripts/setup.cjs"]`, `setup.cjs` runs `require("./helper" + ".cjs")`) fails on `2fa0daf`. Seam: `runtime/recorder.cjs`, a CommonJS recorder that calls `module.registerHooks` synchronously, passed as the first `--require` ahead of the project's argv, so Node installs it before any project `--require` and `--import`. Keep one recorder implementation (the `.mjs` may become a thin re-export, or go), keep the project's argv order and meaning, and find out whether a `--require` or `--import` in the child's `NODE_OPTIONS` (from the project's `env`) can still run before it; if it can, observe it too or note it once. Confirm the recorder reaches the per-file test child that `node --test` spawns. `runtime.ts` locates the new file from the source tree and from a built `dist/node-test/`; `src/harness/build.ts` copies `src/runners/node-test/runtime/*`, so check the `.cjs` is copied (ask the coordinator if that file needs a change). Raise `NODE_TEST_ADAPTER_VERSION` to `"3"`, so passes stored without these observations run once more.

Owns: `src/runners/node-test/**`, `test/runners/node-test/**`, `test/integration/node-test*.test.ts`, new fixtures under `test/fixtures/node-test/`. Leave alone: everything else, `src/harness/build.ts` included unless the coordinator agrees.

Done when: on Node 22 and 24, the probe's helper is in the observed preload paths after one run, an edit of it re-runs the file, and a second worktree with another helper misses; a nested `--require` preload and a `--require` of a package under `node_modules` that loads a worktree file are covered; existing `--import` preload tests unchanged; lint, typecheck, full suite green. Do not run `npm run build`.

Use /worker.

## 003-29 third review of the preload slice

Outcome: `reviews/wave-2.6.md`: is `reviews/wave-2.5.md` B1 closed, and can any preload form still load a file that no key holds. Decided by the human 2026-10-08 as a third round on this slice.

Range: `647f6ce^..e9e36d2` on main, the 003-28 commits, the build fix that replaces `dist/node-test` and the 0.1.28 bundles.

Questions: (1) the review's `--require` probe and its nested and package variants, on the shipped plugin; (2) `NODE_OPTIONS` preloads, a preload that spawns a child, a `--loader`; (3) adapter version 3 re-runs exactly the passes it should; (4) the recorder's own cost and that it never changes a project's resolution.

Rules as for 003-25. A remaining blocker after this round goes to the human.

Use /reviewer.

## 003-30 quoted `NODE_OPTIONS` requires; async loaders on Node 22 (wave 2.7)

Outcome: every `--require` a project's Node will run, however `NODE_OPTIONS` spells it, runs after Squeal's recorder; and a project with an async `--loader` runs on Node 22 as it does without Squeal, with whatever Squeal cannot observe said in a note.

Read: `reviews/wave-2.6.md` (B1, S1, "Inputs for the coordinator") and `reviews/wave-2.5.md`; spec 003 D5 as amended; `status.md`; `src/runners/node-test/run/run.ts` (`childEnv` at about 160-171, the argv at 77-85), `runtime/recorder.cjs`.

Shape: repair. Test first: both probes of `reviews/wave-2.6.md` (the quoted `NODE_OPTIONS` forms `"--require" ./scripts/setup.cjs` and `"--require=./scripts/setup.cjs"`; the identity async loader) fail on `c34c78c` before the fix.

B1: replace the regex with a tokenizer for `NODE_OPTIONS` that follows Node's rules (whitespace separation, double quotes, `\\` escapes inside quotes; read Node's `src/node_options.cc` / `ParseNodeOptionsEnvVar` at the installed versions and cite it), and prepend the recorder when any token is `--require`, `-r`, `--require=...` or `-r=...`. Keep the recorder path quoting. If the tokenizer cannot parse the value, prepend the recorder anyway (an extra recorder only records more).

S1: establish on Node 22.23.3 and 24.21.0 which recorder installation works beside an async loader (`--loader`, `--experimental-loader`, in argv or `NODE_OPTIONS`, and `module.register` from an `--import` preload): for example the recorder registering after the loader chain is ready, or `--import` placement when an async loader is present. Pick the one that keeps observation widest; where a combination leaves `--require` preloads unobserved on a Node version, the adapter says so in one note per project and marks the affected closures incomplete with that reason, so nothing claims complete. Never remove the project's loader and never let the run crash where it did not without Squeal.

Raise `NODE_TEST_ADAPTER_VERSION` to `"4"`. Amend nothing in the spec yourself; report the D5 sentences that change.

Owns: `src/runners/node-test/**`, `test/runners/node-test/**`, `test/integration/node-test*.test.ts`, new fixtures under `test/fixtures/node-test/`. Leave alone: everything else (002-22 is running in `src/harness/` and `src/cli/`).

Done when: on Node 22 and 24, both quoted forms observe the helper, re-run on its edit and miss in a worktree with another helper; the identity and a transforming async loader pass on both versions with the recorder present, and the note appears where observation is narrower; the existing preload and integration tests unchanged; lint, typecheck, full suite green. Keep scratch in one `/tmp` directory of your own and remove it; no CPU burners; never delete or kill what you did not start. Do not run `npm run build`.

Use /worker.

## 003-31 fourth review of the preload slice

Outcome: `reviews/wave-2.7.md`: are `reviews/wave-2.6.md` B1 and S1 closed, and what preload or loader form, if any, still lets a file load outside every key or makes a run crash that runs without Squeal. Decided by the human 2026-10-08.

Range: `bfccdff^..2cafe6f` on main: the 003-30 commits, the Codex command flag and the 0.1.30 bundles.

Rules as for 003-25 and 003-29. A remaining blocker goes to the human.

Use /reviewer.
