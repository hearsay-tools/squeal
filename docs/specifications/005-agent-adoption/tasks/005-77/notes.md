# 005-77 notes: a daemon `squeal start` spawns from Codex's plugin cache runs from a kept copy

Worker notes, 2026-10-22. Brief W3 in `011-core/tasks/wave-13.md`; spec 005 D3 as amended 2026-10-21; `005-73-notes.md`, "Open after this row".

## What changed

- `src/harness/shared/version-copies.ts`: `keptCacheCli(cli, version, env)`. When `cli` is `<codex>/plugins/cache/hearsay/squeal/<v>/dist/cli/squeal.mjs`, it keeps `version`'s copy in `<codex>/plugins/data/squeal-hearsay` (`keepVersion`, which also writes `<data>/bin/squeal` and prunes as at SessionStart) and returns the copy's CLI. `<codex>` is `CODEX_HOME`, else `$HOME/.codex`: the cache the launcher looks in. Any other `cli`, or no copy, returns `cli`.
- `src/cli/start.ts`: the daemon's CLI is `keptCacheCli(process.argv[1], squealVersion(), env)`. `finishHandoff` gets the same CLI, so a successor after a handoff runs from the copy too. `SQUEAL_CLI` still overrides it in `daemonCliEntry`.

## Decisions the spec did not settle

- The copy is chosen in `start.ts`, not in `daemonCliEntry`. `daemonCliEntry` serves every hook too, so a choice there would change the spawn of a Codex SessionStart without `PLUGIN_DATA` (a launcher's `thread/start` hooks), which the brief says stays unchanged. `ensure.ts` is not touched.
- Only Codex's cache is kept. Claude Code's cache, `~/.claude/plugins/cache/hearsay/squeal/<v>`, has the same layout, so the check compares the CLI's cache directory with the Codex home, not the layout alone. D3: "Claude Code needs no change."
- The data directory is `squeal-hearsay` and the cache is `hearsay/squeal`, fixed, as the launcher fixes the cache. Codex 0.160.1 names that data directory to hooks (`research/plugin-cache-cleanup.md` 2); the naming rule for another marketplace was not observed.
- No realpath: the launcher builds the CLI's path from the same `CODEX_HOME` or `HOME`, and Node gives `process.argv[1]` resolved but not realpath'd. A CLI started through a symlinked path that differs from `CODEX_HOME` runs from the cache, as before.

## Tests

- `test/harness/codex/version-copies-start.test.ts`: builds the Codex plugin at A into a scratch cache, puts its launcher on a scratch PATH as `install.sh` does, runs `squeal start`, and reads the daemon's arguments from `ps`: `<data>/versions/A/dist/cli/squeal.mjs daemon <root>`. Then it removes A's cache directory and the same daemon still answers. It failed before the change (the daemon named the cache's CLI).
- `test/harness/shared/version-copies.test.ts`, `keptCacheCli`: a cache CLI under `CODEX_HOME` and under `$HOME/.codex` names the copy; a CLI in Claude Code's cache or elsewhere names itself and makes no data directory; a version that is no plain release names the cache's CLI.
- `test/cli/launcher-one-node.test.ts` (005-75's), "spawns `squeal start`'s daemon from the CLI's path": it installed the committed bundle as a Codex cache copy, so after the rebuild its daemon would name the kept copy and the test would fail. It now installs the bundle as Claude Code's plugin through `installed_plugins.json`. Checked against Claude Code bundles built from this tree into a scratch directory: the old install fails (`expected [] to have a length of 1`), the new one passes.

## Open after this row

- A Codex hook other than SessionStart, before any SessionStart of its version kept a copy, still spawns from the cache (`keptCodexCli` is `null`, so `deps.cli` is the cache's bundle). The row names "the first hook" too; the brief's done-when names only `squeal start`. The same `keptCacheCli` call in `src/harness/codex/main.ts`, or `keepCodexVersion` in every Codex hook that ensures the daemon, would close it; neither file is this row's.
- The bundles are not rebuilt here, so `plugins/*/dist` drift until the coordinator's build.
