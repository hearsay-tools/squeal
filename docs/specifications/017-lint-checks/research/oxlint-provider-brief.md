# Research brief 017-12: a project's own oxlint as a live check

Use /researcher. Shape: research. Outcome: what Squeal must know to find, run and key a project's own oxlint after each edit, so that each oxlint result is a second tool beside ESLint in the lint check that is already built (spec 017). Follow the rules in `README.md`. One change to those rules: Q3 may measure CPU time, in small runs, stated with the host's one-minute load. Make no load on purpose.

Read first: `../spec.md` D2 to D5 and D9; `../status.md` (2026-11-01); `eslint-provider.md` (its Q2, Q3 and survey); 016 `research/binding-cost.md` (the child-process binding) and `research/diagnostic-identity.md`. In code, read only: `src/core/lint/provider/protocol.ts`, `src/core/lint/pass/provider.ts`, `src/core/types/lint.ts`.

Questions:

1. **Discovery.** How a project installs oxlint (the npm `oxlint` package and its platform binaries, a global binary, `npx`), and how to find the project's own binary from its root. Supported config files (`.oxlintrc.json`, any JS or TS config), nested configs, `extends`. Versions in use, with npm downloads and the date. What to say when oxlint is absent or too old.
2. **Inputs and key.** What decides one file's findings: the config files and their `extends` closure, nested configs, ignore files and `ignorePatterns`, the oxlint version, the environment, `--type-aware` (oxlint-tsgolint, tsconfig, the program), and `jsPlugins`. Squeal cannot observe a native process's reads. Can a key built from declared inputs give results that equal a fresh CLI run? Show it in `/tmp` with a replay of at least 100 edits that change each input, with and without type-aware rules and JS plugins. Name each input the key misses.
3. **Running.** Run a fresh `oxlint --format json <files>` per pass, and compare it with `oxc_language_server` or another long-lived mode. Measure the CPU per one-file edit and per 16-file part, the time to first result, RSS, and the behavior when oxlint hangs or crashes.
4. **Output.** Map oxlint's JSON (or another stable format) to `LintFinding`: rule id with its plugin prefix, message, severity, line, column, the file path. How it reports a parse error and a config that does not load. Whether its output changes between minor versions.
5. **Dogfood and prior art.** Name a repository that uses oxlint where Squeal could be dogfooded: Vite, Vitest, NestJS and Storybook from `eslint-provider.md`'s survey, and cezar, if it adopted oxlint. For each, list its config, type-aware use and JS plugins, read only. Describe how editors and `lint-staged` setups run oxlint, and what they cache.

Recommend: which of D3 (the worker), D4 (reload) and D5 (keys) oxlint can reuse and what it needs in their place, and which inputs make a file `unknown` rather than keyed.

Own `oxlint-provider.md` and `probes/oxlint-provider/`.
