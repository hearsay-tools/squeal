# 028 Jest runner: Wave 3.5 repair briefs (candidate 0.1.646)

Fixes the proven blockers and should-fix from `docs/specifications/028-jest-runner/reviews/0.1.646.md` (B1, B2, N1). Coordinator handles B3 (`install.sh` version sync with the final `0.1.646` version/bundle commit) and the `lessons.md` private-material line.

Two workers run in parallel with strictly disjoint file ownership. Neither runs `pnpm run build` or a full test suite. Pass `TMPDIR=/tmp` when running Vitest on Jest tests so the pre-installed strict-layout Jest 29.7.0 and 30.5.2 caches under `/tmp/squeal-jest-*` are reused without installing packages; never modify those cached fixtures.

---

## Worker 1 (`028-06-fix-b1-n1`): B1 config-discovery proof + N1 affected-only `.d.ts` regression

### Read first

- `docs/specifications/028-jest-runner/reviews/0.1.646.md` (sections B1 and N1)
- `docs/specifications/028-jest-runner/spec.md` (D3.2, D6.3)
- `src/runners/jest/describe.ts`
- `test/runners/jest/describe.test.ts`
- `test/runners/jest/ts-jest-dts.test.ts`
- `test/kit/worktrees.ts` (to see what `OpenWorktree` provides for core observed-input selection / current-result reuse)

### File ownership (strict)

- `src/runners/jest/describe.ts`
- `test/runners/jest/describe.test.ts`
- `test/runners/jest/ts-jest-dts.test.ts`

Do not edit any other files. (Note: Worker 2 adds an optional `project?: string` field to `JestProject` in parallel; the coordinator will add the 1-line `project.project !== undefined` fallthrough guard in `describe.ts` at integration if needed, or you can also check if `configAbs` is not a plain single-project config.)

### Task 1: Fix B1 (`src/runners/jest/describe.ts`, `test/runners/jest/describe.test.ts`)

`jestHere()` currently checks only `realPath(dir) === cwd`. That lets plain `jest a.test.cjs` match a policy project pointing to a non-default config (`policy.jest.cjs`) or a different `cwd`, even when plain Jest discovers `jest.config.cjs` and runs with different globals/transforms/setup.

In `jestHere(root, cwd, projects)`:
1. Compute `configAbs = toAbsolute(root, project.config)` and `dir = project.cwd === undefined ? dirname(configAbs) : toAbsolute(root, project.cwd)`.
2. Require `realPath(dir) === cwd` AND `realPath(dirname(configAbs)) === cwd`. If `project.cwd` differs from `dirname(configAbs)`, fall through (`return []`): plain Jest run from `cwd` does not guarantee selecting a config in another directory.
3. Require that Jest's automatic config discovery in `dir` selects `configAbs` unambiguously:
   - Check every Jest auto-discovered config filename in `dir`: `jest.config.js`, `jest.config.ts`, `jest.config.mjs`, `jest.config.cjs`, `jest.config.mts`, `jest.config.cts`, `jest.config.json` (existing files).
   - Also check `package.json` in `dir`: if it exists and is valid JSON object with `Object.hasOwn(manifest, "jest")`, include `join(dir, "package.json")` as an auto-discovery candidate. If `package.json` exists in `dir` and cannot be parsed as JSON, treat discovery as ambiguous and fall through (`return []`).
   - There must be **exactly one** candidate in `dir`, and `realPath(candidate)` must equal `realPath(configAbs)` (both non-null).
   - If 0 candidates, >1 candidates (Jest throws multiple-config error), or the sole candidate is not `configAbs` (e.g. policy uses `policy.jest.cjs` alongside `jest.config.cjs`, or `policy.jest.cjs` alone), fall through (`return []`).
4. Keep every existing guard in `jestCommand`, `direct`, `invocation`, `jestFiles` (plain Jest forms only, no `--config`/`-c`, no Nx interception, no command rewriting, safe output flags only, explicit listed paths only).

In `test/runners/jest/describe.test.ts`:
- Update the existing `JEST.context` test so `packages/web/jest.config.ts` exists on disk in the temp dir.
- Add unit tests for `JEST.context`:
  - Custom config (`policy.jest.cjs`) alongside default `jest.config.cjs` -> falls through.
  - Custom config (`policy.jest.cjs`) alone with no default config -> falls through.
  - Multiple auto-discovered configs in the same directory (`jest.config.cjs` + `jest.config.js`, and `jest.config.cjs` + `package.json` with `"jest"` key) -> falls through.
  - `package.json` with `"jest"` key as the sole config -> recognized.
  - Explicit policy `cwd` different from `dirname(config)` -> falls through.
