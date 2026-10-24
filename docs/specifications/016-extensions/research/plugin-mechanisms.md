# 016-02: plugin mechanisms of developer tools

Researcher findings for brief `plugin-mechanisms-brief.md`, 2026-10-24. Sources were read at the release tags in Sources. Probes are in `probes/plugin-mechanisms/`, with their output. Squeal's code was read at `0822a4440`. Wire formats are left to 016-03, adoption to 016-05 and cache correctness to 016-06.

## Questions answered

| # | Question | Answer in one line |
| --- | --- | --- |
| 1 | Mechanism | Hosts that run code (pytest, ESLint, Vite/Rollup, Jest, Vitest, Nx, VS Code) load JavaScript or Python modules that implement named hooks. Hosts that run any language (pre-commit, trunk, MegaLinter, reviewdog) read a manifest. The manifest names a command and how to read its output. |
| 2 | Contract version | No tool negotiates an API version at run time. They use a host-version range (peerDependencies, `engines.vscode`, `required_trunk_version`, `minimum_pre_commit_version`), signature checks at load (pluggy), capability flags (Jest, VS Code), and renamed members (Nx `createNodesV2`). |
| 3 | Discovery and distribution | Code plugins are npm or PyPI packages that config imports or an entry point names. Manifest plugins are git repositories pinned by `rev`/`ref`, or a URL. Only pytest auto-loads what is installed. |
| 4 | Tiers | trunk and MegaLinter have both tiers. The no-code tier covers 57% of trunk's diagnostic commands and 56% of MegaLinter's linters. Its typical failure is a regex that misattributes results without an error. |
| 5 | Isolation | In-process hosts attribute an exception but cannot stop a plugin that blocks the event loop. Nx and the manifest tools run each plugin as a process and apply a timeout. |
| 6 | Fit | A runner and a type checker use a process protocol, with an optional in-process path. A per-file linter and a metric use a manifest. A harness adapter stays a small process protocol (016-04). Details are in the Recommendation. |

## Findings

### 1. Mechanism

| Tool, version | Where the plugin runs | Form | Extension points |
| --- | --- | --- | --- |
| pytest 9.1.1 / pluggy 1.7.0 | in-process | Python module with `pytest_*` hook functions | 52 hook functions in `hookspec.py`: collection, run protocol, reporting, config, options |
| ESLint 10.13.0 | in-process | JS object `{meta, rules, processors, configs, languages}` | rules (AST visitors), processors, languages, shareable configs, formatters |
| Vite 8.3.5 / Rollup 4.65.0 | in-process | JS object with `name` and hook functions | build hooks of kinds `first`, `sequential`, `parallel`, with `order`. Vite adds `config`, `configureServer`, `handleHotUpdate`, `enforce` and `apply` |
| Jest 30.5.2 | the runner class runs in the main process. The default runner sends files to `jest-worker` processes or threads | JS module path in config | `runner`, `testRunner`, `testEnvironment`, `reporters`, `transform`, `resolver`, `testSequencer`, `watchPlugins`, `dependencyExtractor`, `snapshotResolver` |
| Vitest 5.0.5 | in-process (a Vite plugin and reporters). Tests run in a pool | JS | `configureVitest` plugin hook, reporters (`onTestModuleQueued` … `onTestRunEnd`), custom pool, custom runner |
| Nx 24.0.1 | one child process per plugin by default | JS object | `createNodes`, `createDependencies`, `createMetadata`, `preTasksExecution`, `postTasksExecution` |
| pre-commit 4.7.0 | one process per hook | `.pre-commit-hooks.yaml` manifest | `entry`, `language` (21 kinds, from `unsupported` (the former `system`) to `docker`), `files`/`types`, `pass_filenames`, `require_serial` |
| trunk plugins v1.11.0 | one process per linter command | `plugin.yaml` | `run`, `output` (format), `parse_regex`, `parser` script, `success_codes`/`error_codes`, `batch`, `cache_results`, `run_timeout`, `version_command` |
| MegaLinter 10.1.0 | one process per linter, in a container | descriptor YAML plus an optional Python `class` | `cli_lint_mode` (`file`, `list_of_files`, `project`), `cli_lint_errors_count` (regex modes, `total_lines`, `sarif`), install steps |
| reviewdog 0.21.2 | does not load plugins. It reads other tools' output | flags or `.reviewdog.yml` `runner: {cmd, errorformat|format}` | Vim `errorformat`, a catalogue of predefined formats, `rdjson`/`rdjsonl`, `sarif`, `checkstyle`, `diff` |
| VS Code 1.140 | an extension host (Node, or a Web Worker in the browser) | `package.json` manifest plus JS | Test Controller (`resolveHandler`, run profiles, `supportsContinuousRun`, `invalidateTestResults`). Tasks have no-code problem matchers, including `background.beginsPattern`/`endsPattern` for watch processes |
| neotest (added) | in-process Lua. The core runs the command the adapter builds | Lua module | `root`, `filter_dir`, `is_test_file`, `discover_positions`, `build_spec`, `results` |

