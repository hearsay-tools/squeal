# Research brief for spec 019: run triggers

Read `docs/vision.md`, `docs/styleguide.md`, `docs/process.md` and `../status.md` first. Then spec 004 (`specifications/004-slow-suites/spec.md`) D1, D2, D7, D8 and D9, spec 011 (`specifications/011-core/spec.md`) for the scheduler, the policy and checkpoints, and `src/core/daemon/policy.ts` with its defaults.

The human, 2026-11-02, three items:

1. "each runner can be configured to run: after each edit, stop only (including slow tests)"
2. "potentially add a configurable (?) checkpoint at commit"
3. "extending the timeout on Stop so that it could require all slow tests to be ran (unless that's already handled)"

What exists today, as a starting point to verify, not to trust: every covered test file runs after each edit that reaches its closure; files that match `slow.include` (or a `nodeTest` entry with `slow: true`) form the slow tier, which runs in its own lane after the fast tests (`slow.trigger: "continuous"`, the default) or when the agent pauses (`"idle"`); `stop.requireSlowSuite` makes Stop wait up to `stop.slowWaitMs` (capped at 600000 by the 630 s hook timeout) and then hold the agent once; `stop.requireFullSuite` and `squeal run --all` give a full-suite checkpoint. `slow.trigger` is one key for the repository, not one per runner.

The three topics run in parallel. Each owns one part, and the others stay out of it:

- `runner-trigger`: the configuration and the meaning of a per-runner (or per-glob) run moment: after each edit, or at Stop only. What is scheduled when, how keys, status, notices and the primer describe a check that waits for Stop.
- `commit-checkpoint`: how Squeal could learn of a commit, what a checkpoint at a commit would run and against which tree, and whether it blocks the commit or only reports.
- `stop-wait`: what Stop does today in each harness, its bounds and where they come from, and what "require every slow test" would need. `runner-trigger` cites this topic for the wait at Stop; it does not measure it.

Each topic is one researcher task. Write your findings to `research/<topic>.md` in this folder. Commit when done.

## Rules for findings documents

- Length: 1 to 4 pages. Structure: Questions answered (a table), Findings per question, Recommendation, Open questions for the human, Sources.
- Mark every finding `verified by experiment`, `read in official docs`, `read in source code` or `inferred`. Name the commit you read source at, and the version and retrieval date of external docs.
- Start from what exists. If an item is already handled, or handled by a combination of keys, say so first, with the configuration that does it and what it leaves out.
- Experiments on this host: in a fresh fixture repository under your own `$TMPDIR`, never in the main checkout or another worktree. Stop every daemon you start (`squeal stop` there) and remove the directory before you finish. No full test suite and no `squeal run --all` in this repository's worktrees. Skip any timing measurement when the one-minute load average is above the CPU count, and say so. Make no load on purpose.
- Never run an agent CLI (Claude, Codex, Pi, OpenCode) against the real HOME. A real-harness probe runs only as the throwaway user `squeal-e2e` (`sudo -n -u squeal-e2e -H env -i HOME=/home/squeal-e2e PATH=... cmd`, cwd `/`, the fixture sent in with `git archive | sudo -u squeal-e2e tar -x`), on the cheapest model that answers the question, at most five sessions per topic. Never run an `evals/bin/*.mjs` script.
- Throwaway scripts live under `research/probes/<topic>/` with a README that says they are throwaway.
- Do not design the feature. Answer, measure, recommend; the coordinator writes the spec. Where the answer is "this does not fit Squeal", say so with the reason.
- Touch nothing outside `docs/specifications/019-run-triggers/research/`.

## Topic: runner-trigger

Can a project choose, per runner, whether its tests run after each edit or only at Stop (slow tests included), and what would that mean?

1. What exists. From source and spec 004: can today's keys already give "Vitest after each edit, pytest at Stop only" (for example a runner's whole glob in `slow.include` with `slow.trigger: "idle"` and `stop.requireSlowSuite`)? What does that combination do differently from what the human asks: one trigger for all slow files, the slow tier's load guard and lane width, its status and primer wording, its notices. Check it in a fixture repository with two runners.
2. The unit. Is the choice per runner (`vitest`, `nodeTest`, `pytest`, the lint checks of spec 017), per runner project (a Vitest project, a `nodeTest` or `pytest` entry), or per glob? Which unit fits the cases a user has: a slow e2e project, an expensive runner, a runner whose tests touch shared state. Read the config shapes of each runner in `src/core/daemon/` and the runners.
3. Meaning of "stop only". Does the check run when the agent pauses (silent Stop, as `"idle"` does today), or does Stop wait for it? Does "including slow tests" mean the stop-only runner's slow files run at that Stop too? What happens to a stop-only check's result between Stops: pending, stale, shown as not run? How do held failures, the `Slow tier:` line, `squeal status`, the primer and the skill describe it so that an old result never poses as current (vision principle 2)?
4. Prior art, one paragraph each with what Squeal can reuse: Wallaby and Jest/Vitest watch modes (run on save vs on demand), `pytest-testmon`, IDE test runners (JetBrains auto-test, VS Code test explorer continuous run), Bazel test size classes, pre-commit and lefthook stages (`pre-commit`, `pre-push`, `manual`).
5. Cost. With this repository's and cezarion's runners as cases (read their `squeal.config.json`; do not run their suites), what would a per-runner trigger save in CPU after edits, and what would it cost in later failure notices? Use existing measurements in spec 004's research and `squeal ps`; measure only when the load allows.

