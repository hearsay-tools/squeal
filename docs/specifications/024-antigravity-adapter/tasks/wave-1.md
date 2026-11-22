# Spec 024: Wave 1 briefs

Two disjoint slices running in parallel on `origin/main` after Wave 0 (`research/wave-0-checks.md`). Neither worker runs `pnpm run build` or edits `docs/board.md`.

## Row 024-02: shared/core wiring and `antigravityCommand`

- **Outcome**: Add `"antigravity"` support to `StopWaitHarness`, sequential `stop-decide`, parameterized `version-copies` (with `keptCacheCli`), `waitConsumer`, and `src/harness/antigravity/command.ts`.
- **Read**: `docs/vision.md`, `docs/styleguide.md`, `docs/specifications/024-antigravity-adapter/spec.md` (D1, D2, D3, D5), `status.md`, and `research/wave-0-checks.md` (section 2).
- **Shape**: slice.
- **Starting seam**: `src/core/slow/stop-wait.ts` (`StopWaitHarness`) and `src/harness/shared/stop-decide.ts` (`stopRules`, `waitingEntryRecorded`).
- **Contract**:
  1. `src/core/slow/stop-wait.ts`: add `"antigravity"` to `StopWaitHarness`.
  2. `src/harness/shared/stop-decide.ts`: in `stopRules`, for `input.harness === "antigravity"`, set `elsewhere = main` (sequential waiting `stop-slow` entry always runs after a silent `stop` for `main`, without needing `recordStopWait`). In `waitingEntryRecorded`, return `false` immediately for `"antigravity"` (as for `"pi"`).
  3. `src/harness/shared/version-copies.ts`: parameterize `KeepOptions`, `keptCli`, and `keptSkill` with optional `manifest?: string` (default `".codex-plugin/plugin.json"`) and `copied?: readonly string[]` (default `["dist", "skills", ".codex-plugin"]`). Export `ANTIGRAVITY_MANIFEST = "plugin.json"`, `ANTIGRAVITY_COPIED = ["dist", "skills", "plugin.json"] as const`, `antigravityPluginDir(env)` (`<HOME>/.gemini/config/plugins/squeal`), and `antigravityDataDir(env)` (`<HOME>/.gemini/antigravity-cli/plugin_data/squeal`). In `keptCacheCli(cli, version, env)`, when `cli` is `<antigravityPluginDir>/dist/cli/squeal.mjs`, call `keepVersion` into `env.PLUGIN_DATA` (if absolute) else `antigravityDataDir(env)` using `ANTIGRAVITY_MANIFEST` and `ANTIGRAVITY_COPIED`, returning the retained CLI or falling back to `cli`. Existing Codex behavior stays unchanged.
  4. `src/cli/status-wait.ts`: in `waitConsumer(env)`, treat non-empty `ANTIGRAVITY_CONVERSATION_ID` as `{ session: id, agent: null }` (matching `CLAUDE_CODE_SESSION_ID` / `CODEX_SESSION_ID`).
  5. `src/harness/antigravity/command.ts`: export `antigravityCommand(env, bundleCli)` mirroring `src/harness/codex/command.ts` (`PLUGIN_DATA` else `dataOfCopy(bundleCli)` -> `shellWord(dataLauncher(data))` if it exists; else `node --disable-warning=ExperimentalWarning ${shellWord(cli)}` with `PLUGIN_ROOT/dist/cli/squeal.mjs` or `bundleCli`).
- **Ownership**: `src/core/slow/stop-wait.ts`, `src/harness/shared/stop-decide.ts`, `src/harness/shared/version-copies.ts`, `src/cli/status-wait.ts`, `src/harness/antigravity/command.ts`, and unit tests (`test/harness/antigravity/command.test.ts`, plus new or updated tests for stop-decide, version-copies, and status-wait; update any existing `test/harness/stop-*.test.ts` type annotations if `StopWaitHarness` requires it). Leave `install.sh`, `plugins/**`, `src/cli/{main,init,update,status-command}.ts`, `src/cli/setup/**`, `src/core/ps/**`, `package.json`, `scripts/**`, and `.github/**` alone.
- **Done when**: Unit tests pass for all five items (`squeal status --wait 60000 <changed-paths>` or targeted `pnpm exec vitest run` if needed), `pnpm run lint`, `pnpm run typecheck`, and `pnpm run check:private` pass. Do not run `pnpm run build` or a full suite.
- **Role**: Use `/worker`.

