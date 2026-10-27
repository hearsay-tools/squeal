# 002-31 notes: fixed plugin build and runtime packaging

Wave 5 W1, 2026-10-27. Spec 002 D7 to D9, `../wave-5-contract.md`, foundations `../002-29/notes.md` and `../002-30/notes.md`. No committed build, no version raise, no release, no full suite.

## What the parent runs at integration

After every row is integrated and the root version is raised:

1. `pnpm run build`. It writes `plugins/codex-runtime/` whole and leaves `plugins/codex/` as it is.
2. `pnpm run build:codex-adapter`. It refuses unless `plugins/codex-runtime/` is a valid runtime of the root version. It writes into `plugins/codex/`: the manifest at adapter version 1.0.0, `bin/squeal-launcher` (the launcher source at that moment, 0755), `dist/<hook>.mjs` (ten adapter bundles) and `seed/` (a whole copy of the runtime). It removes the old `dist/` (with the old `cli/`, `node-test/` and the rest) and replaces the old `bin/`. It keeps `hooks/hooks.json`, `README.md`, `.gitignore` and `skills/` as committed.
3. Commit both trees. The root `.gitignore` now re-includes `plugins/codex-runtime/dist/`, which `dist/` hid. `git status` must list the new `plugins/codex-runtime/dist/**` files; without that exception the packager and CI find no bundles.

