# Probe: adoption-baseline (throwaway)

Throwaway probe for board row 005-01. Not product code; nothing here is imported by Squeal or its tests.

`metric.mjs` computes the adoption metric of `../../adoption-baseline.md` question 3 from session records, without reading transcripts by hand. Node 22 or later (it uses `node:sqlite` only with `--store`).

```text
node metric.mjs [--store <copy of store.sqlite>] [--json out.json] [--runs] [--label text] <files or dirs...>
```

Inputs, any mix: Claude Code transcripts (`~/.claude/projects/<dir>/<session>.jsonl`, subagent files skipped), `claude -p --output-format stream-json --verbose [--include-hook-events]` output, Codex rollouts (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`), `codex exec --json` output. `--store` must point at a copy, never a live store.

Per session it reports: edits; test runs the agent started (runner, scope full/files/pattern, wall time, outcome from the output, reason by position, reason by the agent's words); Squeal pulls (`status`, `status --wait`, `why`, `run`); skill loads; Squeal messages that reached the model by kind; the Squeal state the agent last saw before each run; with `--store`, whether Squeal held a current result for every file the run covered and whether the agent's outcome agreed with it; final-claim flags (candidates, see the findings file for their precision).

## What was run (2026-10-09)

All under `/tmp/sq005-01`, against symlinks to the records and copies of the stores (`cp` of `store.sqlite`, `-wal`, `-shm` from this repository's and cezar's `.git/squeal/` at 16:25 local). No agent session was started: 0 of the 40 allowed, cost $0.

| Output | Records |
| --- | --- |
| `out/named.txt` | The dogfooding record of specs 001 to 004 still on disk: Claude Code transcripts under `~/.claude/projects/-tmp-squeal-dogfood-{fix,repo,repo-wt2}`, `-tmp-sq46-{fix,repo}`, `-tmp-sq6-{fix,fix2,fix3}`, `-tmp-sq65-{fix,fix3}` (69 sessions); Codex rollouts of 002-19 (`01a1188e`), 003-19 (`01a11ab3`, `01a11abf`, `01a11ac4`) and 004-17 (`01a11f55`, `01a11f5c`, `01a11f6e`). The store rows of these worktrees are pruned, so no store column. |
| `out/squeal-workers.txt` | Every Claude Code transcript under `~/.claude/projects/-home-agent-projects-squeal--ai-cezar-worktrees-*` and every Codex rollout whose `cwd` is a worktree of this repository, holding `SQUEAL · registered` (237 sessions, 2026-10-04 to 10-09; this researcher's own session left out). Store: this repository's. |
| `out/cezar-workers.txt` | The same for cezar's worktrees (93 sessions, 2026-10-06 to 10-09). Store: cezar's. |

Selection scripts were one-off `node` snippets listing those directories; the lists are the directory names above.

## Known limits

- Edits by shell (`sed -i`, heredocs, Python writes) are caught by a pattern, so Codex edit counts are low bounds.
- Exit codes of piped or redirected commands are not the test's; the outcome is read from Vitest's or node:test's summary, else `unknown`.
- The store test uses each test file's closure as `test_files` holds it today, not at the time of the run, and counts a file current when a run in the same worktree covered it after the last change to that closure. A file satisfied only by lookup counts as `redundant-if-lookup`.
- The records are live: sessions still running append to them, so a rerun differs by a few runs (2,439 then 2,440 here).
- Commands run in parallel are ordered by start time, so a pull still running when a test run starts counts as seen by it (002-19's first red run shows `squeal-current` for that reason; the findings table corrects it by hand).
- In this repository `squeal start`, `stop`, `init` and `remove` are mostly the product under test, so they are not counted as pulls.
