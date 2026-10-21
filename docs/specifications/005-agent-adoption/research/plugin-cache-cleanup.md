# Plugin cache cleanup: which layer deletes an old version a live session names (005-72)

Date: 2026-10-21. Brief: `plugin-cache-cleanup-brief.md`. Issues: [#48](https://github.com/hearsay-tools/squeal/issues/48), [#70](https://github.com/hearsay-tools/squeal/issues/70) (proposed). Versions examined: Codex 0.160.1 (`rust-v0.160.1`, `d27764b82`), the host's Claude Code 2.1.306 (bundled JS read as text), the Claude Code docs as fetched today, Squeal at `705d4c022`.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Who deletes, on what trigger | **Codex**: its plugin store, in the same call that installs a new version. It runs on `codex plugin add`, on `codex plugin marketplace upgrade` (which `squeal update` runs), and on the auto-upgrade thread that every Codex process (TUI, `exec`, app-server) starts at startup. That thread acts only when the marketplace's remote git revision changed. Nothing checks for a live user. **Claude Code**: an update only writes `.orphaned_at` into the old version. A sweep at each session's plugin load deletes it 14 days later, and skips a version that a live Claude Code process holds in `.in_use/<pid>`. | Codex: verified by experiment and read in source code. Claude Code: read in official docs and read in source code, with this host's cache as a read-only check. |
| 2 | What survives | **Codex**: nothing under the old `<version>/`. The skill catalog in the thread's initial context, the primer's `node "<root>/dist/cli/squeal.mjs"`, the hook commands of every other Codex process, and the recorder `--import`/`--require` path that a running tier gives its children all name deleted files. Files that are already open stay readable. Only the process that ran the upgrade refreshes its hooks to the new root. **Claude Code**: everything, for at least 14 days, and for as long as the session that loaded the version lives. | Codex: verified by experiment and read in source code. Claude Code: read in source code and official docs. |
| 3 | Options | Squeal cannot keep files inside Codex's cache: Codex deletes them in its own install call. What Squeal can own is the plugin data directory. Both harnesses keep it across updates and give its path to hooks. Costs are below. | Read in source code and official docs; costs inferred. |
| 4 | Regression | Steps and test stand-ins are below. Codex's deletion is one `remove_dir_all` of the sibling version directories, so a unit test can stand in for it exactly. | Read in source code; test design inferred. |

## 1. The deleting layer

**Codex 0.160.1.** `core-plugins/src/store.rs`, `replace_plugin_root_atomically`: a new version is renamed into `<cache>/<marketplace>/<plugin>/<version>`, then `remove_old_plugin_versions` calls `fs::remove_dir_all` on every other version directory (lines 648 to 725). When the version already exists, the whole `<plugin>/` directory is renamed to a temporary backup and replaced, and the backup is dropped. So a marketplace commit that keeps the version still replaces every file. The callers:

- `codex plugin add` (`manager.rs` 2275 to 2289).
- `codex plugin marketplace upgrade` (`cli/src/marketplace_cmd.rs` 386), which runs `refresh_non_curated_plugin_cache_force_reinstall_detailed` for each marketplace whose root changed (`manager.rs` 2961 to 2990).
- Startup: `maybe_start_plugin_startup_tasks_for_config` (`manager.rs` 2812) starts the thread `plugins-marketplace-auto-upgrade`. The app-server calls it at start (`message_processor.rs` 554), and the in-process app-server that the TUI and `exec` use sets `plugin_startup_tasks: Some(Current)` (`in_process.rs` 517). The thread acts only when `git ls-remote` gives a revision that differs from the recorded one (`marketplace_upgrade.rs` 241 to 254).
- `plugin/list` background refresh (`manager.rs` 1804), only when the version changed.

The Codex docs say only that plugins install into `~/.codex/plugins/cache/$MARKETPLACE_NAME/$PLUGIN_NAME/$VERSION/` and that the installed copy loads from there. They say nothing about retention (read in official docs, developers.openai.com/codex/plugins/build).

Verified by experiment, as `squeal-e2e` with Codex 0.160.1 (`probes/plugin-cache-cleanup/run.txt`). A dummy plugin was installed at 1.0.0 from a git marketplace served on localhost. Then a commit raised it to 1.0.1, and `codex plugin marketplace upgrade probe` ran. After it the cache held only `1.0.1`, and `1.0.0/skills/probe/SKILL.md` was gone. A file descriptor opened before the upgrade still read the old content. A later commit that kept 1.0.1 left `1.0.1` with a new inode (575222527, then 1611137122). Load: the run started at one-minute load **25.78** on 24 CPUs. This is above the brief's limit of 24: the run was chained after a check that read 22.13 at 17:11:28, without a second gate. The result is a directory listing, so the load cannot change it, but the run broke the brief's rule. The Claude Code half stopped at `marketplace add`: Claude Code clones shallow, and a dumb HTTP server cannot serve that. It was not retried.

**Claude Code 2.1.306.** The docs (code.claude.com/docs/en/plugins/loading, "Cleanup of previous versions"): "When you update or uninstall a plugin, Claude Code writes an `.orphaned_at` marker into the previous version directory. It removes that directory in a background cleanup 14 days later, so a session that already loaded the old version keeps running." The bundled source agrees and adds a check that the docs do not mention. After `plugins_init`, the sweep `FCs` marks each version that no `installed_plugins.json` record names (function `Fpe`). It deletes a version only when `now - mtime(.orphaned_at) > 1209600000` ms (14 days) and when `zb` finds no live process under `.in_use/` ("Skipping orphan cleanup, in use by live session"). Each Claude Code process writes `.in_use/<pid>` as `{"pid","procStart"}` into the version it loads. Read-only listing of this host's cache: `~/.claude/plugins/cache/hearsay/squeal/` holds 29 versions, from 0.1.62 to 0.1.238. Each holds `.in_use/`, and every version except 0.1.238 holds `.orphaned_at`. 0.1.62 has been orphaned since 2026-10-10 00:05 and is still there. `.in_use/` of 0.1.237 names five pids, all of them live `claude` processes at 17:07. Of the five pids in `.in_use/` of 0.1.238, four were live and one had exited. A dead pid does not protect a version. Plugin auto-update is off by default for third-party marketplaces such as `hearsay` (same page, "When auto-update runs").

## 2. What survives

| Path a session holds | Codex | Claude Code |
|---|---|---|
| Old `<version>/` | Deleted at the install, in any process | Kept for at least 14 days, and while a live session holds it |
| Skill catalog path (`.../<version>/skills/squeal/SKILL.md`) | Gone. The catalog is rendered into the thread's initial context (`ext/skills/src/extension.rs`, `contribute_thread_context`, called from `build_initial_context_with_world_state` in `core/src/session/mod.rs` 4301), so earlier turns keep the old path | Kept |
| Primer's CLI path (002 D1: `node "<PLUGIN_ROOT>/dist/cli/squeal.mjs"`) | Gone. The process that ran the upgrade calls `refresh_hook_runtimes` (`thread_manager.rs` 839), so its later hooks get the new `PLUGIN_ROOT`. This matches #48's later primer naming 0.1.226. Every other Codex process keeps the old `PLUGIN_ROOT`, which is set when hooks are discovered (`hooks/src/engine/discovery.rs` 265), so all its hook commands fail until it restarts | Kept. `squeal` comes from the plugin's `bin/` on the PATH, and the docs say mid-session updates keep the old path until `/reload-plugins` |
| Recorder `NODE_OPTIONS` path (`observeRecorder` resolves `dist/observe/recorder.cjs` beside the daemon's own module, `src/runners/observe/runtime.ts` 35) | Gone. A child spawned after the deletion fails to load it: #70's `ERR_MODULE_NOT_FOUND`. The daemon also reads `observe/*.cjs`, `node-test/*` and `pytest/*` from that directory during a tier | Kept. A daemon from a 14-day-old version would lose it, but no live `claude` pid protects a daemon that outlives its session (inferred) |
| The plugin data directory | Codex gives `PLUGIN_DATA`/`CLAUDE_PLUGIN_DATA` = `~/.codex/plugins/data/squeal-hearsay` to hooks. It does not create the directory, and no code in `store.rs` or `manager.rs` removes it | `${CLAUDE_PLUGIN_DATA}` = `~/.claude/plugins/data/squeal-hearsay`, "kept across plugin updates" (plugins-reference); it is deleted only at the last uninstall |

Inferred: #70's deletion was a Codex install. Under Claude Code the directory would have lasted 14 days.

## 3. Options and their costs

1. **Keep the last N versions in the cache.** Not possible in Codex. The deletion is inside Codex's install call, so Squeal runs only after it. Putting a version directory back would fight the harness, and the next install deletes it again. Claude Code already does this, with a 14-day grace and a live-session check. Cost: no gain in Codex.
2. **Stable entry points in the plugin data directory, owned by Squeal.** A hook (SessionStart) copies its own `dist/` and `skills/` once into `<PLUGIN_DATA>/versions/<version>/` (2.4 MB today, of which `pytest/` is 668 KB) and writes `<PLUGIN_DATA>/bin/squeal`, the existing launcher. The Codex primer and the FAIL report's `squeal why` line name that launcher. The skill text names its copy. The daemon resolves its recorder and reporters from the copy of its own version. Squeal prunes the copies with 009-18's rule (`install.sh` `previous` and `in_use`): keep the newest previous copy and any copy that a running process names. Costs: one copy per version; a pruning pass that Squeal owns; and version provenance for the CLI, because the launcher runs the newest installed version, as D3 already accepts. The recorder keeps its own version, because the daemon picks the copy by its own version. What it does not fix: Codex's catalog line and the hook commands of other processes still name the cache.
3. **Hook commands that do not name the version.** For example, `node "${PLUGIN_DATA}/hook.mjs" <event>`, which runs the copy named by `basename($PLUGIN_ROOT)` and falls back to `$PLUGIN_ROOT`. This keeps another process's hooks working after the deletion, and keeps their version. Costs: every Codex user trusts the hooks again once, because the command text changes the trust hash (002 D1). The pinned-hash test changes. The first hook of a new install must work before the copy exists.
4. **A session that re-reads the catalog.** Squeal cannot make Codex re-render the initial context. A later primer from a refreshed hook can name the new skill path, as #48 saw. But a process whose hooks still point at the deleted root sends no Squeal text at all. Cost: little to build, but it covers only the process that ran the upgrade.

The tradeoff that decides: what the agent runs (the CLI, the skill) may be the newest version, as the launcher already is. What a running tier loads (the recorder, the reporters) must be the daemon's own version. Option 2 meets both rules, and it is the only option that also covers gh-70.

## 4. The regression a code row needs

Steps of a session that spans an upgrade: start on A (SessionStart: primer, catalog), edit, upgrade to B in another process (Codex deletes A), start a tier on A's daemon, then in the same session run the primer's CLI, read the skill, take the next hook, and finish with `squeal status --wait`.

Where a test stands in for the harness: build a cache in a temporary directory with A and B side by side. Then run `rm -rf <cache>/hearsay/squeal/A`, which is exactly Codex's `remove_old_plugin_versions`, between steps. Pass `PLUGIN_ROOT=A` and `PLUGIN_DATA=<tmp>/data` to the hook entry points as Codex's discovery does. One real-harness check stays in `test/e2e` (excluded from Squeal) as `squeal-e2e`: `codex exec` on A, `codex plugin marketplace upgrade` to B from a localhost git marketplace (the probe's method works for Codex), then a resumed turn.

## Recommendation

Own the stable entry points in the plugin data directory (option 2). The deletion is Codex's own install step, so no version can be kept inside the cache. Claude Code needs no change. The code row is done when these tests pass:

1. After a SessionStart from A, `<PLUGIN_DATA>/versions/A/` and `<PLUGIN_DATA>/bin/squeal` exist, and the Codex primer and FAIL report name the launcher, not a cache path.
2. After `rm -rf` of A in the cache, the CLI the primer named runs, and its output names both A (the session) and B (the CLI).
3. After the same deletion, the skill path the primer names reads.
4. A tier started on A's daemon spawns a child after A's cache directory is deleted, and the child loads A's recorder copy: no `ERR_MODULE_NOT_FOUND`, and no failed result.
5. Pruning keeps a copy that a running process names and the newest previous copy, and removes the others.
6. With Claude Code's layout (`.orphaned_at` written, nothing deleted), nothing changes in its primer or in the CLI on its PATH.
7. The e2e as `squeal-e2e`: a Codex session spanning `codex plugin marketplace upgrade` runs its advertised CLI and reads its advertised skill without searching the cache.

If the human also wants other processes' hooks to keep working (option 3), it adds a test: a hook run with a deleted `PLUGIN_ROOT` still delivers, from the copy of its own version. It costs one trust re-grant for every Codex user.

## Open questions

- Whether Codex re-renders the skill catalog after compaction. `build_initial_context_with_world_state` is called at 4633 and 4693 in `session/mod.rs`, and this file did not trace those callers. Not determined, because it was not read.
- What a Codex hook does when its command file is missing: a warning, a block, or silence. Not determined, because no hook was run against a deleted root.
- Claude Code's sweep with a daemon older than 14 days whose session has ended. Inferred from source, not tested.

## Sources

- Codex: https://github.com/openai/codex at tag `rust-v0.160.1` (`d27764b82`): `codex-rs/core-plugins/src/store.rs`, `manager.rs`, `loader.rs`, `marketplace_upgrade.rs`, `marketplace_add/source.rs`; `codex-rs/core-plugin-common/src/installed.rs`; `codex-rs/app-server/src/message_processor.rs`, `in_process.rs`, `request_processors/plugins.rs`; `codex-rs/core/src/thread_manager.rs`, `core/src/session/mod.rs`; `codex-rs/hooks/src/engine/discovery.rs`; `codex-rs/ext/skills/src/extension.rs`.
- Codex docs: https://developers.openai.com/codex/plugins/build (fetched 2026-10-21).
- Claude Code docs: https://code.claude.com/docs/en/plugins/loading ("Cleanup of previous versions", "When auto-update runs"), https://code.claude.com/docs/en/plugins-reference ("Environment variables"), fetched 2026-10-21.
- Claude Code 2.1.306: `@anthropic-ai/claude-code/bin/claude.exe`, the bundled JS read with `dd` and `tr` (functions `FCs`, `Eis`, `Fpe`, `zb`; constants `BHn=1209600000`, `gW=".orphaned_at"`, `Um=".in_use"`). It was not executed as this user.
- Host, read-only: `~/.claude/plugins/cache/hearsay/squeal/*/{.in_use,.orphaned_at}`, `~/.claude/plugins/installed_plugins.json`, `~/.codex/plugins/cache/hearsay/squeal/` (only 0.1.238).
- Probe: `probes/plugin-cache-cleanup/upgrade.sh`, `run.txt`, run as `squeal-e2e` (Codex 0.160.1, Claude Code 2.1.300).
- Squeal: `install.sh` 240 to 340 (009-18 retention), `plugins/codex/bin/squeal-launcher`, `src/runners/observe/runtime.ts`, spec 005 D3 and D6, spec 002 D1.