- Add a real both-major (Jest 29.7.0 and Jest 30.5.2, reusing `installJest` from `../../helpers/jest-env.js`) regression matching review `0.1.646.md` B1: two configs (`policy.jest.cjs` with `globals: { FLAG: "configured" }` and `jest.config.cjs` with `globals: { FLAG: "direct" }`) selecting the same `a.test.cjs`, proving `jest --config policy.jest.cjs` exits 0 while plain `jest --runInBand --ci a.test.cjs` exits 1, and proving `recognizeTestCommand` with `commandContext` returns `null` (does not match). Also verify the positive case on both majors where `jest.config.cjs` IS the sole config and policy points to `jest.config.cjs` (with explicit `cwd` matching vs differing).

### Task 2: Fix N1 (`test/runners/jest/ts-jest-dts.test.ts`)

Keep the existing initial multi-file batch attribution assertions (`observed` and `open.keyed(A)` / `open.keyed(B)`). After editing `types/a.d.ts` to `broken` and calling `invalidate`:
- Drive the edit through Squeal's real core observed-input / key-staleness selection path (check how `OpenWorktree` in `test/kit/worktrees.ts` and `test/kit/scenarios/` select stale/affected files and check current-result reuse via `open.current` / `open.keys` / `store`).
- Select ONLY the files that are no longer current (must equal `[A]`, NOT `[A, B]`), run ONLY those selected files, and assert:
  - Only `A` ran (`second.completedFiles` is `[A]`),
  - `A` failed with the type error (`type error: a.test.js does not match its declarations`),
  - `B` was NOT re-run and its prior passing result remains current in the store.

### Verification

Run:
- `pnpm run lint`
- `pnpm run typecheck`
- `TMPDIR=/tmp pnpm exec vitest run test/runners/jest/describe.test.ts test/runners/jest/ts-jest-dts.test.ts`
- `git diff --check`

Commit your changes cleanly on your worker branch and report exact commands and results.

---

## Worker 2 (`028-06-fix-b2`): B2 inline `projects` objects through setup, policy, environment, and execution

### Read first

