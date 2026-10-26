# Research brief 017-01: running a project's own ESLint as a live check

Use /researcher. Shape: research. Outcome: what Squeal must know to find, load, key and run a project's own ESLint warm after each edit, and to stay right when its config or dependencies change. Follow the rules in `README.md`.

Read first: `../status.md`; spec 016 `research/diagnostic-identity.md` (Q4 inputs) and `research/binding-cost.md` (the worker binding); `research/plugin-mechanisms.md` on ESLint; 011 C3 (keys).

Questions:

1. **Discovery.** How a tool finds and loads the ESLint a project installed: resolution from the project root, ESLint 8 (eslintrc) against 9 and 10 (flat config), monorepos with several configs. How `vscode-eslint` and `eslint_d` do it. The share of each major version in npm downloads, with the date.
2. **Inputs.** What decides one file's findings: the config file and all it imports, plugins, parsers and shareable configs with their versions, ignore patterns, `languageOptions`. Typed rules (`parserOptions.project`, `projectService`): how to detect them from the computed config, and which files then enter. Is `calculateConfigForFile` output plus the package versions a sound key? Show it in `/tmp` with ESLint 9 and 10, a flat config, one plugin, one shareable config and one typed rule.
3. **Warm runs.** ESLint's Node API in a worker thread over 200 edits: do the results equal a fresh CLI run each time; which changes need a new `ESLint` instance; RSS at the start and the end (no timings).
4. **Survey.** In 20 popular JS or TS repositories on GitHub, read only: flat or eslintrc, typed rules or not, how many config files, ESLint's cache on or off. Name each repository and commit.
5. **Prior art.** What `vscode-eslint`'s server, `eslint_d`, ESLint's own `--cache` and `lint-staged` reload or invalidate, and when.

Own `eslint-provider.md` and `probes/eslint-provider/`.
