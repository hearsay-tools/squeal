# 017-11: pnpm for repository development

Worker db4f8682, 2026-10-26. The repository installs, runs its scripts and runs CI with pnpm. Squeal's product behaviour, its npm fixtures and users' installs are unchanged: no file under `src/` changed.

## Decisions

1. **pnpm 12.15.0**, pinned in `package.json` `packageManager`. It was the newest release on 2026-10-26 (published 2026-10-21); the human's cezar repository uses pnpm 12.11.2. pnpm 12 writes `pnpm-lock.yaml` as two YAML documents: its own pin (`packageManagerDependencies`, with integrities), then the project lock.
2. **Lockfile import, no upgrade.** `pnpm import` of `package-lock.json`. Every one of the 397 package versions in npm's lock outside the toolchain folder is in pnpm's lock and no other, and the toolchain keeps its 11 (typescript-eslint 8.72.0 and its `@typescript-eslint/*`, ts-api-utils 2.5.0, TypeScript 6.0.3). `package-lock.json` is removed.
3. **Default isolated layout.** No `node-linker`, no public hoisting: the root `node_modules` holds only the direct dependencies, as symlinks into `node_modules/.pnpm`. A hoisted layout would have kept npm's paths in the bundles, but it gives up pnpm's strictness and puts `ts-api-utils` beside TypeScript 7 again.
4. **The ESLint test toolchain is a pnpm workspace project** (`pnpm-workspace.yaml`, `packages: [test/fixtures/lint/toolchain]`), so `test/fixtures/lint/toolchain/node_modules/{typescript,typescript-eslint}` exist as `test/lint/provider/helpers.ts` expects. The root no longer names `squeal-lint-toolchain` (`file:`), which pnpm would copy into its store with its own install. typescript-eslint's `eslint` peer resolves from the workspace root (pnpm's `resolvePeersFromWorkspaceRoot`) to ESLint 10.13.0, as npm's hoisting did. Its `typescript` peer, and ts-api-utils's, resolve to 6.0.3 through the project, so npm's `overrides` entry for ts-api-utils is removed: no override is needed.
5. **std-env** `^4.2.0` (Vitest 5.0.3's own range) is a new dev dependency at the version npm hoisted, 4.3.0. `test/runners/vitest/child/environment.ts` imports it to print what Vitest's std-env detects; pnpm does not hoist it, and `tsc` failed on the import.
6. **Dependency build scripts.** pnpm 12 fails an install (`ERR_PNPM_IGNORED_BUILDS`) for any build script `allowBuilds` does not decide. `esbuild: true`: its postinstall checks the platform binary and links it over the JS shim, as npm ran it. Off: `@parcel/watcher` (builds only with `npm_config_build_from_source=true`), `msgpackr-extract` (compiles only when its prebuilt binary is missing), `opencode-ai` (copies the platform binary to `bin/opencode.exe`; the tests run the platform package's binary), `@google/genai` (echoes) and `protobufjs` (prints a version warning).
7. **pnpm 12 runs an install before `pnpm run`** when dependencies are missing or stale (`verify-deps-before-run`), and passes a literal `--` on to the script (`pnpm run check:version -- a b` gave the script `--` as its base and failed). The CI version job, which installs nothing, runs `pnpm --config.verify-deps-before-run=false run check:version "$BASE" HEAD`. The coordinator skill now says `pnpm run check:version origin/main`, without `--`.
8. **CI.** `pnpm/action-setup@v6.1.0` before each `actions/setup-node@v4`, with no `version` input, so it installs `packageManager`'s version; `cache: pnpm`; `pnpm install --frozen-lockfile`; `pnpm exec` for Vitest, Biome and tsc; `pnpm run build`. The install runs build scripts as decided in 6, as `npm ci` ran them.

## The key-format alarm across two lock formats (`test/keys/validity`)

The alarm compares the last release's tree with the candidate's. The last release (`squeal--v0.1.357`) holds npm's lock and the candidate pnpm's, so `dependencyLines` read `package-lock.json` and failed (ENOENT), and `extractTree` archived a path the next pnpm release would not have.

- `lock.ts` reads either lock as one graph (`lockGraph`): npm's by location (lockfile versions 2 and 3), pnpm's by snapshot through `src/core/keys/pnpm-lockfile.ts` (`readPnpmLockfile`, on the one document it reads) and `childOf`.
- `closureLines` gives one line per class of packages that load the same code: two nodes are one class when their `name@version#integrity` match and each of their imports loads one class, refined until no class splits. A line holds the identity, `xN` when N copies are in the class, each import as `name=name@version` of the class it loads (`~n` when classes share a `name@version`), and a line `.` holds the roots' imports. So npm's lock and pnpm's give equal lines for the same packages, and a version, integrity, loaded copy or copy count that moves still moves a line. Before this, a line was `location@version#integrity`, which no pnpm lock has.
- A lock it cannot read throws: none or both lock files, npm lockfile version 1, a pnpm lock with no single readable document, a package without a version or integrity, an edge to a missing snapshot, a required name not found.
- `extractTree` archives `src`, `tsconfig.json`, `package.json`, the ref's one lock, `pnpm-workspace.yaml` and each pnpm workspace's manifest (the lock's importers).
- `installLock` runs `npm ci --ignore-scripts` for npm's lock, and for pnpm's checks that `pnpm --version` in the tree equals its `packageManager` pin, then `pnpm install --frozen-lockfile --ignore-scripts --prefer-offline`. esbuild's binary comes from its platform package, so `--ignore-scripts` keeps it.

Evidence:

- All five components at `squeal--v0.1.357` (npm) against this tree (pnpm): equal lines (`global` 28, `vitest` 29, `node:test` 33, `pytest` 30, `recorder` 28), 5 to 18 ms each. So the first pnpm release fires no dependency alarm.
- `lock.test.ts`, fixture pair `test/fixtures/keys/locks/{npm,pnpm}` (one package set locked by npm 11.19.0 and pnpm 12.15.0): equal lines; a transitive version or integrity change moves them in either lock; swapping which `ms` `debug` loads moves them while the locked set stays equal; an npm copy more gives `x2`; seven unreadable shapes throw. The synthetic case of two `debug@2.6.9` snapshots fails two mutants: lines without the refinement, and lines without the roots' line `.` (both run on 2026-10-26, each 1 failed, 5 passed; unmutated 6 passed).
- The four risk-9 tests now overlay `pnpm-lock.yaml` (direct `enhanced-resolve`, transitive `tapable` version and integrity, `esbuild`, `@biomejs/biome`); Squeal: pass.
- `installLock` on an extract of HEAD (pnpm): 7.3 s with a warm store, then its esbuild built a file. On an extract of `squeal--v0.1.357` (npm ci): 7.1 s, the same. `lock.test.ts` keeps the pnpm case as a test.

## Other tests and helpers

| Path | Why |
| --- | --- |
| `test/helpers/opencode.ts` | `opencodeBinary` looked in the root `node_modules` for `opencode-<platform>-<arch>`; pnpm keeps it beside `opencode-ai` in its store. It now resolves from `opencode-ai`'s real folder, as that package's postinstall does. |
| `test/runners/node-test/graph-bundle.test.ts` | esbuild names inputs by real path, `node_modules/.pnpm/<id>/node_modules/<name>/…`; the check accepts that or npm's path. |
| `test/e2e/install.ts` | Read `node_modules/vite` and `node_modules/rolldown`, which pnpm does not create, so every e2e file failed at import; CI's `vitest run` includes `test/e2e`. Each is now found as Node finds it from its dependent (Vitest, then Vite). All 20 e2e files collect. |
| `test/cli/setup/gates.test.ts` | One literal: the repository's own gate line now says `pnpm exec vitest run`. `scanGates` still reads it as a mention only; a bare "Run `pnpm exec vitest run` before you finish." is a gate (probed). |

Instructions: `CLAUDE.md` (and `AGENTS.md`, a link to it) has an install paragraph and pnpm commands; `docs/process.md`; the coordinator, reviewer and worker skills (`.agents/skills` links to them); dev-command comments in `vitest.real-cli.config.ts`, `test/keys/validity/compare-refs.ts` and `test/keys/validity/notes.md`. Dated measurements, research, reviews, eval results, the board and `evals/ledgerline` (an npm project agents work in) keep npm.

## Key validity

- No key, key format or replay recording changed, and no product source. `test/keys/key-format.test.ts` passes here.
- In this repository, the install fingerprint moves from npm's hidden lockfile to pnpm's `node_modules/.pnpm/lock.yaml` (one document, which the per-package reader reads). Every check here reads it, so every stored result goes stale once per worktree that installs this tree: here Squeal queued all 1,153 test files at revision 6 ("These results follow a dependency install").
- `cli/squeal.mjs` in every plugin's `dist` will differ at the next build only in esbuild's `// node_modules/…` comments, which become `// node_modules/.pnpm/<id>/node_modules/…` (built to a temp folder: 24 files identical, 1 differs only in those paths). The four bundle tests fail here until the coordinator rebuilds and raises the version. Keys do not hold bundle bytes, so no user's key moves.

## Checks run

- `pnpm install --frozen-lockfile`, clean, from only `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` and the toolchain manifest: root ESLint 10.13.0, `eslint9` 9.39.5, TypeScript 7.0.2; the toolchain's TypeScript 6.0.3 and typescript-eslint 8.72.0; typescript-eslint, typescript-estree and ts-api-utils each load TypeScript 6.0.3; no typescript-eslint or ts-api-utils at the root.
- Node 22.19.0, `node node_modules/vitest/vitest.mjs run --maxWorkers=2` of `test/lint/provider/{provider,ts-config,refresh,units,replay-eslint9,replay-eslint10}.test.ts` and `test/lint/integration/{reads,b3}.test.ts`: 8 files, 34 tests passed, 75 s.
- `pnpm run lint` and `pnpm run typecheck`: clean.
- Squeal (Node 24), affected: the validity files, `key-format.test.ts`, `launcher-copy`, `node-floor`, the OpenCode files, `graph-bundle`, `gates`, `harness.test.ts` (std-env) pass. The full list of pending files is in the final report.

## For the coordinator

- Rebuild the bundles and raise the patch version (the parent's step). `test/harness/{plugin,codex/plugin,opencode/package,pi/package}.test.ts` fail until then; their test names still say `npm run build`, kept because a rename re-keys them and they are not this row's files.
- Cezar's `worktreeSetup` still runs `npm ci` (the parent owns it).
- The e2e fixture installs still use npm with `--offline`, then `--prefer-offline`: pnpm does not fill npm's cache, so a cold host fetches Vitest and Vite once.
