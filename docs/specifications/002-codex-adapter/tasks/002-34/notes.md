# 002-34 notes: runtime updater, codex-runtime CLI and setup readiness

Wave 5 W2, 2026-10-27. Spec 002 D7 to D9, `../wave-5-contract.md`, foundations `../002-29/notes.md` and `../002-30/notes.md`. No bundle build, no version raise, no full suite.

## Exported interfaces

`src/harness/codex/runtime-update/index.ts` (import only from here):

- `updateRuntime({ pluginRoot, data, tag?, explicit?, transport?, timeoutMs?, lockWaitMs?, signal?, now?, node? }): Promise<RuntimeUpdateResult>`. `outcome` is `updated` (with `previous`, `release`), `current` (nothing newer; `release`), `not-due` (`nextCheckAt`), `busy` (`owner` pid) or `failed` (`failure`, `release` when resolved, `nextCheckAt`). `version` is always the runtime a new session selects afterwards.
- `selectedRuntime(pluginRoot, data, node?)`: the version a new session selects now, as the adapter's `chooseNew` picks it (current unless the seed is newer or current is unusable).
- `readUpdateState(data)`, `isDue(state, now)`, `UpdateState`, `UpdateFailure`, `failureOf(error)`.
- `acquireLock(data, { waitMs?, now? })`, `STALE_LOCK_MS` (10 min).
- Paths: `updateStateFile` (`<data>/runtime/update.json`), `lockFile` (`<data>/runtime/update.lock`), `stagingDir` (`<data>/runtime/staging`), `STAGED_PREFIX`, `isAdapterRoot(root)` (has `hooks/hooks.json` and `seed/`).
- Intervals: `CHECK_INTERVAL_MS` 1 h, `TRANSIENT_RETRY_MS` 5 min, `FAILURE_RETRY_MS` 1 h.

`src/harness/codex/runtime-update/schedule.ts`: `scheduleRuntimeUpdate({ env, now?, start? })`. Not re-exported from the index, so the runtime bundle pulls in only `paths.ts`, `state.ts` and `layout.ts`, not the release code.

`src/cli/codex/runtime.ts`: `codexRuntimeCommand(args, io, deps?)`, `codexRuntimeData(env)`, `codexAdapterRoot(env)`, `runUpdate(pluginRoot, data, deps, { tag?, background? })`, `ensureRuntime`, `readyLine`, `updateText`, `codexRuntimeStatus`, `statusText`, `CODEX_RUNTIME_USAGE`, `FOREGROUND_LOCK_WAIT_MS` (30 s), type `CodexRuntimeDeps` (`transport?`, `now?`, `timeoutMs?`).

`src/cli/update-codex.ts`: `updateCodexRuntime(env, deps)`, `codexLauncherDir(env)`.

`src/cli/setup/codex-runtime.ts`: `readCodexRuntime(env)`, `codexRuntimeOutdated`, `codexRuntimeLine`, `prepareCodexRuntime(fact, io, deps?)`, type `CodexRuntimeFact`.

## Type changes (all additive)

- `updateCommand(args, io, deps?)` is now `async` and returns `Promise<number>`; `main`'s `Command` type already allowed it. New `UpdateDeps { codexRuntime? }`.
- `SetupPlan.codexRuntime?: CodexRuntimeFact` (optional; plan schema stays 1).
- `SetupDeps.codexRuntime?` and `SetupRun.codexRuntime?`: the injected transport.
- `main` dispatches `codex-runtime`; `HELP` has its three entries and an amended `squeal update` line.

## CLI contract as built

- `squeal codex-runtime ensure --plugin-root <abs> [--data <abs>]`: `selectRuntime({ sessionId: null })`, so no pin and no network; publishes and selects the seed when no current runtime is usable or the seed is newer. Prints `Codex runtime <v> ready (<seed|current>) in <root>`. Exit 0 ready, 1 not ready or not an adapter root, 2 usage.
- `squeal codex-runtime update ... [--tag squeal--v<v>] [--background]`: foreground is explicit (ignores the retry delay) and waits up to 30 s for another updater's lock, then answers busy. Exit 0 for `updated` or `current`, 1 for `failed` or `busy` (message on stderr, ending with the runtime that stays selected). `--background` keeps the retry delays, does not wait for the lock, prints nothing and exits 0; its result is in `update.json` only.
- `squeal codex-runtime status ... [--json]`: read-only. JSON is `runtimeReadiness` plus `data`, `adapterValid`, `selected` and `update` (the state file). Exit 0 when the root is a valid adapter and a new session can select a runtime, 1 otherwise.
- Flags take `--flag value` or `--flag=value`. `--plugin-root` is required for all three; paths must be absolute; `--tag` must be a release tag.
- Data locator: `--data`, else absolute `PLUGIN_DATA`, else `<CODEX_HOME or $HOME/.codex>/plugins/data/squeal-hearsay`.

## Behavior decided here, not in the spec

