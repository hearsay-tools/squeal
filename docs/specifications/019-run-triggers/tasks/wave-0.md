# Spec 019 wave 0: research

Three researchers in parallel. Each is read-only on the product and writes one file. Their topics are disjoint, so they run together.

## 019-01 runner-trigger

Use /researcher. Answer topic `runner-trigger` in `docs/specifications/019-run-triggers/research/README.md`: whether a project can choose per runner to run its tests after each edit or only at Stop, and what that would mean. Shape: research. Read the README's rules first, then spec 004 D1, D2 and D7 and `src/core/daemon/policy.ts`. First step: in a fixture repository under `$TMPDIR` with a Vitest and a node:test runner, put one runner's files in `slow.include` with `slow.trigger: "idle"` and read what status and the primer say. Owns only `research/runner-trigger.md` and `research/probes/runner-trigger/`. Leave `commit-checkpoint.md` and `stop-wait.md` to their siblings; for the wait at Stop, cite `stop-wait`, do not measure it. Done when `research/runner-trigger.md` is committed, answers questions 1 to 5, tags every finding, and no daemon or directory of yours is left.

## 019-02 commit-checkpoint

Use /researcher. Answer topic `commit-checkpoint` in `docs/specifications/019-run-triggers/research/README.md`: how Squeal could learn of a commit, what a checkpoint there would run and on which tree, and whether it blocks or reports. Shape: research. Read the README's rules first, then `src/harness/` (the tool-hook entries of each adapter) and spec 015's rule for a moved `HEAD`. First step: in a fixture repository under `$TMPDIR`, list which of `pre-commit`, `post-commit`, a `HEAD` move and a harness tool hook see a plain commit, an amend, `--no-verify` and a rebase. Owns only `research/commit-checkpoint.md` and `research/probes/commit-checkpoint/`. Leave `runner-trigger.md` and `stop-wait.md` to their siblings. Done when `research/commit-checkpoint.md` is committed, answers questions 1 to 5, tags every finding, and no daemon or directory of yours is left.

## 019-03 stop-wait

Use /researcher. Answer topic `stop-wait` in `docs/specifications/019-run-triggers/research/README.md`: whether Stop already lets a project require every slow test, and the smallest change if not. Shape: research. Read the README's rules first, then spec 004 D9 and the `stop-slow` entry with every plugin's hooks file under `plugins/`. First step: list each case in which a slow file can be not current when the agent finishes under `stop.requireSlowSuite: true`, from source. Owns only `research/stop-wait.md` and `research/probes/stop-wait/`. Leave `runner-trigger.md` and `commit-checkpoint.md` to their siblings. Copy any store before reading it. Done when `research/stop-wait.md` is committed, answers questions 1 to 5, tags every finding, and no daemon or directory of yours is left.
