# Research for spec 015

The human's idea (2026-10-23): Squeal calculates coverage and cyclomatic complexity, shares them between worktrees, and gives the CRAP score. Opt-in; it could feed the agent on the fly and be available on demand. The coordinator's assumptions and the open questions are in `../status.md`.

Read `docs/vision.md` first, with its decision filter. Two of its lines frame this spec: Squeal uses coverage data before it invents anything (principle 4), and it never becomes "a dashboard that reports every green run". Since 2026-10-23 the human also weighs every feature by the CPU it adds per edit.

## Rules for every brief

- Use /researcher. Read-only on the product. Own only your findings file and `probes/<topic>/`. Edit no board, spec, status, test or product file.
- Never add a package to your worktree's `package.json` or lockfile. A coverage provider or a complexity tool you try goes into a scratch copy under `/tmp`, with the reports directory there too.
- The live host is evidence, read-only. Never connect to a live daemon's socket or open a live store. An experiment that needs a daemon runs your own: a scratch repository under `/tmp` with `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and `TMPDIR` set there. Stop it before you finish, and show that nothing of it is left.
- Run no agent session (Claude Code, Codex or any other harness) and no script under `evals/bin/`.
- No full suite. A timing runs on a sample of this repository's test files at `--maxWorkers=4`, off and on alternated, at least five pairs. Record the one-minute load beside every timing; this host is shared and loaded.
- Tag every finding: `verified by experiment`, `read in source code`, `read in official docs` or `inferred`. Name the version you looked at.
- Length: 1 to 3 pages. Structure: Questions answered, Findings, Recommendation for Squeal, Open questions, Sources. Do not design Squeal; answer and recommend.
- Budget about two hours; then write what you have. Done when every numbered question has a tagged answer, the recommendation names its numbers and the limits are stated; commit.

## Briefs

- [coverage-collection-brief](coverage-collection-brief.md) (015-01): per-test-file coverage from the runs Squeal already makes, its cost, its fidelity, and whether it can be keyed and shared like a result. Findings go to `coverage-collection.md`.
- [complexity-and-crap-brief](complexity-and-crap-brief.md) (015-02): per-function complexity for TypeScript, JavaScript and Python, its cost, and CRAP from it and a coverage map. Findings go to `complexity-and-crap.md`.
- [agent-feedback-brief](agent-feedback-brief.md) (015-03): what peers show developers, what is known about coverage and complexity feedback to coding agents, and which of it is a transition. Findings go to `agent-feedback.md`.
- [typeof-import-brief](typeof-import-brief.md) (015-25): the `typeof import` misparse in a type argument, an upstream fix or an offset-keeping rewrite, measured against ESLint. Findings go to `typeof-import.md`.
- [progress-updates-brief](progress-updates-brief.md) (015-26): the human's idea of a subscription to updates on a failing function. Findings go to `progress-updates.md`.