- `docs/specifications/028-jest-runner/reviews/0.1.646.md` (section B2 and "Inputs for the repair and next wave" #2)
- `docs/specifications/028-jest-runner/spec.md` (D1, D2.3, D4.1)
- `src/core/types/policy-jest.ts`
- `src/core/daemon/policy-jest.ts`
- `src/cli/jest-seed.ts`
- `src/cli/setup/jest.ts`
- `src/runners/jest/environment.ts`
- `src/runners/jest/run/wrapper-config.ts`
- `src/runners/jest/run/run.ts`
- `test/daemon/policy-jest.test.ts`
- `test/cli/setup/jest.test.ts`
- `test/runners/jest/environment.test.ts`
- `test/runners/jest/adapter.test.ts`

### File ownership (strict)

- `src/core/types/policy-jest.ts`
- `src/core/daemon/policy-jest.ts`
- `src/cli/jest-seed.ts`
- `src/cli/setup/jest.ts`
- `src/runners/jest/environment.ts`
- `src/runners/jest/run/wrapper-config.ts`
- `src/runners/jest/run/run.ts`
- `test/daemon/policy-jest.test.ts`
- `test/cli/setup/jest.test.ts`
- `test/runners/jest/environment.test.ts`
- `test/runners/jest/adapter.test.ts`

Do not edit any other files.

### Design: single owner for inline project identity across setup, config reading, keying, and execution

When a root Jest config defines `projects: [...]`, entries can be:
- **String entries** (file paths, directory paths, or `<rootDir>/packages/*` globs): continue expanding each string entry into its own config file (`{ name, config: "packages/a/jest.config.js" }`, with `project` omitted), as today.
- **Inline project objects** (`{ displayName?: string | { name: string }, rootDir?: string, testMatch?: ..., ... }`): keep the user's root config untouched and address each inline project via a new optional `project?: string` field on `JestProject` pointing to the root config file (`{ name, config: "jest.config.cjs", project: "<selector>" }`).

Requirements:
1. **Policy (`src/core/types/policy-jest.ts`, `src/core/daemon/policy-jest.ts`):**
   - Add `readonly project?: string;` to `JestProject` with JSDoc explaining it selects one inline project from a multi-project `config` (by unique `displayName`, or `#<index>` 0-based among inline project objects when unnamed, duplicated, or starting with `#`).
   - Add `project: nonEmptyString` to `FIELDS` in `src/core/daemon/policy-jest.ts` (optional).
   - Add policy loader unit tests in `test/daemon/policy-jest.test.ts` (valid `project`, empty string rejected).

2. **Single-owner inline selector rule (shared between setup, `READER`, and `wrapper-config.ts`):**
   - Define the exact deterministic selector rule in one place (for example exported helpers in `src/runners/jest/environment.ts` and mirrored cleanly in the child script / wrapper):
     - Given `raw.projects` (the `projects` array from `readInitialOptions(configPath, { skipMultipleConfigError: true }).config`, which evaluates sync/async JS/CJS/MJS/TS/JSON/package.json configs), extract the inline project objects (`entry !== null && typeof entry === "object" && !Array.isArray(entry)`), preserving their order.
     - Note: indexing over inline objects (not the mixed array after glob expansion) ensures adding/removing a directory matched by a string glob like `"<rootDir>/packages/*"` never shifts an inline project's selector!
     - Extract an inline object's display name: `typeof d === "string" ? d.trim() : (d && typeof d === "object" && typeof d.name === "string" ? d.name.trim() : "")`.
     - If an inline object has a non-empty display name that does NOT start with `#` AND occurs only once among the inline objects in that root config, its selector is that display name (e.g. `"unit"`, `"integration"`).
     - Otherwise (unnamed, duplicate display name, or display name starting with `#`), its selector is `"#<inlineIndex>"` (0-based index among inline objects, e.g. `"#0"`, `"#1"`).
   - Resolution of `selector` against `raw.projects`:
     - If `/^#\d+$/.test(selector)`: pick `inlines[Number(selector.slice(1))]`, or fail clearly if out of range.
     - Else: pick the unique inline object whose trimmed display name equals `selector`, or fail clearly if 0 or >1 match.
   - `rootDir` normalization when reading or running a selected inline object:
     - Let `configDir = path.dirname(configPath)`.
     - If `selected.rootDir` is absent, set `rootDir: configDir`; if `selected.rootDir` is a relative string (including `"."`), resolve `path.resolve(configDir, selected.rootDir)`; if absolute, keep it. (Never let `rootDir` resolve against `cacheDir` or an arbitrary `cwd`!)
     - Strip any `projects` key from the selected object if present.
     - IMPORTANT: verify on real Jest 29.7.0 and Jest 30.5.2 how `readConfigs` resolves `<rootDir>` inside an inline project object (e.g. `testMatch: ["<rootDir>/unit/*.test.cjs"]`, `setupFiles: ["<rootDir>/setup.js"]`) when `rootDir` is `"."`, a subdir `"packages/unit"`, or omitted, so Squeal's `READER` and `wrapper-config.ts` match `jest --config jest.config.cjs` identically!

3. **Config reading & environment keying (`src/runners/jest/environment.ts`):**
   - Update `READER` to accept optional 4th argv `projectSelector` (`""` when `project.project === undefined`).
   - When `projectSelector !== ""`:
     - Keep `recording = true` while evaluating the root config (`readInitialOptions` + `readConfig` / `readConfigs`) so ALL files loaded/read by the root config (and any helper modules it imports) are captured in `configDeps` for config-dependency invalidation!
     - Resolve the selected inline project object using the selector rule, normalize its `rootDir` relative to `dirname(configPath)`, and normalize it through Jest's `readConfig({ $0: "jest", _: [], ci: true }, selectedObject, ...)` (or verify `readConfigs` parity on both Jest 29 and Jest 30!). Also resolve `preset` from `selected.preset` if string.
     - Walk `projectConfig.roots` for `testPaths` as usual.
   - When `projectSelector === ""` and `readConfig` runs on a root config that has inline `projects`: also expose enough info in `JestRead` (or a small `readJestRootProjects` helper using `readConfigs` / `readInitialOptions`) so `seedJest` can see BOTH string entries and inline project objects (with their selectors and resolved reads) accurately!
   - In `jestEnvironment()` and `unavailableEnvironment()`:
     - Include `...(project.project === undefined ? {} : { project: project.project })` in `config` so two inline projects from the same `jest.config.cjs` have distinct deterministic `resolvedConfig` keys and deterministic worktree-independent `<worktree>` paths!
     - Keep `configFiles()` watching the root config file + all its `configDeps` + the inline project's `preset`, `setupFiles`, `setupFilesAfterEnv`, `babel`, `tsconfig`, etc.

4. **Wrapper config & execution (`src/runners/jest/run/wrapper-config.ts`, `src/runners/jest/run/run.ts`):**
   - Pass optional `project?: string` into `WrapperConfigOptions` from `runJest` (`project.project`).
   - When `options.project !== undefined`:
     - The generated `wrap-<hash>.cjs` calls `readInitialOptions(config, { skipMultipleConfigError: true })`, selects the inline project object by `options.project` using the exact same selector rule, resolves `rootDir` relative to `path.dirname(config)`, strips `projects`, and injects `runtime` (when present).
     - Hash includes `options.project` (automatically via `wrapperText`), so each inline project gets its own wrapper file under `cacheDir` (and `defaultCacheDir` already hashes `${root}\0${project.name}`).

5. **Setup discovery & apply (`src/cli/jest-seed.ts`, `src/cli/setup/jest.ts`):**
   - Update `SeededJest` to `Pick<JestProject, "name" | "config" | "cwd" | "project">` and `JestRunner` in `src/cli/setup/jest.ts` to carry optional `readonly project?: string`.
   - Update `writeJestSeed()` in `src/cli/setup/jest.ts` to emit `...(project === undefined ? {} : { project })` into `squeal.config.json`.
   - In `src/cli/jest-seed.ts`:
     - When a candidate config defines a non-empty `projects` array:
       - Expand string entries into their config files as before.
       - Expand inline project objects into `{ config: from, project: selector, read }` (using the exact selector rule), deduplicating by `(config, project ?? "")` instead of `config` alone!
       - Preserve deterministic sort order (`compare(a.config, b.config) || compare(a.project ?? "", b.project ?? "")`).
       - Name each seeded inline project cleanly using its `displayName` if present (unique among `taken`), else `uniqueName(null, dirOf(config), names)` (e.g. `jest`, `jest-2`).
       - Emit clear notes (e.g. `seeded jest project "unit" from jest.config.cjs (project "unit")`).
       - No longer drop inline project objects or emit the "move it to its own jest.config file" warning.

6. **Tests (both Jest 29.7.0 and Jest 30.5.2):**
   - `test/daemon/policy-jest.test.ts`: valid and invalid `project` field.
   - `test/cli/setup/jest.test.ts`:
     - Root config containing **only inline projects** (matching review `0.1.646.md` B2 reproduction: `unit` + `integration`, plus unnamed/duplicate inline project fallback to `#<index>`), verifying `seedJest`, `buildPlan`, and `squeal setup --yes` writes `{ name, config, project }` into `squeal.config.json` and re-running `buildPlan` sees `source: "config"`.
     - Root config with **mixed string + inline projects** (e.g. `"<rootDir>/packages/*"` + inline object with its own `globals` / `testMatch`), verifying string entries seed their sub-configs without `project` and inline objects seed root config with `project`, on both Jest 29 and Jest 30.
   - `test/runners/jest/environment.test.ts` and `test/runners/jest/adapter.test.ts`:
     - Both-major end-to-end adapter execution for inline projects (root with only inline projects AND mixed string + inline):
       - Each inline project lists ONLY its own test files (matching `jest --config jest.config.cjs --listTests`),
       - Preserves inline options (`globals`, `testMatch`, `setupFiles`, `rootDir` omitted or relative),
       - Runs and passes each inline project's tests with observed loads,
       - Produces distinct deterministic `<worktree>`-portable keys for two inline projects from the same root config,
       - Editing a helper file imported by the root config invalidates and recreates the inline project adapter!

### Verification

Run:
- `pnpm run lint`
- `pnpm run typecheck`
- `TMPDIR=/tmp pnpm exec vitest run test/daemon/policy-jest.test.ts test/cli/setup/jest.test.ts test/runners/jest/environment.test.ts test/runners/jest/adapter.test.ts`
- `git diff --check`

Commit your changes cleanly on your worker branch and report exact commands and results.
