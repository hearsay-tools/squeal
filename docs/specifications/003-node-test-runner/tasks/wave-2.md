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
