# 006-62: worker notes

Worker, 2026-10-15. Brief: `tasks/wave-13.md`, "006-62 the pilot's findings". Evidence read: pilot `20261015T071439Z-65314d`'s retained cells (read only). No cell, session or regrade CLI ran.

## 1. A cell's bare `squeal` is the pinned plugin's

**Cause.** `cellEnv` keeps the host's `PATH`, which starts with `/home/agent/.local/bin`; its `squeal` (spec 005 D3's launcher) reads `installed_plugins.json` under the cell's empty `HOME`. Claude Code's `--plugin-dir` registers nothing there, so it answered `squeal: no squeal@hearsay plugin is installed …` in every pilot Claude cell (a9 to a11, both models). Claude Code appends the plugin's `bin/` after the inherited `PATH`, so the launcher won. Codex cells worked only because the launcher finds the pinned plugin in the cell's `CODEX_HOME`.

**Fix.** `squealBin(harness, cell, pin)` names the directory a cell's bare `squeal` comes from, and run-cell puts it first on the cell's `PATH` (`pathFirst`) right after the pin is built, before the fixture, the daemon or the session:
- Claude Code: the pinned plugin's own `bin/` (`plugins/claude-code/bin/squeal`, spec 001 D9).
- Codex: Codex puts no plugin `bin/` on the `PATH` (its README), so a real Codex user's `squeal` is the launcher `install.sh` copies. The pinned plugin's `bin/squeal-launcher` is copied to `<cell>/home/.local/bin/squeal`, where `install.sh` would put it, and that directory goes first. It resolves the same pinned CLI as before (from the cell's `CODEX_HOME`), without depending on the host's file or its format, so Codex cells' condition does not change. It goes with the scratch `home`.
- No-plugin variants: unchanged. Their bare `squeal` is still whatever the host's `PATH` holds (today the launcher, which says no plugin is installed: true for that cell).

The host's `~/.local/bin` stays on the `PATH` (it holds `claude` and other tools); it is only shadowed for `squeal`.

**Regressions.** `test/evals/cell-squeal.test.ts`: in a temp fixture whose host `PATH` starts with a launcher of its own, a cell's `sh -c "squeal --version"` answers from the host before the fix and from the pinned CLI after, in both harnesses (the Codex half runs the real launcher against a cell `CODEX_HOME`). `test/evals/run-cell.test.ts`: a fake Claude session's bare `squeal` reaches the pin's fake CLI through run-cell (red with run-cell's line removed: `host launcher`).

**First run must confirm:** that Claude Code's Bash tool keeps the inherited `PATH` order (no login-shell snapshot that re-sorts it); the cell's `HOME` has no profile, so none should.
