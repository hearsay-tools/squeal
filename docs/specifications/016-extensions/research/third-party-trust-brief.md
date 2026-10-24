# Research brief 016-06: trusting third-party checks

Use /researcher. Shape: research. Outcome: how build and cache systems keep results correct when third parties write the rules, and what Squeal must require of an extension so that its keys, its shared store and its "no known failures" stay trustworthy. Follow the rules in `README.md`.

Read first: `docs/vision.md` principles 2 and 8; 011 C3 (keys and closures), C4 (validity), C7 (shared store), C10 (policy, the **Fidelity** paragraph), C12 (the runtime-input recorder); `docs/decisions/0002-content-keyed-shared-store.md`.

Systems: Bazel and Buck2 (hermetic actions, sandboxes), Gradle (task input annotations, build cache validation), Nx (inputs, plugin-inferred targets), Turborepo (inputs, environment), Pants, pytest-testmon, Jest and Vitest caches. Add others you find; say why.

Questions:

1. **Declaration.** How each lets a third-party rule declare its inputs, outputs and environment, and how the rule's own version and configuration enter the cache key.
2. **Under-declaration.** What each does when a rule reads an input it did not declare: sandboxing, read tracing, validation warnings, a false cache hit. Known incidents of wrong cached results caused by plugins.
3. **Squeal's net.** Can C12's recorder, or a tracer like it, cover a check provider in any language (a Go binary, a Python process), on Linux and macOS? Its limits.
4. **Fault.** When an extension gives a wrong result, how a system attributes it: the result names its provider and version, a store can drop one provider's results.
5. **Execution.** Security of running third-party extension code beside an agent: permissions, sandboxes and allow lists in comparable tools (VS Code workspace trust, Deno permissions, pre-commit). What principle 8 asks of Squeal here.

Own `third-party-trust.md` and `probes/third-party-trust/`.
