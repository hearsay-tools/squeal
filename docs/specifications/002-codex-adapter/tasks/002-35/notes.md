# 002-35 notes: one-plugin shell install and pinned launcher

Wave 5 W3, 2026-10-27. Spec 002 D7 to D9, `../wave-5.md` W3, `../wave-5-contract.md` "Installer and launcher". No bundle build, no version raise, no real user install.

## What changed

- `install.sh`: after `codex plugin add squeal@hearsay` (or when Codex already has the plugin), a fixed plugin gets `provision_codex`. It runs the seed's CLI twice, each printed before it runs:
  - `node --disable-warning=ExperimentalWarning <root>/seed/dist/cli/squeal.mjs codex-runtime ensure --plugin-root <root>`
  - the same CLI with `codex-runtime update --plugin-root <root> --tag squeal--v<SQUEAL_VERSION>`
  
  A legacy Codex plugin (no `seed/`) gets neither. `installed` has a new mode, `adapter`, and `installed any` puts the Codex runtime in place of a fixed plugin's adapter version.
- `plugins/claude-code/bin/squeal-launcher`: format 8. It resolves a fixed Codex plugin's runtime (below). Claude Code, Pi, OpenCode, the legacy Codex cache and the 005 D3 kept copies work as before when there is no managed state.
- `README.md` "Install": the one fixed plugin, the two provisioning steps, the failure exit, runtime updates, session pins in the launcher, and the runtimes that uninstall leaves.
- Tests: `test/cli/install-sh-codex.test.ts` (9) and `test/cli/launcher-codex-runtime.test.ts` (11). The fixtures are the new `test/cli/codex-runtime-fixture.ts`, additions to `install-fixture.ts`, and `test/fixtures/codex/launcher-format-7`, the format-7 launcher of 005-84 (f0c99a2e7) as `install.sh` copied it before this row.

## Seam map: how the launcher finds a Codex runtime

1. Data directory: the launcher's own `<dir>/..`, when it holds `runtime/` (the launcher is `<PLUGIN_DATA>/bin/squeal`). Otherwise `$CODEX_HOME/plugins/data/squeal-hearsay`, with `$HOME/.codex` when `CODEX_HOME` is unset. W2's default locator must give the same directory (combined test 2).
2. Fixed plugin: the newest directory in `$CODEX_HOME/plugins/cache/hearsay/squeal/` that has `hooks/hooks.json` and `seed/`. Its name is the adapter version. Nothing compares this version with a runtime version. Any other cache directory with `dist/cli/squeal.mjs` is a legacy plugin, as before.
3. Managed state applies when a fixed plugin exists or `<data>/runtime/` exists. In that case the 005 D3 rule "run the newest kept copy" is off.
4. Pin: `CODEX_SESSION_ID`, then `CODEX_THREAD_ID`. The pin file is `<data>/runtime/sessions/<sha256(id)>.json`. This is the adapter's `pinFile`, and a test reads pins the real `selectRuntime` wrote. An unreadable pin, another session's pin or a version that is not `major.minor.patch` exits 1 with an error. A pinned version whose root is not whole exits 1 with the adapter's text: "missing or incomplete … Start a new Codex session". The launcher never runs another version for a pinned session, even when another harness has a newer plugin.
5. With no pin: the runtime that `<data>/runtime/current.json` names when its root is whole, or the seed when the seed is newer or no current runtime is whole. This mirrors the adapter's `chooseNew`. The result is one "Codex" entry; it competes with a legacy cache version, and the newer one stays.
6. A fixed plugin with no whole current runtime and no whole seed, and no other harness: exit 1, with the plugin root and the reinstall or `install.sh` action.
7. "Whole" in the launcher means: `runtime.json` and `.codex-plugin/plugin.json` name the same plain version, and `dist/cli/squeal.mjs` exists. This is less than `checkRoot`, which also checks the Node floor and every required entry. The launcher runs on every terminal call (005-75 counts its CPU), and the adapter does the full check at the session's first hook.
8. Notice: a pinned session behind the newest runtime gets "this Codex session started on X and keeps it until it restarts". The notice mark is in the data directory for the data directory's launcher.

## Decisions the spec did not settle

1. **Provisioning failure stops the run (exit 1).** This is the same as every other `install.sh` failure. Claude Code may already be installed. The Codex plugin stays and is recorded as owned, and the seed serves Codex sessions after a successful `ensure`. Pi, OpenCode and the launcher copy wait for a rerun. A rerun says "Codex has squeal@hearsay <adapter>", runs `ensure` and `update` again, and finishes. The failure text names the runtime Codex sessions keep: "use the runtime prepared before it, not <version>".
2. **No `--data` from `install.sh`.** The contract's command lines have none, so the CLI's default locator decides. If `PLUGIN_DATA` is set in the installer's own shell, the runtime goes there, and the launcher and `installed any` do not see it. This is not a real case for a terminal install.
3. **Uninstall leaves `<data>`** and prints "Squeal's Codex runtimes stay in <data> …". This happens when `<data>/runtime/` exists and Codex no longer has the plugin. Open sessions can be pinned to those runtimes, and `install.sh` did not create the directory alone (the adapter and the hooks write in it too).
4. **The launcher copy comes from the newest runtime.** `installed any` gives `<data>/versions/<current>/` or `<adapter>/seed/`, never the adapter root. The first installer test proves it: the release's runtime ships a later launcher format than the one frozen in the fixed plugin, and the copy is the runtime's. The coordinator confirmed the same rule for `squeal update` (the selected runtime's launcher, the seed's as fallback) and assigned `recopyLauncher` to W2.
5. **Launcher format 7 to 8** only. The root version is unchanged.

## Type and fixture changes