Tags: read in official docs and read in source code at the versions shown. neotest was added because it is the closest analogue to a many-language test-runner adapter: six functions, 42 adapters named in its README (commit `27bf921`, 2026-08-16). The adapter builds the command and parses results. The core owns the process.

Squeal today (read in source code, `0822a4440`): runner adapters are TypeScript modules inside the daemon (`src/core/types/runner.ts`). Vitest is imported in-process through `vitest/node` (`src/runners/vitest/load.ts`). pytest runs as a child process that loads Squeal's own pytest plugin (`src/runners/pytest/runtime/squeal_pytest.py`), which sends events back. node:test runs as a child process group (`src/runners/node-test/run/process.ts`). So Squeal already uses both shapes: an in-process adapter, and a process with a plugin inside the tool.

### 2. Contract version

- **pluggy** checks signatures when it registers a plugin, not versions. An implementation may take a subset of the spec's arguments, so a spec can add arguments without breaking old plugins. An implementation that names an argument the spec lacks raises `PluginValidationError` that names the plugin and the hook. An undeclared hook fails at `check_pending()`. Since 1.7 a spec argument can have a default, so old callers keep working (verified by experiment, p2; docs `index.rst` "Hookspec argument defaults"). pytest adds `required_plugins = ["pytest-django>=3.0.0,<4.0.0"]`. A plugin that is missing or out of range stops the run with `UsageError: Missing required plugins` (read in source code, `config/__init__.py` `_validate_plugins`).
- **ESLint**: plugins declare `eslint` as a peer dependency, a convention npm enforces at install (read in official docs, `extend/plugins.md`). `meta.name` and `meta.version` enter the serialized config as `namespace:name@version`. A plugin without `meta` enters as its namespace only, so its version does not reach the config used for caching (verified by experiment, p3: `["@","x:eslint-plugin-x@1.0.0","y"]`). Rule `meta.schema` validates options before the rule runs.
- **Rollup/Vite**: no version negotiation. `version` is "for inter-plugin communication". Vite 8 kept the hook contract while it replaced Rollup with Rolldown, and documents which Rollup plugins still work (read in official docs).
- **Jest** has capability flags on the runner class (`supportsEventEmitters`, `isSerial`) and no version field (read in source code, `jest-runner/src/types.ts`). **Vitest** marks the pool API "advanced, experimental and very low-level" and marks API members with a version badge (read in official docs).
- **Nx** versions by renaming members. `createNodes` became `createNodesV2`, and `createNodes` is now the preferred name again, with `createNodesV2` deprecated (read in source code, `public-api.ts`).
- **pre-commit** checks `minimum_pre_commit_version` on each manifest hook first, "in case it uses some newer, incompatible feature". It warns when `rev` "appears to be a mutable reference" (read in source code, `clientlib.py`). **trunk**: `plugin.yaml` carries `version: 0.1` (schema) and `required_trunk_version: ">=1.22.2-beta.5"`. Each linter has `known_good_version` and a `version_command` (read in source code). **VS Code**: `engines.vscode` is required and cannot be `*`. The Marketplace installs only a compatible version (read in official docs).

