# Research brief 011-299: why a new worktree's first baseline runs so much

Use /researcher. Shape: research. Outcome: for every file a new cezar worktree's first start baseline ran, why no stored result matched, by share of seconds, each cause tagged as a defect, an expected re-key, or a configuration or setup choice.

## Why

The human, 2026-11-05: "I still don't get how it is possible that each new worktree has to run so much of this." `019-run-triggers/research/load-split.md` section 1: in 72 h, 247 baselines were a cezar worktree's first in the store: 78,458 files listed, 215,735 s. `research/restart-baseline.md` (011-298) classified only restarts. The human's expectation (2026-10-27): work validated in a worktree before it merges should be inherited by the next worktree started from main. A 2026-10-27 experiment confirmed that inheritance works for equal content (branch `cez/52adfef4`, commit `24aa26286`, `research/completed-donor-inheritance.md`).

## Read first

`research/restart-baseline.md` and `probes/restart-baseline/` (reuse `classify.cjs`, `causes.cjs`); `019-run-triggers/research/load-split.md` and its probes; `git show 24aa26286:docs/specifications/011-core/research/completed-donor-inheritance.md`; spec 011 C3 (keys, lookup across worktrees); 001 D3 (observed set).

## Questions

1. **Classify each first-baseline file run** (first matching class, seconds and shares): (a) an equal key was stored on this host before the run started (a lookup that should have hit: defect candidate); (b) no worktree ever computed this key, because the start commit's merged tree was never validated here (the merge of several branches, each validated alone); (c) a stored result exists for the same test at the same commit or content with a key that differs only in the environment (install fingerprint, Node version), the observed set, or `runtimeFiles`: name the component; (d) the same key was being run by another worktree at the same time (parallel duplicate); (e) other.
2. **The merged-tree case.** For (b): how many first baselines started from a commit that no daemon on this host had seen, and how often hub files (in most closures) changed in that commit's merge.
3. **Defects.** Reproduce any (a) or (d) in a fixture under your `$TMPDIR`.
4. **Levers.** Upper bound, from 1 to 3, for each: a daemon on the main checkout that validates `origin/main` after each pull; consistent installs; any fix for (a) or (d).

## Rules

As in `research/restart-baseline-brief.md`, "Rules". Budget about two hours. Own `research/new-worktree-baseline.md` and `research/probes/new-worktree-baseline/` only. Done when questions 1 to 4 have numbers and tags. Commit.