- No change to `src/`.
- `install-fixture.ts`: `Machine.publish(version, launcher?, codex?: FixedCodex)`, new `FixedCodex { adapter; seed }`. `publish` always writes the release's runtime tree at `hub/runtime/squeal--v<version>/`, and the machine sets `STUB_RUNTIME_RELEASES` to it. This is additive: existing callers are unchanged.
- `install-fixture.ts`: `FixedCodex.launcher?`, the launcher frozen into the fixed plugin's root and seed, by default the release's.
- `codex-runtime-fixture.ts`: `runtimeCli`, `writeRuntime` (a tree with every `REQUIRED_ENTRIES` file and a canonical `runtime.json` from row 002-30's `createRuntimeManifest`, so W1's `publishRuntime` accepts it), `writeFixedPlugin` (manifest, `hooks/hooks.json`, frozen `bin/squeal-launcher`, `seed/`; no root CLI), `writeCurrent`, `writePin`, `codexDataOf`.
- The stub `squeal codex-runtime` logs as `squeal …` in `STUB_LOG` and fails on a `STUB_FAIL` prefix. `ensure` selects the seed when no whole runtime is current. `update --tag` takes `STUB_RUNTIME_RELEASES/<tag>`, never selects an older version than current, and writes nothing when the version is already current, so a second install changes nothing.

## Checks at the end of this row (revision 20)

- `pnpm run lint`: clean. `pnpm run typecheck`: clean.
- Squeal affected checks for the 29 test files that read the installer, the launcher or the fixtures: 11 known failures, all expected (the worktree has 14: the three other bundle-drift tests below):
  - `test/cli/launcher.test.ts` 3 and `test/harness/opencode/package.test.ts` "ships bin/squeal …" 1: the committed launcher copies in `plugins/{codex,pi,opencode}/bin/` are still format 7. The parent's build regenerates them.
  - `test/harness/opencode/package.test.ts` "has the bundles exactly …" 1, with the Codex, Pi and root bundle tests elsewhere: `cli/squeal.mjs` drift from 002-29, older than this row.
  - `test/cli/update.test.ts` 2, `update-pi.test.ts` 2, `update-opencode.test.ts` 2: literal launcher format numbers. Each goes up by one (7 to 8, 8 to 9; `laterLauncher(8)` to `laterLauncher(9)`). The coordinator assigned these to W2 (002-34) on 2026-10-27.
- Each test in `launcher-codex-runtime.test.ts` failed against the format-7 launcher (checked at revision 11, then the source was restored).

## For the combined test (coordinator)

1. Use the real seed CLI in place of the stub: build a fixed plugin in a scratch root with W1's `build:codex-adapter`, then run `install.sh` with a local release (W2's injected transport or a local server) for `squeal--v<version>`. Check the real exit codes and output of `ensure` and `update`. Check that `update` failure exits nonzero and that `install.sh` then exits 1 with no "Next, in each repository" line.
2. Check that the CLI's default data locator equals the launcher's `$CODEX_HOME/plugins/data/squeal-hearsay` (with `CODEX_HOME` unset and set, and with a space in the path).
3. Check that the real updater's `current.json` and `versions/<v>/` are what the launcher reads. `launcher-codex-runtime.test.ts` already does this for W1's `publishRuntime` and `selectRuntime`.
4. Check that W1's runtime tree ships `bin/squeal-launcher` as this source (format 8), and that `squeal update` re-copies it from the selected runtime (W2).
5. In a real Codex shell, check that `CODEX_SESSION_ID` selects the pin the adapter wrote at the first hook.
6. No shared e2e helper or test changed in this row.

## Root launcher contract for migration (coordinator, 2026-10-27)

A format-7 launcher in `~/.local/bin/squeal` finds no CLI in a fixed plugin: its cache rule needs `<cache>/<v>/dist/cli/squeal.mjs`. The released `squeal update` runs `codex plugin marketplace upgrade hearsay`, then copies a plugin root's `bin/squeal-launcher` of a newer format over the terminal's launcher (`recopyLauncher`, `src/cli/update.ts` at 11f8123b3); it reads no runtime directory. So:

- W1 ships a frozen format-8 `bin/squeal-launcher` at the fixed plugin's root, written by the explicit adapter build only. No root `dist/cli` shim is planned.
- Later updates (W2) and `install.sh` copy the selected runtime's launcher, with the seed's as fallback, never the frozen root copy.
- The frozen copy is this row's format 8. It resolves the seed, then the current runtime, from `~/.local/bin`, because the fixed plugin's layout and the data directory locator are frozen with the adapter.

Evidence and its limits: "moves a format-7 terminal launcher to the fixed plugin's root launcher …" in `install-sh-codex.test.ts` installs a legacy plugin with the frozen format-7 launcher, runs the stub `codex plugin marketplace upgrade hearsay`, shows that format 7 fails, copies the root launcher as the released `recopyLauncher` does, then shows the seed and, after an update, the current runtime. The test restates the released copy rule; it does not run a released CLI bundle, and the stub stands in for Codex's upgrade. The coordinator's combined test with a real released CLI and a real fixed plugin would close that gap.

## Residue

- A user with only Codex whose released `squeal update` fails before `recopyLauncher` keeps a format-7 launcher that finds no CLI until `install.sh` runs again. The release notes can say so.
- Before any hook or `ensure` runs, the launcher runs the seed's CLI from the Codex cache path. A daemon spawned from there lives in a directory that a Codex reinstall deletes. 005-77's `keptCacheCli` does not see the seed path (it expects `<cache>/<v>/dist/cli/squeal.mjs`). W2's `codex-runtime` and the runtime CLI may want a rule for a CLI under `seed/`.
