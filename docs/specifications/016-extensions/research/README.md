# Research for spec 016

The human's idea (2026-10-24): reorganize Squeal as a core plus extensions. Harness adapters satisfy a clear contract; test runners (pytest, node:test, Vitest) and code checks (complexity, CRAP) become plugins, so that other people can add the languages, frameworks, linters and quality metrics Squeal cannot cover alone. The coordinator's assumptions and the open questions are in `../status.md`.

Read `docs/vision.md` first, with its decision filter. Three of its lines frame this spec: "adapters around proven tools over rebuilding their internals", "a small stable protocol over deep coupling to one harness", and "Adapter ecosystem" under Core product capabilities. Since 2026-10-23 the human also weighs every feature by the CPU it adds per edit.

## Rules for every brief

- Use /researcher. Read-only on the product. Own only your findings file and `probes/<topic>/`. Edit no board, spec, status, test or product file.
- Never add a package to your worktree's `package.json` or lockfile. A tool you try goes into a scratch directory under `/tmp`.
- The live host is evidence, read-only. Never connect to a live daemon's socket or open a live store. An experiment that needs a daemon runs your own in a scratch repository under `/tmp` with `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and `TMPDIR` set there; stop it before you finish and show that nothing of it is left.
- Run no agent session (Claude Code, Codex or any other harness) and no script under `evals/bin/`. Install no harness.
- No timings and no test suite: the host is loaded. A probe is small and states what it shows.
- Tag every finding: `verified by experiment`, `read in source code`, `read in official docs` or `inferred`. Name the version or the date of what you read. For a web source, give the URL.
- Length: 2 to 4 pages. Structure: Questions answered, Findings, Recommendation for Squeal, Open questions, Sources. Do not design Squeal; answer and recommend.
- Budget about two hours; then write what you have. Done when every numbered question has a tagged answer, the recommendation names its numbers and the limits are stated; commit.

## Briefs

- [seams-brief](seams-brief.md) (016-01): Squeal's runner, check and harness contracts as they are at HEAD, every place the core names a runner or a harness, and what would have to move for an extension to live outside this repository. Findings go to `seams.md`.
- [plugin-mechanisms-brief](plugin-mechanisms-brief.md) (016-02): how developer tools load, version, distribute and isolate plugins (pytest, ESLint, Vite, Jest, Vitest, Nx, pre-commit, trunk, MegaLinter, VS Code), and which tiers they offer. Findings go to `plugin-mechanisms.md`.
- [check-protocol-brief](check-protocol-brief.md) (016-03): existing wire formats and protocols for tests and diagnostics (BSP, LSP, TAP, JUnit XML, SARIF, Microsoft.Testing.Platform, `go test -json`, libtest JSON) against what Squeal's runner contract needs. Findings go to `check-protocol.md`.
- [harness-landscape-brief](harness-landscape-brief.md) (016-04): the extension points of the harnesses Squeal does not support yet, MCP as a fallback, and the smallest adapter for each class of harness. Findings go to `harness-landscape.md`.
- 016-07, a fan-out of 016-03 the human authorized on 2026-10-24 (the central question): the same `check-protocol-brief.md` on GPT-6-Astra, written apart from 016-03. Findings go to `check-protocol-astra.md`, probes to `probes/check-protocol-astra/`.
- [check-protocol-judgment-brief](check-protocol-judgment-brief.md) (016-08): a `/judge` over `check-protocol.md` and `check-protocol-astra.md`, after both land. Judgment goes to `check-protocol-judgment.md`.
- [ecosystem-adoption-brief](ecosystem-adoption-brief.md) (016-05): whether extensibility drove adoption for comparable tools, what a public API cost their maintainers, how ecosystems keep plugin quality, licensing, and adapters written by agents against a test kit. Findings go to `ecosystem-adoption.md`.
- [third-party-trust-brief](third-party-trust-brief.md) (016-06): how build and cache systems keep results correct with third-party rules (declared inputs, versions in keys, sandboxes, detection of under-declared inputs), and the security of running third-party code. Findings go to `third-party-trust.md`.
- [defect-causes-brief](defect-causes-brief.md) (016-09): the human's "measure first" (2026-10-24): past review blockers, defect rows and issues sorted by cause (seam, kit-catchable, runner knowledge, harness quirk, core logic, load, process), so the internal half's worth is a count. Findings go to `defect-causes.md`.
- [runner-kit-brief](runner-kit-brief.md) (016-10): whether one set of correctness scenarios can be written once and run against all three runners, what it reuses, and which past defects it would have caught. Findings go to `runner-kit.md`.
- [core-defects-brief](core-defects-brief.md) (016-11): the human's go (2026-10-24): the 415 core-logic defects of 016-09 sorted by area and repeating mechanism, what would have caught each group of three or more, and its cost. Findings go to `core-defects.md`; they feed 011's coordinator as well.
- [model-scheduler-brief](model-scheduler-brief.md) (016-18): the human's go (2026-10-25): a model-based test of the scheduler, replayed against five past race and order blockers at their pre-fix commits, with 011's three invariants from row 011-184. Findings go to `model-scheduler.md`, then to 011's coordinator.