What a mismatch does: every tool fails at load or install with the plugin named. None of them disables only the plugin and continues. Silent degradation appears only where the version does not reach a cache key (ESLint without `meta`) or where a parser drifts from the tool's output (Q4).

### 3. Discovery and distribution

| Tool | Unit | How a project selects and pins |
| --- | --- | --- |
| pytest | PyPI package with a `pytest11` entry point | Auto-loaded when installed. Opt out with `-p no:name` or `PYTEST_DISABLE_PLUGIN_AUTOLOAD`. Pinned by the Python lockfile plus `required_plugins`. |
| ESLint, Vite, Jest, Vitest, Nx | npm package | Imported or named in the config file. Pinned by `package.json` and the lockfile. |
| pre-commit | git repository with `.pre-commit-hooks.yaml` | `repo` plus `rev` in `.pre-commit-config.yaml`. `autoupdate --freeze` writes a SHA. `repo: local` defines a hook inline. |
| trunk | git repository with `plugin.yaml` | `plugins.sources: [{uri, ref}]` in `.trunk/trunk.yaml`. Linter versions are pinned in the same file. |
| MegaLinter | URL of one descriptor YAML | `PLUGINS:` list of `https://…/mega-linter-plugin-*/…descriptor.yml` or `file://`. It is fetched with `requests.get` and has no pin unless the URL holds a ref. 9 external plugins are listed. |
| reviewdog | none (formats live in the `reviewdog/errorformat` repository) | `-f=<name>` or `.reviewdog.yml` |
| VS Code | VSIX in the Marketplace | Installed by the user. A publisher-trust prompt has existed since 1.97. |

Tags: read in official docs and read in source code. Only pytest loads what is merely installed. Every other tool loads what the project config names.

### 4. Tiers

- **trunk v1.11.0** (verified by experiment, p5, over all 116 `linters/*/plugin.yaml`): 129 definitions, 198 commands. 68 are formatters (`rewrite`). Of the 130 diagnostic commands, 74 (57%) use a format with no code (`sarif` 33, `pass_fail` 20, `regex` 19, `sarif_uri` 2). 29 use a parser built into trunk's CLI and 27 a script parser (Python or Node). 79 of 129 linters (61%, formatters included) need no code at all.
- **MegaLinter 10.1.0** (verified by experiment, p5, over its descriptors): 135 linters, 76 (56%) descriptor only and 59 with a Python class. 47 count errors with a regex, 5 by lines, 1 with SARIF. A failing regex only logs "Unable to get number of errors". The verdict falls back to the exit status (read in source code, `Linter.get_total_number_errors`).
- **reviewdog**: it accepts only formats with no code. It covers "any tool output" through errorformat, and the more structured path is a converter to `rdjson` (read in official docs).
- **VS Code**: problem matchers (no code, regex) for tasks, beside the Test Controller (code). For tests there is no tier without code. The share is not determined: no catalogue exists to count.
- **pre-commit**: every hook is a command judged by its exit code and by "files modified". No output is parsed (read in source code, `commands/run.py`).
- pytest, ESLint, Vite, Jest, Vitest and Nx: code only. ESLint's shareable configs need no code but add no checks.

The no-code tier fails quietly. trunk's biome definition says the earlier regex "lazily matched across diagnostics and silently mis-attributed path/line/col to a different finding's message" (read in source code, `linters/biome/plugin.yaml`). MegaLinter avoids a false pass because the exit code decides and the regex only counts. Formats with no code cover lint diagnostics. None of these tools offers per-test results, affected selection or a warm process without code.

### 5. Isolation

