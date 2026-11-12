# Issue 204: a rebase onto a newer base queues the whole suite

Researcher findings, 2026-11-12, for issue #204 (hearsay-tools/squeal). Squeal 0.1.457 installed (`squeal --version`), the version the reporter inferred. Source and spec read at `c2a6d3718`. Probe: `research/probes/issue-204/` (throwaway). Time box 20 minutes.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does a rebase queue tests while the daemon runs? | Yes. The rebase is one revision. Every test file whose key changed is queued at once; files whose key did not change stay current. | verified by experiment, 0.1.457 |
| 2 | Does Squeal tell the branch's own test edits from upstream base changes? | No. Keys name content (C3), never the commit or the branch. A branch test file whose content and closure are the same before and after the rebase keeps its key and stays current. Everything upstream re-keyed is queued, whether or not the branch touched it. | verified by experiment; read in spec C3 |
| 3 | Is this whole-suite invalidation or valid key changes? | In the probe, both kinds appear and are distinct. Upstream edits to 11 sources queued exactly their 11 test files. An upstream edit of the root Vitest config (an environment input) queued all 12. A `package.json` version-only bump queued none. | verified by experiment, 0.1.457 |
| 4 | Does `baseline.onStart: "lookup-only"` stop this? | No. That policy acts only when a daemon starts. A revision while the daemon runs queues every miss it re-keys; a revision of 10 or more keyed paths queues them as catch-up on the backlog's route. | verified by experiment; read in spec C4 steps 3 and 4; read in source `src/core/scheduler/revision.ts:48` (`CATCH_UP_KEYED_PATHS = 10`) |
| 5 | What re-keyed about 1,270 files in the reporter's worktree? | Not determined, because no status JSON, revision record or worktree was kept, and the worker's old base commit is not known. Candidates from the upstream diff of that day are listed below. | inferred |
| 6 | Would results stored by other worktrees at the new keys have cut the queue? | Not tested. The spec says a key with a stored result is promoted without a run (C4 step 3), and catch-up files are looked up again on each pass. The probe had one worktree only. | read in spec C4 step 3 |

## Probe

Setup (`run.sh`): a private Git repository under the task scratch directory (`.ai/cezar/t/9de32fd5/issue-204/repo`), its own store in that repository's `.git/squeal/`, a private `HOME` that holds only a copy of `installed_plugins.json` (the launcher refuses to run without it), and this worktree's `node_modules` through a symlink. Config: `baseline.onStart: "lookup-only"`, coverage and complexity off. 12 sources `src/mNN.ts`, each with one test `test/mNN.test.ts`.

History: `base`; upstream `main` adds (1) edits to `src/m01..m11.ts`, (2) a `package.json` version bump, (3) a comment line in `vitest.config.ts`. Branch `work` from `base` edits `test/m01.test.ts` and `test/m12.test.ts` (test-only, two commits). `m12` is the same-key control for phase A: its source is untouched upstream.

Commands, in the probe repository: `squeal start`; `squeal run --all --wait` (12 run); then for each phase `git rebase -q <target>`, `squeal status --json` once a second for 6 s, `squeal status --full`, `squeal status --wait 60000`; last `squeal stop` (exit 0). After the run no process had a working directory in the probe repository.

Load (one-minute, 24 logical CPUs): 20.73 at start, 18.76 at the end (`out/log.txt`). Below the CPU count, so the live probe ran.

| Phase | Rebase onto | Revision | First status after rebase (≤1 s) | Settled |
|---|---|---|---|---|
| A | `main~2` (11 source edits) | 1 | 11 queued (m01 to m11), 1 current (m12) | 12 current |
| B | `main~1` (version bump only) | 2 | 0 queued, 12 current | 12 current |
| C | `main` (config comment only) | 3 | 12 queued, 0 current | 12 current |

Files: `out/A-after-1.json`, `out/B-after-1.json`, `out/C-after-1.json` (`testFilesByPhase`, `pendingTestFiles`), `out/*-after-full.txt`, `out/git-log.txt`. Phase A had 11 keyed paths, at or above the catch-up threshold of 10; the probe did not separate catch-up from edit work in its output.

## The reporter's day, read from this repository's history

`git diff --name-only 9995fd409 origin/main` (the last `main` commit before 2026-11-12 00:00 UTC, to `origin/main` at 22:24 UTC): 677 paths, of which 160 under `src/`, 148 under `test/`, plus `package.json`, `pnpm-lock.yaml` and `squeal.config.json`. In `package.json` the version moved 0.1.440 to 0.1.459 and a dev dependency `@vitest/coverage-v8` 5.0.3 was added. `squeal.config.json` added one `inputs` entry (`test/ci-action/**/*.test.ts` to `ci/**`). Read with `git diff`; `inferred` as to their effect:

- A changed dependency set can re-key every file through the installed-dependency segment or the environment hash (C3, C11), but only once `node_modules` changes. Whether the worker reinstalled after the rebase is not known.
- 160 changed sources include widely imported modules (for example `src/cli/main.ts` and `src/core/capacity/*`). Through static closures and the declared `inputs` (several entries name `src/**/*.ts`), these alone can re-key a large share of the suite. Each such re-key is a valid key change, not an invalidation.
- This worktree reports "Closure method: static imports plus declared inputs" (`squeal status --full`, 22:25 UTC).
- This worktree lists 1,106 Vitest test files; the report says about 1,270. The gap is not explained (another lane, checks counted as files, or a different base); not determined.

## Recommendation for Squeal

Treat #204 as a policy question, not a defect in keys. On 0.1.457 a rebase queues what its keys say changed, and the same-key control proves that unchanged files are not re-run. The issue's request, select by `merge-base..HEAD` and leave base-only changes stale and unqueued, means a running daemon would leave misses unqueued after a revision. That is a change to C4 step 3 and 4 (today only a daemon's start is lookup-only), and it touches the human's 2026-10-20 decisions on what lookup-only covers (status.md); it needs the human's decision. Before deciding, measure on this repository how many files one day of upstream re-keys and how many of those another worktree had already stored, since C4 step 3 inheritance could already cut the run. A cheaper first step is a status line at the rebase revision that says how many files a base move queued and how to defer them; whether a command to defer them exists today was not checked.

## Open questions

1. How many of the about 1,270 files would have been inherited from other worktrees at their new keys? Needs a second worktree at the new base, or a read of the shared store. Not done: the brief allowed no other daemon.
2. Did the worker's tree change `node_modules` (a reinstall after the rebase)? Decides whether the dependency set re-keyed every file.
3. Does catch-up on an overloaded host respect the capacity ceiling (C10)? Not tested; the probe host was below its CPU count.
4. What does the status line say at the rebase revision, before the first tier? The probe kept JSON at that moment, not the text.

## Sources

- Issue: `gh issue view 204 -R hearsay-tools/squeal`, created 2026-11-12T21:27:19Z.
- Spec: `docs/specifications/011-core/spec.md` C3 (keys, environment hash), C4 steps 3 and 4 (lookup, catch-up threshold 10, lookup-only scope), at `c2a6d3718`.
- Status log: `docs/specifications/011-core/status.md` entries of 2026-10-20 (lookup-only scope) and 2026-10-23/24 (011-159).
- Source: `src/core/scheduler/revision.ts:48`, `src/core/scheduler/queue.ts:77`, `src/core/store/paths.ts:12` (store under `<git-common-dir>/squeal/`), at `c2a6d3718`.
- Probe: `research/probes/issue-204/run.sh`, `research/probes/issue-204/out/`.
