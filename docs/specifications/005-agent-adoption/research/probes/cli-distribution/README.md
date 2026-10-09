# Probes: cli-distribution (throwaway)

Throwaway probes for `../../cli-distribution.md`, board row 005-05. Not product code. Nothing here is imported, built or tested by Squeal; delete freely.

Run on 2026-10-09 with Claude Code 2.1.295, Codex CLI 0.160.1, Node 24.21.0, npm 11.19.0, Linux 6.8, at host load 34 to 87 on 24 CPUs (each log line with a timing names its load). Squeal plugins from `git archive` of tag `squeal--v0.1.62` and of commit `2d01143` (0.1.72) into `/tmp/cli-dist/pin/v62` and `/tmp/cli-dist/pin/v72`, never the installed copies.

## Rules followed

- Everything ran under `/tmp/cli-dist`. Plugin installs and updates used a scratch `HOME` and `CODEX_HOME` (`/tmp/cli-dist/q1/home`, `/tmp/cli-dist/q1b/home`); the real `~/.claude` and `~/.codex` were only read. The hub is a local git repository served on 127.0.0.1 by `git-http.mjs` (copied from `001-core-loop/research/probes/release-hub/`).
- Daemons ran with their own `XDG_RUNTIME_DIR`, so sockets and the slow slot were the probes' own; every daemon a probe started was stopped by it (`no probe daemon left` in `logs/q2.log`).
- No agent subject session was used: hooks were run as Claude Code runs them, `node <bundle>` with a recorded input (`recorded/`, from `test/harness/recorded/`) on stdin. No test suite of this repository ran. Vitest 5.0.3 was copied into each fixture from `/tmp/r52/nm` (an install another probe left).
- No credential was used or written. The scratch homes hold none.

## Files

- `fixture/`: a 4-file Vitest project (10 tests, one 2.5 s file), from `../instruction-surfaces/fixture`. `mkfix.sh <dir> <cli>` makes a committed copy with `squeal.config.json`.
- `q1.sh`: hub pins 0.1.62, then 0.1.72; installs in both harnesses, a project-scope install beside a user-scope one, updates, and what a resolving shim (`squeal-shim.sh` + `resolve.mjs`) and a fixed path see after each step.
- `q1b.sh`: a CLI install carrying its own local marketplace, added in both harnesses, then replaced in place by the next version.
- `q1c.sh`: Codex hook trust across a version update (0.1.72 to 0.1.73). `q1d.sh`: `claude plugin list` with user and project scopes at different versions.
- `q2.sh`: version skew on one store (A, A2: older daemon under newer hooks, also mid-tier; B: newer daemon under older hooks; C: a newer store schema). `q.mjs` prints the store's daemon version, runs and results.
- `q2b.sh`: the plugin's CLI bundle packed as a standalone npm package and installed globally into a scratch prefix.
- `q3.sh`: a terminal setup on a fresh fixture (warm-up cost, the idle exit, the first session; Codex trust without a terminal). `q3b.sh`: a linked worktree of the warm fixture.
- `logs/`: the output of each script as run.