1. **No downgrade baseline.** A release is applied only when it is newer than `selectedRuntime`, which counts the seed. An explicit `--tag` of an older release answers `current`, writes nothing and downloads nothing. The check repeats after staging, so an adapter release with a newer seed that landed during the download wins.
2. **Retained but not selected.** A newer release already in `versions/` is selected through `publishRuntime(sourceRoot = that root)` with no download.
3. **Failure classes.** `RuntimeReleaseError.transient` decides 5 min or 1 h. Store errors: `unwritable-data` is transient, other kinds are not. Anything else is `internal`, not transient. A caller's abort is not transient.
4. **Not-due re-check under the lock.** A scheduled update that waited re-reads the state after taking the lock, so two children started by two session starts make one check.
5. **Stale lock.** Dead owner, unreadable record, or older than 10 min even with a live pid (pid reuse). Broken by rename aside, then compared with the content judged stale; another updater's fresh lock renamed by mistake is linked back. The 10 min is well past the 120 s operation plus publication and prune.
6. **Clock.** A `nextCheckAt` more than 1 h ahead counts as due, so a clock that moved back cannot block checks.
7. **Trigger scope.** Only `session-start`, after its handler wrote its output, and only when `SQUEAL_ADAPTER_ROOT` is a valid adapter, `PLUGIN_ROOT` has `dist/cli/squeal.mjs` and a check is due. No new environment switch. The child runs with `cwd` = data, `detached`, `stdio: "ignore"`, `unref()`, an ignored `error` event.
8. **`squeal update`.** The Codex harness line reads `Codex: squeal@hearsay adapter <v>, ...` when the version after names an adapter root, and the adapter's version is left out of the one-version comparison; the line `Codex runtime <v>, was <old> | up to date | not updated` follows, and its version joins the comparison. The runtime step runs when an adapter is in Codex's cache even without `codex` on the PATH, so that case no longer says "no harness". A runtime failure exits 1 with the reason on stderr.
9. **Launcher source** (coordinator, 2026-10-27): adapter cache directories are no launcher source. The fixed plugin contributes the selected runtime's root when `current.json` names a complete runtime, the seed when there is no `current.json`, and nothing when `current.json` is unreadable or names an incomplete runtime. The updater runs before the launcher copy, so a repairable selection is repaired first.
10. **Setup.** The plan's `codexRuntime` is `no-adapter` for no plugin or a plugin from before the adapter; otherwise `ready` or `not-ready` with both problems and a repair command (`ensure` when ready, `update` when not). Not ready is an `outdated` line, so `--check` exits 1. Applying setup with Codex among the chosen harnesses runs `ensure`; only when no runtime is complete does it run one explicit update, then select again. It writes no trust and asks no extra question: choosing Codex is the consent. `--harness none`, or no terminal without `--yes`, prepares nothing.
11. **`squeal status` unchanged.** `codexStatusLine` was not extended: its tests are in `test/cli/codex.test.ts` (002-31's) and run without `HOME`, so a readiness check would read the real `~/.codex`. `codex-runtime status` and the setup plan carry the readiness diagnostics.

## Checks run

- `pnpm run lint`: `Checked 2486 files ... No fixes applied.`
- `pnpm run typecheck`: no output, exit 0.
- Squeal affected checks, `squeal status --wait` over every changed `.ts` path at revision 38 (cb9e189f0): 235 test files current, 10 known failures in 7 files, every other file passes. The 10 are expected: the bundle drift tests (`test/harness/plugin.test.ts`, `test/harness/codex/plugin.test.ts`, `test/harness/pi/package.test.ts`, `test/harness/opencode/package.test.ts` "has the bundles exactly as ... build produces them") fail since before this row (002-29 residue) and fail more after it: the CLI bundle now contains `codex-runtime`.
- The launcher format literals (`test/cli/update.test.ts`, `update-pi.test.ts`, `update-opencode.test.ts`, commit 9455e6d7c) fail here by design until 002-35's format-8 launcher integrates: 6 checks. With `plugins/claude-code/bin/squeal-launcher` stamped format 8 for one direct run, `pnpm exec vitest run` of the three files passed 30 of 30; the file was restored.

## Residue for later rows

- **Proof row (002-33):** a real Codex session start through the fixed plugin starts a background update that reaches the official release URL. A scratch-home proof that must not reach production can write `<data>/runtime/update.json` with a future `nextCheckAt` (at most 1 h ahead) before the first session, or leave `hooks/hooks.json` out of the adapter root it passes. E2E helpers were not changed.
- **Core:** daemon handoff and the launcher's "plugins hold different versions" message read Codex's cache version (`codexNewest`), which with the fixed plugin is the adapter version. D8 says runtime version drives handoff; that is in `src/core/daemon/version.ts` and the launcher, outside this row.
- **Bundles:** `dist/runtime.mjs` now imports `runtime-update/schedule.ts` (paths, state, `adapter/layout.ts`, `adapter/store.ts` for `SEED`). The adapter bundle is untouched; `frozen.test.ts` should stay green.
- **Lock across hosts:** the lock compares pids, so a data directory shared between machines (network home) could break a live lock of another host after the owner's pid is not found locally. Not a Codex layout today.
- `src/cli/update.ts` is 311 lines; the next change there should move `recopyLauncher` and `pluginDirs` into their own module.