| Host | Exception | Never settles | Blocks or crashes | Attribution |
| --- | --- | --- | --- | --- |
| pluggy | goes up to the caller unwrapped | no guard | the process dies | none: `RuntimeError: plugin bug` without the plugin's name (p2) |
| ESLint | lint of that file fails | no guard | process | `Rule: "x/boom"`, file and line. Other files still lint (p3) |
| Rollup | `PLUGIN_ERROR` | `Unfinished hook action(s)`, only when the event loop empties | process | `plugin` and `hook` fields (p4) |
| Jest | not read | `workerGracefulExitTimeout`, then force kill, at worker exit | worker processes or threads, `workerIdleMemoryLimit` | not read |
| Nx | per plugin | 10 minutes per message (`NX_PLUGIN_NO_TIMEOUTS` lifts it) | child process. Exit is reported as `Plugin worker "<name>" exited unexpectedly`, then respawned | per plugin. Falls back to in-process when a sandbox refuses sockets |
| pre-commit | exit code | none: no timeout in `pre_commit/` | process | hook id |
| trunk | exit code outside `success_codes` | `run_timeout` (8 definitions set it) | process | linter name |
| MegaLinter | exit status | `LINTER_TIMEOUT_SECONDS`, default 300 s in code (a constructor comment still says "None = no timeout (default)") | process | linter name |
| VS Code | not determined | not determined | an extension host (local, web or remote) with "the same permissions as VS Code" | not determined |

Tags: p2 to p4 verified by experiment. The other rows were read in source code or docs.

Node containment (verified by experiment, p1, Node 24.21.0): in the host's thread, a throw is caught and a never-settling promise loses a `Promise.race` timeout, but its work goes on. A synchronous loop blocks the event loop: neither the 500 ms guard nor a 200 ms heartbeat fired, and only an outer `timeout 3` ended the process. A plugin that replaced `Array.prototype.includes` changed the host's own results (`[1].includes(2) = true`). That is a false answer without any error. A worker thread and a child process contained all four: `terminate()` and `SIGKILL` ended the loop, and the host's built-ins were unchanged.

### 6. Fit

Inferred from 1 to 5, Squeal's C14 contract and its process code:

| Squeal extension | Needs | Mechanism that fits |
| --- | --- | --- |
| Test runner with affected selection, warm process, focus | per-test results, closure, environment, `run` with options, cancellation | A process speaking a protocol, written in the runner's language, like Squeal's pytest plugin today. An in-process JS module only for Node runners whose Node API Squeal imports (Vitest) |
| Per-file linter | file list in, diagnostics out | Manifest: command, file selection, `pass_filenames`-style batching, and a SARIF or JSON format (016-03), with exit code as the authority. Regex as a last resort |
| Project-wide type checker | whole-project run, or a watch process | Manifest with a project mode (MegaLinter `project`). A watch mode needs begin and end markers, like VS Code `background` matchers. A process protocol is needed for incremental results |
| Code metric (complexity, CRAP) | per-function numbers, often from Squeal's own data | Manifest emitting SARIF-like results with a numeric property. In-process only for first-party metrics |
| Harness adapter | three operations (principle 6) | Already a process boundary in every harness (hooks, plugins). See 016-04 |

## Recommendation for Squeal

