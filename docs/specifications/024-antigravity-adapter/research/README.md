# 024 Antigravity adapter: wave 0 research

Topic `wave-0-checks`: close spec 024 Open questions 2, 3 and 4, and verify exact hook payload schemas before Wave 1 starts.

Read `docs/specifications/024-antigravity-adapter/spec.md`, `status.md` and `research/antigravity-hooks-and-plugins.md` first. Write findings to `docs/specifications/024-antigravity-adapter/research/wave-0-checks.md`, with throwaway probes under `research/probes/wave-0-checks/`. Never commit absolute home paths (write `~`), private repository names, or recorded session logs (`pnpm run check:private` enforces this).

## Questions

1. **Binary name detection (spec OQ2).** What Antigravity CLI binary names exist on this host (including under `~/.local`, `/usr`, Squawk's runner paths, or `PATH`) and in official Antigravity docs (`https://antigravity.google/docs/cli/reference.md` or built-in docs)? Recommend whether `install.sh`, `squeal update`, and `src/cli/setup/harnesses.ts` should check `SQUEAL_ANTIGRAVITY_BIN`, then `agy`, then `antigravity`, and confirm whether both binaries share the exact same `plugin install` / `plugin uninstall` / `plugin validate` subcommands.
2. **Installed `PLUGIN_DATA` path and disabled-plugin config shape (spec OQ3).** Install a minimal throwaway plugin via `<cli> plugin install <dir>` in an isolated temporary `HOME` (do not touch the real `~/.gemini/config/plugins/`). Trigger a live hook run (e.g. `SessionStart` and `PreInvocation`) with `antigravity` CLI `1.5.14` (symlinking only what auth needs inside the temp `HOME` if required, without reading or printing any credential). Record:
   - The exact `PLUGIN_DATA` and `PLUGIN_ROOT` environment variable values (rewritten with `~` for the temp home prefix) seen by the installed plugin's hook.
   - How `plugin disable <name>` writes the disabled state in `~/.gemini/config/config.json`, so `squeal update` and `src/cli/setup/harnesses.ts` detect disabled installs accurately.
   - Whether `PLUGIN_DATA` persists across a second `plugin install <dir>` (in-place update) and whether `plugin uninstall <name>` keeps or deletes `PLUGIN_DATA`.
3. **`hooks/run --if-squeal` large and tricky stdin payloads (spec OQ4).** Test a pure-POSIX `sh` script using `payload=$(cat)`, parameter expansion to extract top-level `"cwd":"..."`, git-common-dir / `squeal.config.json` check, and `printf '%s'` passthrough under both `dash` (`/bin/sh`) and `bash`:
   - 100 KB `lastUserInput` (UTF-8, quotes, backslashes, embedded newlines, trailing newline vs no trailing newline).
   - Fake `"cwd":"/squeal/repo"` inside `lastUserInput` when real `"cwd"` is a non-Squeal repo.
   - Spaces in `cwd`, backslash-escaped `cwd` (must fall through to Node), and linked git worktree (`gitdir:` + `commondir`).
   - Verify byte-exact stdin passthrough (note: `$(cat)` strips trailing newlines in POSIX `sh`! Check whether protojson stdin has a trailing newline, and whether stripping or preserving a trailing newline affects JSON parsing or if a trailing sentinel/printf handles it cleanly). Measure p50/p95 latency over 30 runs on a non-Squeal repo (target < 10 ms p95).
4. **Sanitized hook payload shapes for `test/fixtures/antigravity-hooks/`.** List the exact top-level and event-specific JSON fields (and types) observed from `antigravity 1.5.14` for `SessionStart`, `PreInvocation` (`invocationNum` 0 and >0), `PreToolUse` (`write_file`, `edit_file`, `run_command`), and `Stop` (`executionNum` 0 and 1, `continuationActive`, `fullyIdle`, `terminationReason`), so Wave 2 can construct clean, representative fixture files with zero private paths or names.
