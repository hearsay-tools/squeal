# 010-34 notes: adopt the measured compiler

Evidence for the board row's done-when (spec 010 D13, ADR 0005), and the seams a later worker needs. Worker of coordinator `7803aae0`, 2026-11-02, base `bbe3f3c29`.

## Changes

- `package.json`: `tsrs` pinned to `0.20.1-ts7.1.0-beta` (exact, no range). `build` runs `tsrs --fast -p tsconfig.build.json`, `typecheck` runs `tsrs --fast --noEmit`. `typescript` `^7.0.2` stays. `version` is untouched.
- `pnpm-lock.yaml`: `tsrs` and its seven `@tsrs/<platform>` optional packages, nothing else. The package has no install scripts.
- `.github/workflows/ci.yml`: the Node 24 job's typecheck step runs `pnpm run typecheck` instead of `pnpm exec tsc --noEmit`. The two Build steps already ran `pnpm run build`, so they pick up tsrs too.
- `src/core/delivery/delivery.ts`: the destructured options of `register`, `onToolBoundary` and `endTurn` take `RegisterOptions`, `ToolBoundaryOptions` and `EndTurnOptions`. Before the change, `tsrs --fast --noEmit` reported:
  ```
  src/core/delivery/delivery.ts(396,67): error TS7031: Binding element 'startingSince' implicitly has an 'any' type.
  src/core/delivery/delivery.ts(470,54): error TS7031: Binding element 'atRevision' implicitly has an 'any' type.
  src/core/delivery/delivery.ts(494,33): error TS7031: Binding element 'atRevision' implicitly has an 'any' type.
  ```
- `test/helpers/build-inputs.ts`: `tscObserved` is renamed `compileObserved` and runs `node node_modules/tsrs/bin/tsrs --fast <args> --listFiles`. It exports `TSRS` and `TSRS_ARGS` so the oracle tests use the same compiler and flags. The stat on success and on failure is unchanged.
- `test/daemon/helpers.ts`, `test/fixtures/build-inputs/failed.fixture.ts`: the rename, and comments that named `tsc` as the compiler in use.
- `test/helpers/build-inputs.test.ts`, `test/policy/repository-inputs.test.ts`: the `--listFilesOnly` oracles run tsrs with `TSRS_ARGS`.
- `src/cli/setup/build-outputs.ts`: a build script whose first word is `tsc` or `tsrs` (`TSCONFIG_COMPILERS`) reads its output directory from the project's tsconfig. `test/cli/setup/build-outputs.test.ts` adds a regression: a `tsrs --fast -p tsconfig.build.json` build, with no `bin` or `files`, names `dist` by `build-script` evidence alone. It failed before the fix (`expected undefined to deeply equal { path: 'dist', … }`, revision 8) and passes after it (revision 9).

## Type changes

None to public types. `delivery.ts` only annotates parameters with existing exported interfaces. `TSCONFIG_COMPILERS` is module-private. `TSRS` and `TSRS_ARGS` are new exports of a test helper.

## Compiler evidence

- `tsrs --fast -p tsconfig.build.json --listFilesOnly` and `tsc` 7.0.2 list the same 862 worktree files (sorted, `node_modules` removed, `diff` empty).
- On the failing fixture `test/fixtures/build-inputs/broken`, tsrs prints the same `file(line,col): error TS2741` line and the same absolute listed paths as tsc, exit 2. The helper's diagnostic filter is unchanged.
- Emit of `tsconfig.build.json` into scratch directories (not `dist`, not the plugin build): 2,586 files each (862 `.js`, 862 `.d.ts`, 862 `.map`). All `.js` and `.d.ts` are identical. All 862 source maps differ: tsrs omits `"sourceRoot":""`; `sources` and `mappings` start the same in the file inspected (`core/text.js.map`). Wall time on the loaded host (load 18): tsrs 0.46 s, tsc 1.40 s.
- `pnpm exec tsc --noEmit` (7.0.2) still passes after the delivery annotations.

## Checks

See "Check results" below for the commands and their output.

## Decisions the spec did not settle

- The helper rename: `compileObserved`, a name that does not name a compiler, so the next compiler change does not rename it again.
- Setup recognizes only a script whose first word is `tsc` or `tsrs`, as before for `tsc`. `npx tsrs`, `pnpm exec tsrs` and `tsgo` are not recognized; they were not for `tsc` either.
- Comments that described the compiler in use now say tsrs or "the compiler". Historical `tsc` examples and user fixtures (`test/cli/setup/fixture.ts`, `test/state/fingerprint.test.ts`, `test/harness/test-command.test.ts`, `test/evals/commands.test.ts`) are unchanged, as the brief says.

## For the next worker

- Not run here, by the brief: `pnpm run build`, the plugin bundles, a full suite. The coordinator verifies the build and the bundle drift.
- `node_modules/tsrs/bin/tsrs` is a Node launcher that `execve`s the native binary on Node ≥ 22.15, and spawns it as a child on older Node. Both paths ran under the recorder in `build-inputs.test.ts` (Node 24 here); Node 22.19 CI runs the `execve` path too.
- Fast mode picks its checker count from the machine. Daemon tests call `buildCli` in many files; CPU per compile is lower than tsc's (ADR 0005), but parallel compiles may each use several threads.