## Row 024-06: `install.sh` and `squeal-launcher` for Antigravity

- **Outcome**: Wire Antigravity install/update/uninstall into `install.sh` and bump `plugins/claude-code/bin/squeal-launcher` to format 9 to discover Antigravity installs and `$PLUGIN_DATA/versions/` copies.
- **Read**: `docs/vision.md`, `docs/styleguide.md`, `docs/specifications/024-antigravity-adapter/spec.md` (D1), `status.md`, and `research/wave-0-checks.md` (sections 1 and 2).
- **Shape**: slice.
- **Starting seam**: `install.sh` (`installed()`, `unpack()`, `install()`, `uninstall()`, `main()`) and `plugins/claude-code/bin/squeal-launcher`.
- **Contract**:
  1. `install.sh`:
     - Detect the Antigravity CLI in order `SQUEAL_ANTIGRAVITY_BIN`, `agy`, `antigravity` on `PATH`. Accept a candidate only when `<cli> --version` prints a bare semver (`^\d+\.\d+\.\d+$`) and `<cli> help plugin` lists both `uninstall` and `validate` (rejecting an IDE launcher). Never match `Usage of ...` literally or pass `--help` to `plugin uninstall`.
     - Check `~/.gemini/config/plugins/squeal/plugin.json` for installed presence and version (never rely on `plugin uninstall`'s exit code). Include Antigravity in `installed()` (for `antigravity` and `any`).
     - Add `install_antigravity` and `--antigravity` flag (`install_antigravity_only`): unpack `plugins/antigravity/` from the release archive into a temp dir, verify `plugin.json`'s `version` equals `$SQUEAL_VERSION`, run `<cli> plugin install <tmp-dir>`. Record `antigravity` in `$OWNED` only when Squeal was not already installed at `~/.gemini/config/plugins/squeal/plugin.json` before `install.sh` ran. Skip re-download if already installed at `$SQUEAL_VERSION`. Never edit `~/.gemini/config/config.json` or `import_manifest.json`.
     - Include Antigravity in `install()`'s harness detection and `uninstall()`'s `uninstall_antigravity`: when owned and present, run `<cli> plugin uninstall squeal` and `forget antigravity` (or keep in `$OWNED` and say so if CLI is absent). When `~/.gemini/antigravity-cli/plugin_data/squeal` exists and no Antigravity plugin remains, delete it unless `in_use` reports a running process (in which case keep it and print the `rm -rf` note).
  2. `plugins/claude-code/bin/squeal-launcher`:
     - Bump header to `# squeal-launcher format 9`.
     - Discover `~/.gemini/config/plugins/squeal` (`plugin.json` `version` + `dist/cli/squeal.mjs` present) as `{ harness: "Antigravity", version, dir }`.
     - When invoked as `<PLUGIN_DATA>/bin/squeal` outside Codex's data dir (`self !== data`), check `newestIn(join(self, "versions"))` even when Codex's fixed plugin is also installed (`managed === true`). Use `ANTIGRAVITY_CONVERSATION_ID` in `notice` scope and keep version-skew wording accurate when `kept` is from Antigravity's data dir (`self !== data`).
- **Ownership**: `install.sh`, `plugins/claude-code/bin/squeal-launcher`, and tests (`test/cli/install-antigravity.test.ts`, `test/cli/launcher-antigravity.test.ts`, plus updating `test/e2e/codex-migration.test.ts:51` and any other launcher/install test that hardcodes `format 8` or `install.sh` usage text). Leave `src/**`, `plugins/{codex,codex-runtime,pi,opencode,antigravity}/**`, `package.json`, `scripts/**`, and `.github/**` alone.
- **Done when**: Isolated `HOME` tests cover `install.sh` (install, idempotent re-run, `--antigravity` upgrade, IDE-launcher rejection, `SQUEAL_ANTIGRAVITY_BIN`, `--uninstall` owned vs pre-existing and `PLUGIN_DATA` cleanup/in-use) and `squeal-launcher` (Antigravity discovery, `<PLUGIN_DATA>/bin/squeal` alongside a fixed Codex plugin, `ANTIGRAVITY_CONVERSATION_ID` notice dedup, format 9), existing `test/cli/install*.test.ts` and `test/cli/launcher*.test.ts` / `test/cli/update*.test.ts` pass, plus `pnpm run lint`, `pnpm run typecheck`, and `pnpm run check:private`. Do not run `pnpm run build` or a full suite.
- **Role**: Use `/worker`.