1. **Two tiers, not three.** Offer a manifest tier (command, inputs, output format, exit-code authority) and a protocol tier (a process with a versioned message contract). A "declarative manifest" tier separate from "no code" is not found in any tool studied: trunk and MegaLinter use one manifest that optionally names a parser (Q4).
2. **Put third-party code out of the daemon's thread.** p1 shows that a JS module loaded into Squeal's thread can block every timer, or change a built-in and give a false pass with no error. Nx runs each plugin in its own process by default, with a timeout and a crash report by name (Q5). Load first-party adapters in-process. Run third-party code in a worker thread at least, and in a child process when it is not JS.
3. **In the manifest tier, the exit code decides the state and the parser only describes it.** Do as MegaLinter does, so a drifting regex cannot turn a failure into a pass (Q4).
4. **Version the contract by host range plus validation at load.** Use a `squeal` version range in the manifest (like `required_trunk_version`), capability flags for optional members (like C14's optional `focuses`, `recheck`), and fail at load with the extension named. Put the extension's name and version into every key it produces. ESLint shows what happens otherwise (Q2, p3; the key detail is 016-06's).
5. **Select by project config and pin by version or SHA.** Do not auto-load what is installed (Q3). npm packages for JS extensions and git `rev` for any language both have precedent.
6. **Move Squeal's own runners behind the protocol tier first.** The pytest runner already has that shape (a plugin inside pytest, events over a pipe). It is the cheapest candidate to prove the protocol.

Limits: no adoption data (016-05), no cache-correctness analysis (016-06), no wire format chosen (016-03). Shares in Q4 count definitions, not usage.

## Open questions

- How much of a runner's closure and `environment()` (C14) a process can report without Squeal's Node-side key code. 016-01 and 016-06 decide this.
- Whether a worker thread is enough isolation for third-party JS, or a child process per extension is needed for CPU and memory limits. This is not determined, because the host is loaded and the brief forbids timings.
- VS Code's behaviour when an extension's handler never settles: not determined. The fetched docs do not state it.
- trunk's default `run_timeout` is not determined: it lives in trunk's closed-source CLI, not in the plugins repository.

## Sources

Fetched 2026-10-24 into `/tmp/pm16/src` (deleted after the run), sparse clones at:

- pluggy 1.7.0, https://github.com/pytest-dev/pluggy (`src/pluggy/_manager.py`, `docs/index.rst`)
- pytest 9.1.1, https://github.com/pytest-dev/pytest (`doc/en/how-to/writing_plugins.rst`, `plugins.rst`, `reference/reference.rst`, `src/_pytest/config/__init__.py`)
- ESLint v10.13.0, https://github.com/eslint/eslint (`docs/src/extend/plugins.md`, `custom-rules.md`, `languages.md`, `lib/config/config.js`, `lib/linter/linter.js`)
- Vite v8.3.5 `docs/guide/api-plugin.md`. Rollup v4.65.0 `docs/plugin-development/index.md`, `src/utils/PluginDriver.ts`
- Jest v30.5.2, https://github.com/jestjs/jest (`docs/Configuration.md`, `docs/CodeTransformation.md`, `packages/jest-runner/src/types.ts`)
- Vitest v5.0.5, https://github.com/vitest-dev/vitest (`docs/guide/advanced/pool.md`, `docs/api/advanced/plugin.md`, `reporters.md`)
- Nx 24.0.1, https://github.com/nrwl/nx (`packages/nx/src/project-graph/plugins/public-api.ts`, `isolation/enabled.ts`, `isolation/isolated-plugin.ts`)
- pre-commit v4.7.0, https://github.com/pre-commit/pre-commit (`pre_commit/clientlib.py`, `commands/run.py`, `languages/`)
- trunk-io/plugins v1.11.0, https://github.com/trunk-io/plugins (`plugin.yaml`, `README.md`, `linters/*/plugin.yaml`)
- MegaLinter v10.1.0, https://github.com/oxsecurity/megalinter (`docs/plugins.md`, `megalinter/plugin_factory.py`, `megalinter/Linter.py`, `megalinter/descriptors/`)
- reviewdog v0.21.2, https://github.com/reviewdog/reviewdog (`README.md`, `parser/`)
- VS Code docs at `a030905` (2026-10-22), https://github.com/microsoft/vscode-docs (`api/extension-guides/testing.md`, `api/references/extension-manifest.md`, `api/working-with-extensions/publishing-extension.md`, `api/advanced-topics/extension-host.md`, `docs/debugtest/tasks.md`, `docs/configure/extensions/extension-runtime-security.md`). `@types/vscode` 1.140.0 `index.d.ts`
- neotest `27bf921`, https://github.com/nvim-neotest/neotest (`lua/neotest/adapters/interface.lua`, `README.md`)
- Probes: `probes/plugin-mechanisms/` (p1 Node 24.21.0, p2 pluggy 1.7.0, p3 ESLint 10.13.0, p4 Rollup 4.65.0)
