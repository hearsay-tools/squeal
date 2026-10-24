# Research brief 016-02: plugin mechanisms of developer tools

Use /researcher. Shape: research. Outcome: how comparable developer tools let third parties extend them, by which mechanisms and tiers, and which of those fit Squeal. Follow the rules in `README.md`. Leave wire formats for tests and diagnostics to 016-03, adoption evidence to 016-05 and cache correctness to 016-06.

Read first: `docs/vision.md` principles 4, 5, 6 and 8; 011 C14.

Tools: pytest (pluggy, entry points), ESLint (flat config plugins), Vite and Rollup (hooks), Jest (custom runners, reporters, environments), Vitest (custom pools, reporters), Nx (plugins that infer tasks), pre-commit (hooks from a repository and a manifest, any language), trunk (linter definitions in YAML with output parsers), MegaLinter, reviewdog, VS Code extensions (Test Controller API). Add others you find relevant; say why.

Questions:

1. **Mechanism.** For each tool: in-process or another process; code, a declarative manifest, or both; the extension points it offers.
2. **Contract version.** How the plugin API is versioned apart from the product (API versions, peer dependencies, capability negotiation), and what a mismatch does.
3. **Discovery and distribution.** npm or PyPI packages, entry points, git repositories, a registry, a config file; how a project selects and pins plugins.
4. **Tiers.** Which tools offer a no-code tier (a command plus an output format, a regex problem matcher) beside a code tier, and how much of their catalogue the no-code tier covers.
5. **Isolation.** How a broken or slow plugin is contained: timeouts, crashes, errors reported against the plugin.
6. **Fit.** Which mechanism suits each kind of Squeal extension (a test runner with affected selection, a per-file linter, a project-wide type checker, a code metric, a harness adapter), given Squeal's daemon is Node.

Own `plugin-mechanisms.md` and `probes/plugin-mechanisms/`.