## Topic: commit-checkpoint

Could Squeal run a checkpoint when a commit is made, configurably, and what would it run?

1. Detecting a commit. Options: a git hook Squeal installs (`pre-commit`, `post-commit`; `core.hooksPath` and its conflict with husky, lefthook and the pre-commit framework), the harness's tool hooks seeing `git commit` in a shell command (Claude Code `PreToolUse`/`PostToolUse`, Codex, OpenCode, Pi; read the adapters in `src/harness/`), or the watcher seeing `HEAD` or a ref move (spec 015 already tells a moved `HEAD` apart from an edit). Which is reliable for agent commits and human commits, which works in a worktree, which survives `--no-verify`, amend, rebase and cherry-pick? Verify the cheap ones in a fixture repository.
2. What the checkpoint runs, and on which tree. The daemon tests the working tree; a commit holds the index, which can differ (partial staging). Options: the working tree at the commit's revision, the committed tree (`git archive` or a scratch worktree), affected files only, affected plus slow, or the full suite. What is the cost of each here and in cezarion, and what does the key model (content keys, decision 0002) give for free: a committed tree equal to the working tree has its results already.
3. Block or report. A `pre-commit` hook can refuse the commit; a harness `PreToolUse` can deny a `git commit` tool call; `post-commit` and the watcher can only report. What do agents do when a commit is refused (retry with `--no-verify`, loops)? What does the human want from "checkpoint": a gate, or a record ("commit abc: 3 failing")? Note vision principle 8 for anything outside the worktree, and how today's `testCommand.denyWhenCurrent` and `stop.blockOnKnownFailures` already deny or block.
4. Configuration. What a user would set: off, report, block; which tiers. Name the existing keys it overlaps (`stop.requireFullSuite`, `stop.blockOnKnownFailures`, `squeal run --all`) and whether one of them already gives most of it.
5. Prior art, one paragraph each: the pre-commit framework, lefthook, husky with lint-staged, `git-test` (mhagger), `git rebase --exec`, Nx and Turborepo affected checks in hooks, Wallaby. What each runs, against which tree, and how it handles a slow hook.

## Topic: stop-wait

Does Stop already let a project require every slow test to have run, and if not, what would it take?

1. What exists, exactly. From source (`src/harness/` Stop entries, `stop-slow`, the hooks files of every plugin under `plugins/`) and spec 004 D9: what each harness (Claude Code, Codex, OpenCode, Pi) does at Stop under `stop.requireSlowSuite` and `stop.requireFullSuite`, with `stop.waitMs` and `stop.slowWaitMs`. What happens at the bound (one hold, then `stop_hook_active` lets the next Stop through)? So: can a slow file still be not current when the agent finishes, and in which cases (bound reached, second Stop, SubagentStop, a harness without a waiting entry, a session that changed nothing)?
2. The bounds. Where the 600000 ms cap and the 630 s hook timeout come from. From official docs and the harness source where available: the largest hook timeout each harness accepts (Claude Code `timeout`, Codex hooks, OpenCode and Pi in-process plugins), what happens past it, and whether a Stop can block more than once without the harness ending a loop. Verify Claude Code's limit with at most a few `squeal-e2e` sessions if docs do not settle it.
3. How long the slow tier takes. From spec 004's research (`slow-claims.md` in spec 001, `slow-tier-*.md` in 004) and the store's run history (copy the database to `$TMPDIR`; never open a live store for writing): the slow tier's duration here and in cezarion, median and p90, and how often it would exceed 600 s.
4. Options to "require all": a higher cap where the harness allows it; repeated holds until every slow file is current (with a loop guard); a hold that tells the agent to run `squeal run --slow --wait` with no deadline; Stop that runs the slow tier before it waits. For each: what the agent sees, how the turn and the human are affected, and failure modes (a hung slow file, a daemon down, load deferral by `slow.maxDeferMs`).
5. Recommendation: whether the item is already handled well enough, and the smallest change if not.
