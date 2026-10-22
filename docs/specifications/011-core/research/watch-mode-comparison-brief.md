# Research brief 011-119: edit to result, Squeal against the runners' own watch modes

Use /researcher. Shape: research. Outcome: for each scenario on three repositories, the time from a file write to a correct result for Squeal, `vitest --watch`, plain pytest and pytest with testmon, whether each result was correct, and which of Squeal's stages cost the difference.

## Why

011-115 (`research/edit-latency.md`) found that a Python edit in toolkit-dev took 135.7 s to give its result. The watcher took 151 ms. Every other delay came from something Squeal adds on top of watch mode: observed reads made the test catch-up work, which waited for a host permit and a 20 s quiet, and vim's swap files cancelled runs. Plain watch mode would have been fast there, but wrong: a `.py` file is not in Vite's graph, so `vitest --watch` would never re-run the drift test. The human (2026-10-22): "I start to feel like we decided to build all of it ourselves and now we keep fixing stuff like this." Rows 011-116 to 011-118 and 007-55 are held until this comparison is in. Spec 001's research never measured Vitest's watch mode as an option; this does.

## Read first

`research/edit-latency.md`; 011 C2 (watcher), C4 (edit work, catch-up, quiet, cancels), C10 (permits); 013 Design (the warm instance, `invalidate`, `affected`); 007 spec, Non-goals (testmon) and `007-pytest-runner/research/python-module-graph.md` Q6.

## Scenarios, at least

- **squeal** (main at 0.1.265, `da73c4984`): a body edit of a module that a few tests import directly, then its revert; an edit that breaks one test; an edit of a test file.
- **cezar** (pnpm, Vitest projects): the same three.
- **toolkit-dev** (`7f939fb9`, after `uv sync` in each tool, as in the live checkout): the 011-115 sequence on `plugin-tools/estimate-pricing/cli.py`, with and without a vim swap file; a body edit of `estimate_pricing/rules.py`; a TS edit under `tools/generator/src`.

Each scenario states its expected result before any measurement: which test files must fail or pass, taken from a plain targeted run.

## Questions

1. **Latency.** Per scenario and tool: write to the first result that covers the edit's affected tests. Median and range over at least 5 repetitions, with the one-minute load beside each.
2. **Correctness.** Was each result right against the expected result? Name every false pass and every test file a tool ran that it did not need.
3. **Squeal's stages.** For Squeal's slow cases, split the time into watcher, revision, queue, permit, quiet, cancel and run, from `status --json` and the scratch store. Which stages does watch mode not have?
4. **Contention.** Squeal's latency with its pool permits held by another holder, as on the live host; watch modes have no pool.
5. **Recommendation.** Which Squeal stages to cut or change, which parts to hand to the runner (for example Vitest's `related` path or its watcher for edit work), and what each costs in correctness, with evidence from questions 1 to 4.

## Rules

- `git clone` each repository under `/tmp`, never `git worktree add`. Install offline. Run every tool with `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and `TMPDIR` under `/tmp`. Never touch the live permit pool, a live daemon, or a live store.
- Use Squeal from the clone's committed `plugins/claude-code/dist`. No build in your worktree.
- Give every tool the same width: at most 4 test workers. Run only the scenario's test files and their candidates, never a whole suite. Interleave the tools inside each repetition, so that load hits all of them alike.
- At the end, stop everything you started, remove your clones, and show that nothing of them is left.
- Tag every finding: `verified by experiment`, `read in source code`, `read in official docs` or `inferred`. Lead with seconds, then n. Budget about three hours.

Own `research/watch-mode-comparison.md` and `research/probes/watch-mode-comparison/` only. Edit no board, spec, status, test or product file.

Done when the table covers every scenario and tool with latency, n, load and correctness, and the recommendation names each stage to change with its measured cost. Commit.