Expected until then (17 failures; Squeal lists 20, and the other 3 are bundle drift present at the session's first revision): every test that reads `plugins/codex-runtime` (`packaging/runtime.test.ts` committed block, 3; `skill.test.ts`, 2; `skill-wait.test.ts`, 5; `skill-focused.test.ts`, 1; `shared/skill-pytest.test.ts`, 2; `setup-skill.test.ts`, 1; `stop-slow-handoff-bundle.test.ts` codex cases, 2), and `codex-launcher-config.test.ts` "finds the committed fixed plugin", which needs `plugins/codex/seed/`. The 3 failures at baseline are `plugin.test.ts`, `pi/package.test.ts` and `opencode/package.test.ts`, from 002-29's `version-copies.ts` change. The baseline's fourth, the Codex plugin drift test, is now the committed block of `packaging/runtime.test.ts`.

## Interfaces

`src/harness/build.ts` (additive): `PluginBuild.entries?` (extra bundles beside the hooks), `bundleOptions(plugin, outdir, version = rootVersion())`, `buildDist(plugin, outdir, version = rootVersion())`.

`src/harness/codex/build.ts` (the routine build, renamed exports):

- `CODEX_RUNTIME: PluginBuild` (was `CODEX_PLUGIN`), `CODEX_RUNTIME_DIR` = `plugins/codex-runtime`, `CODEX_RUNTIME_DIST` (was `CODEX_PLUGIN_DIST`). `CODEX_PLUGIN_DIR` stays `plugins/codex`, now the fixed plugin.
- `buildCodexRuntime(plugin?, version?): Promise<{ runtime: RuntimeManifest; metafile }>` (was `buildCodexPlugin`). It throws before writing when the target holds `seed/` or `hooks/`.
- `runtimeNodeFloor()` = `22.19.0`; `CODEX_DESCRIPTION`, `SETUP_SKILL_SOURCE`, `CODEX_SETUP_SKILL`.

`src/harness/codex/build-adapter.ts`: `buildCodexAdapter({ pluginDir, seed, from?, version? }): Promise<{ seed: RuntimeManifest; metafile }>`, `CODEX_ADAPTER_VERSION = "1.0.0"`, `declaredHooks(pluginDir)`, `buildAdapterDist(outdir)`, `ADAPTER_COMMITTED`, `SEED`.

`src/cli/codex/launcher.ts`: `isFixedPlugin(dir)`, `findCodexPlugin(module?, env?)`, `codexPluginData(env?)`, `launcherConfig(pluginRoot, hooks, data = codexPluginData())`.

`scripts/package-codex-runtime.ts`: `packageCodexRuntime({ commit, out, cwd? })`, `parseArgs`, `RUNTIME_TREE`, `UPLOAD_NOTES`. Command: `pnpm run package:codex-runtime -- --commit <full hash> --out <dir>`.

`scripts/check-version-bump.ts`: `versionBumpProblem` now checks two versions independently.

## Decisions the contract did not settle

1. **Runtime tree contents.** The manifest is written whole (`name`, `version`, `description`), not merged into an existing file. Both skills (`squeal` with the Codex note, and `setup`) and the launcher are copied, and `dist/runtime.mjs` sits beside the hooks. The build removes `.codex-plugin`, `dist`, `skills`, `bin` and `runtime.json` first, so no stale file reaches `runtime.json`.
2. **Fixed plugin sources.** `hooks/hooks.json`, `README.md`, `.gitignore` and the skill bridges are committed files in `plugins/codex/`. The adapter build keeps them and writes the rest. A scratch build copies them with `from`. `hooks.json` is unchanged byte for byte, so the ten declaration hashes are the pinned ones (`test/plugins/codex/hooks-json.test.ts`). The whole-plugin content hash still changes once, at migration.
3. **Adapter bundles.** One esbuild call with ten virtual entries, `await runAdapterHook("<hook>")` each, keeps the existing `dist/<hook>.mjs` command shape. No entry files are added under `src/`.
4. **Skill bridges.** `skills/squeal/SKILL.md` and `skills/setup/SKILL.md` keep their frontmatter. Their body sends the agent to the session's runtime: the SessionStart skill line, else `runtime/current.json`, else `seed/`. The full skills are in `plugins/codex-runtime/skills/`. The skill tests now read that tree.
5. **Root launcher** (coordinator decision, wave 5): the adapter build copies the launcher source to `bin/squeal-launcher`, which then stays frozen. It is not in the launcher-copy source check (`launcher-copy.test.ts` checks the runtime build's copy). CI's `plugins/*/bin` diff covers it only against the routine build, which never writes it.
6. **Version guards.** Any change under `plugins/codex/` needs a greater adapter version in its manifest. A root raise does not count, and README edits count too, because every byte is in Codex's content hash. A change under `plugins/codex-runtime/` needs a greater root version. `plugins/codex/dist` left the root list. The migration 0.1.x to 1.0.0 passes.
7. **CI drift.** The `Bundles match the build` diff adds `plugins/codex-runtime` and `plugins/codex`, so a build that touches the fixed plugin fails. A new step, `The build adds no plugin file`, fails on untracked files under `plugins/`, which `git diff` misses.
8. **Launcher config.** Every command starts `export PLUGIN_ROOT="<root>" PLUGIN_DATA="<data>"; ` and then keeps `${PLUGIN_ROOT}` replaced by the root, as before. Both paths get the existing metacharacter refusal. The data path is `PLUGIN_DATA`, else `<CODEX_HOME or ~/.codex>/plugins/data/squeal-hearsay`. This is a small local locator. W2's `src/cli/codex/runtime.ts` exports another one; a later pass can make one call the other. Hashes are computed from the exported text as before. `init.ts` is unchanged: `printLauncherConfig` uses the default from `process.env`.
9. **Discovery.** `findCodexPlugin` takes a directory only with the manifest, `hooks/hooks.json` and `seed/`. A CLI in a retained runtime falls back to the newest `squeal` in Codex's `hearsay` cache, when that one is a fixed plugin. A legacy cached plugin gives `null`.
10. **Packager.** It reads the tree from git (`ls-tree`, `cat-file`) at the exact commit, never from the working tree. It needs a full 40-hex hash, refuses links (mode 120000), requires the runtime version to equal the commit's root version, and refuses to overwrite. `UPLOAD.md` holds `test "$(git rev-parse 'squeal--v<v>^{commit}')" = <commit>` and `gh release upload 'squeal--v<v>' squeal-codex-runtime.json.gz squeal-codex-runtime.json --repo hearsay-tools/squeal`, with no `--clobber`.
11. **Fixed plugin README.** It is short: install, trust, launchers and contents. The detailed trust and app-server text was cut, because each later README edit is an adapter release. The root README still links to it.

## Risk the parent should weigh

- An esbuild upgrade, or any change under `src/harness/codex/adapter/`, changes the adapter bundles the next time someone runs `build:codex-adapter`. No test compares the committed adapter bundles with a fresh build. The routine CI build never rebuilds them, so the fixed plugin cannot drift silently. It also means an adapter source fix reaches users only through an explicit adapter release. If the parent wants such a check, the place is a test that builds `buildAdapterDist` to scratch and compares `plugins/codex/dist`. That test would fail on every esbuild bump.

## For the shipped-proof row (shared e2e, not changed here)

- `test/e2e/plugins.ts` runs a Codex hook with `PLUGIN_ROOT` = the archived `plugins/codex` and no `PLUGIN_DATA`. The fixed adapter is silent without `PLUGIN_DATA`. Every e2e Codex run needs a scratch `PLUGIN_DATA`. The first hook then publishes the seed there, which copies about 11 MB and hashes it.
- `test/e2e/shipped-plugin.test.ts` archives `plugins/codex` from HEAD. After integration it ships the adapter and seed, so the proof covers the seed only. A second case should publish `plugins/codex-runtime` as current (`publishRuntime`) to prove the current runtime.
- `test/e2e/codex-upgrade.test.ts` builds legacy per-version plugins (`cache-fixture.ts` `codexPluginAt`, now built from sources, with no seed). It still tests a pre-D7 upgrade. Under D7, an upgrade is a runtime publication with the plugin unchanged.
- `cache-fixture.ts` no longer copies `plugins/codex` whole, so a committed `seed/` or adapter `dist/` does not leak into the legacy layout.

## Checks run (2026-10-27)

- Squeal affected checks: listed in the final report.
- `pnpm run lint`: clean. `pnpm run typecheck`: clean.
- Not run: `pnpm run build` (forbidden against committed plugins), `build:codex-adapter` against `plugins/codex`, full suite, e2e.
