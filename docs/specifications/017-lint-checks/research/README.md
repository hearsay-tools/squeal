# Research for spec 017

The human (2026-10-26) chose ESLint as Squeal's first check that is not a test. Read `docs/vision.md` first, with its decision filter, and these findings of spec 016: `diagnostic-identity.md` (one check per file per tool), `binding-cost.md` (cost and containment per binding), `check-protocol-judgment.md`, `plugin-mechanisms.md` and `seams.md`. The coordinator's starting points are in `../status.md`. The human weighs every feature by the CPU it adds per edit.

## Rules for every brief

- Use /researcher. Read-only on the product. Own only your findings file and `probes/<topic>/`. Edit no board, spec, status, test or product file.
- Never add a package to your worktree's `package.json` or lockfile. A tool you try goes into a scratch directory under `/tmp`.
- The live host is evidence, read-only. Never connect to a live daemon's socket or open a live store. An experiment that needs a daemon runs your own in a scratch repository under `/tmp` with `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and `TMPDIR` set there; stop it before you finish and show that nothing of it is left.
- Run no agent session and no script under `evals/bin/`. Install no harness.
- No timings and no test suite: the host is loaded. A probe is small and states what it shows.
- Tag every finding: `verified by experiment`, `read in source code`, `read in official docs` or `inferred`. Name the version or the date of what you read. For a web source, give the URL.
- Length: 2 to 4 pages. Structure: Questions answered, Findings, Recommendation for Squeal, Open questions, Sources. Do not design Squeal; answer and recommend.
- Budget about two hours; then write what you have. Done when every numbered question has a tagged answer, the recommendation names its numbers and the limits are stated; commit.

## Briefs

- [eslint-provider-brief](eslint-provider-brief.md) (017-01): how to find, load, key and run a project's own ESLint warm, and stay right across config and dependency changes. Findings go to `eslint-provider.md`.
- [lint-seams-brief](lint-seams-brief.md) (017-02): where a per-file lint check enters Squeal's core, with spec 015's code checks as the nearest existing check that is not a test. Findings go to `lint-seams.md`.
