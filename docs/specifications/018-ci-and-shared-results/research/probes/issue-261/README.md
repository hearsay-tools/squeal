# Probes for row 018-69 (gh-261): throwaway

These scripts are throwaway. They back `../../issue-261-ci-import.md` and are not product code or tests.

| Script | Question | Where it ran | What it touches |
|---|---|---|---|
| `pull-refs.sh` | Q1: do `fetch` and `pull` bring `refs/squeal/*` | this host, a `mktemp -d` scratch, no network | its own scratch repositories, removed on exit |
| `lag.mjs` | Q3: when main moved and when CI published each export | this host | GitHub Actions API through `gh api`, read-only |
| `moves.mjs` | Q3: start-point moves against publish times | this host | a copy of the reporter's store; `git merge-base` in the reporter's clone, read-only |
| `reporter.mjs` | Q4: files the coordinator ran against the new HEAD's export | this host | a copy of the reporter's store |
| `coordinator.cjs` | Q2: the coordinator's revisions and the store's imports | this host | a copy of the reporter's store |
| `ff.sh` | Q2, Q4: a live fast-forward with a running daemon | boat.dev sandbox only | its own clones, store and HOME in the sandbox |
| `analyze.mjs`, `closure-new-paths.cjs`, `started-by.cjs` | Q2, Q4: per-file origin, closures and run starts after the fast-forward | this host | copies of the sandbox stores |
| `started-before-publish.cjs` | Q5: the coordinator's runs started before publish + 30 s | this host | a copy of the reporter's store |

`ff.sh` needs a payload next to it: `payload.tgz` with `origin.git` (a `--depth 60` bare clone of squawk's main, plus `refs/squeal/<sha>` of `cf77ce2d`, `686bc2f0`, `27faff7e`, `6c43132d`, `e8db12ef` fetched read-only) and `plugin` (this worktree's `plugins/claude-code`, Squeal 0.1.585). The remote is that local bare copy, so nothing reaches GitHub from the sandbox. It installs Node 26.13.0 and pnpm 12.11.2 there. Scenario A: `ff.sh run A 686bc2f0… 27faff7e… 0`. Scenario B: `ff.sh run B 6c43132d… e8db12ef… 97`. A's settle loop was stopped by hand: 97 files of the project's manual browser group stay queued until `squeal run browser`; the fixed loop counts them as idle (`MANUAL_QUEUED`).

Outputs: `out/pull-refs.txt`; `out/reporter/` (lag, moves, runs against exports, the coordinator's revisions and imports, its daemon log's import and stop lines); `out/sandbox-A/` and `out/sandbox-B/` (status every 2 to 15 s, logs, `status --full` before and after, per-file analysis). The stores themselves (140 MB each, and the reporter's 8 GB copy) are not committed; they stayed in the task scratch directory and were removed at the end.
