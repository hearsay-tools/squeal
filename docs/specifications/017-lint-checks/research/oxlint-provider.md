# A project's own oxlint as a live check

Researcher 017-12, 2026-11-01, Squeal at `834bf0730`. Brief: [oxlint-provider-brief.md](oxlint-provider-brief.md). Probe: [probes/oxlint-provider/](probes/oxlint-provider/README.md). Tools: oxlint 1.90.0 (also 1.80.0 and 1.64.0), oxlint-tsgolint 7.0.2005, Node v24.22.1. Sources: oxc at tag `oxlint_v1.90.0` (`9b6fff42f`), oxc-project/website at `6591a4582` (2026-11-01), oxc-vscode at `e5ab460`, lint-staged `v17.6.0`. Host: 24 CPUs; the one-minute load is stated with every timing.

**Verdict:** oxlint can be a second lint tool, but it cannot reuse D3's worker. It must run as a fresh child process per part. Its native code writes to file descriptor 1 and reads the process's working directory, so in a worker thread it writes into the daemon's stdout. A key built from declared inputs gave the CLI's results on all 440 replayed edits, with and without type-aware rules and JS plugins. It needs four parts beyond the file and the config: the config's `extends` and nested chain, the ignore and suppression files, a whole-program part when the import plugin or type-aware rules are on, and the files that oxlint's JavaScript side reads, recorded by a Node preload. Without type-aware rules a one-file part costs about 80 ms of CPU. With them, every run costs about 3.5 s, because tsgolint builds the whole program each time, and the language server does the same.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Discovery | npm package `oxlint`, a Node script over a native binding from optional platform packages. Resolve `oxlint/package.json` from the root and run its `bin/oxlint` with Node. Configs: `.oxlintrc.json`, `.oxlintrc.jsonc`, `oxlint.config.ts`, `oxlint.config.mts`; nested per folder, not merged; `extends`. The root config is searched from the working directory up to `/`. 1.x is 99.6% of 41.3 M weekly downloads; 1.65 or later, which has `--debug files`, is 88.1%. | read in source code; read in official docs; verified by experiment; npm API |
| 2 | Inputs and key | The file, the oxlint version, the config chain with `extends`, `.eslintignore`, `oxlint-suppressions.json`, the tsconfig, every program file when the import plugin or type-aware rules are on, installed packages, and what JS plugins and JS configs read. Over 440 edits the full key (K4) never missed. The file-and-config key (K1) missed 150 times, the program key without JS reads (K2) 9 times. | verified by experiment |
| 3 | Running | Fresh CLI on 855 files, without type-aware: one file 80 ms of CPU with `--threads 1` (160 ms default), 16 files 140 ms (340 ms), a file that imports much of the project 150 ms (380 ms). With type-aware: 3.5 to 3.9 s for one file or 16. `--lsp`: below 10 ms per edit for a leaf file and 100 ms for a hub, but 3.5 s per edit with type-aware. It also keeps stale JS plugin code. A blocked plugin needs a kill. A kill of the pid alone leaves tsgolint running. | verified by experiment; read in source code |
| 4 | Output | `--format json`: `code` is `plugin(rule)`, `severity` `error` or `warning`, `filename` relative to the working directory, `labels[0].span` gives a 1-based line and a 1-based **UTF-8 byte** column. A parse error has no `code`. A config that does not load prints text, not JSON, and exits 1. 1.80 and 1.90 print the same bytes; 1.64 adds `causes` and `related`. | verified by experiment; read in source code |
| 5 | Dogfood and prior art | Vite (type-aware, 3 JS plugins), Vitest (native only), NestJS (native only), Storybook (3 nested configs, JS plugins), n8n (57 configs, type-aware, beside ESLint). cezar has no oxlint yet. The VS Code extension starts the project's `oxlint --lsp`, re-lints one file per change and keeps no results. Neither oxlint nor lint-staged has a cache. | read in source code |

## Findings

### Q1. Discovery

- **What gets installed.** `oxlint` 1.90.0's `bin/oxlint` is `import "../dist/cli.js"`. `cli.js` calls the native `lint(args, …callbacks)` from `@oxlint/binding-<platform>` (`dist/bindings.js` line 474), which npm installs as one of 19 optional dependencies. `engines.node` is `^20.19.0 || >=22.12.0`. `oxlint-tsgolint` is an optional peer, needed for type-aware rules (`package.json`). The GitHub release also ships standalone binaries, for example `oxlint-x86_64-unknown-linux-gnu.tar.gz` (`gh release view oxlint_v1.90.0`). "TypeScript configs require the Node-based `oxlint` package" (`config.md`). JS plugins run in the same Node process as the CLI: `dist/` has no `worker_threads`, and `loadPlugin` calls `import(url)` (`lint.js` 17817). **Read in source code; read in official docs.**
- **Finding the project's own.** Resolve `oxlint/package.json` from the root and run `bin/oxlint` with Node. A global binary, a standalone binary or `npx oxlint` is not the project's install: `npx` downloads the latest version. tsgolint is found through `OXLINT_TSGOLINT_PATH`, then `node_modules/.bin/tsgolint` upward from the working directory, then `PATH` (`crates/oxc_linter/src/tsgolint.rs` 1355–1420). **Read in source code.**
- **Configs.** Auto-discovery looks for `.oxlintrc.json`, `.oxlintrc.jsonc`, `oxlint.config.ts` and `oxlint.config.mts`. Only one is allowed per folder. `-c` accepts any JS or TS extension, and `-c` turns nested lookup off. In Vite+ mode, `VP_VERSION` set, only `vite.config.*` is read (`config.md`; `config_loader.rs` 46–60; `cli.js` `loadJsConfigsWrapper`). "Configuration files are not automatically merged. A config in a child directory does not affect the parent config" (`nested-config.md`). `options.typeAware` is valid only in the root config. JSON `extends` takes file paths. A TS config imports its bases, packages included, and is loaded with Node's own `import` (`js_config.js` 54–58). TS configs need Node 22.18 or later. **Read in official docs and source code.**
- **The root config can be outside the project.** `load_root_config` searches from the working directory up to `/` (`config_loader.rs` 528–550). Nested discovery walks from each file up to the root config's folder, or to `/` when there is none (60–100). In case 3 of `out/cases.txt`, a `.oxlintrc.json` in the parent folder made `eqeqeq` fire when the project had no config of its own. **Verified by experiment.**
- **Versions** (`api.npmjs.org/versions/oxlint/last-week`, 2026-10-23 to 2026-10-29): 41.3 M downloads, 99.6% on 1.x. The share on 1.80 or later is 64.4%, on 1.70 or later 83.4%, on 1.65 or later 88.1%. For scale over the same week: eslint 202.1 M, oxlint 40.9 M, @biomejs/biome 25.2 M. oxlint-tsgolint had 19.9 M, of which 16.5 M on 7.x. 1.65.0 (2026-05-15) added `--debug` (CHANGELOG line 557). 1.64.0 answers `no such flag: --debug` (verified). **npm API; read in source code.**
- **Absent or too old.** No `oxlint/package.json` from the root, or no platform binding: off, with that reason. Below 1.65 there is no `--debug files`, which is the only way found to ask which named files oxlint skips (Q2): off, "oxlint 1.65 or later". **Inferred.**

### Q2. Inputs and key

Keys in `replay.mjs`, each a superset of the one before:

- **K1:** the file's blob and path; the oxlint version (plus tsgolint with type-aware, plus Node's major with JS plugins); the root config's `extends` closure; for each folder between the file and the root, its config with its closure or none; and the bytes of `.eslintignore`, `.gitignore` and `oxlint-suppressions.json`.
- **K2:** K1, plus the blob of every listed module file (`js`, `ts`, `mjs`, `json` and the rest, tsconfig and `package.json` included) and the installed package's files.
- **K3:** K2, plus the JS plugin entry file named in the config.
- **K4:** K3, plus every project file that oxlint's JavaScript side loaded or read in that run, recorded by `observe.mjs`.

Each mode ran 110 edits over 14 categories, or 17 with JS plugins. Every category ran at least 4 times. Results are in `out/replay-*.json`. **Verified by experiment.**

| Mode | K1 misses (files) | K2 misses | K3 | K4 | Part runs differing from the whole run | One-file runs differing |
|---|---|---|---|---|---|---|
| A: import plugin | 33 (`c.ts` cycle, `m.js` and `e.js` `import/named`) | 0 | 0 | 0 | 0 of 100 | 0 of 70 |
| B: + type-aware | 39 (also `t.ts` `no-floating-promises`) | 0 | 0 | 0 | 0 of 105 | 0 of 65 |
| C: + JS plugins | 37 (also `w.ts`) | 5 (`w.ts`: `banned.txt`) | 5 | 0 | 0 of 100 | 0 of 78 |
| D: both | 41 | 4 (`w.ts`: `banned.txt`) | 4 | 0 | 0 of 105 | 0 of 80 |

- **K1 is sound for single-file rules.** Every K1 miss was a file whose findings depend on another file: an import target in the project (`n.js`), the import graph (`d.ts`), an installed package (`probe-dep`), a typed program file (`u.ts`), or the JS plugin's own files. Edits to the root config, `extends`, a nested config, a new nested config, `.eslintignore`, `ignorePatterns` and the suppressions file were all caught by K1. A miss counted under such an edit's category is a cross-file change from an earlier step that showed up later.
- **Inputs the replay could not change, from `cases.sh`:**
  - tsconfig `paths` changed `import/no-cycle` with no type-aware rule (case 1).
  - tsconfig `strict` changed a typed rule's findings (case 2).
  - A config above the root applied (case 3).
  - A TS config's imported `shared.ts` changed findings, and the preload saw `oxlint.config.ts` and `shared.ts` (case 4).
  - `--threads 1` gave the same findings as the default (case 6).

  The replay's tsconfig edit, excluding `t.ts`, changed nothing: tsgolint still linted `t.ts` (case run by hand, `out/replay-B.json` log). **Verified by experiment.**
- **What a key cannot observe.** Rust and tsgolint read the config files, the source files, tsconfigs, `package.json` files and installed packages natively. The import plugin parsed `node_modules/probe-dep` (`e.js` gained `import(named)`). None of that is observable, but all of it is declarable: the listing, the tsconfig files and 011 C11's install fingerprint cover it. The JavaScript side, JS plugins and JS configs, runs in the CLI's Node process. A `--import` preload sees its loads and reads, provided it calls `syncBuiltinESMExports()`. Without that call, the first mode C run missed `banned.txt` 5 times (README). **Verified by experiment.**
- **Environment.** These variables change results or the tool: `OXLINT_TSGOLINT_PATH` and `PATH` (which tsgolint runs), and `VP_VERSION` (which config is read). These change only the default output format, which `--format json` overrides: `CLAUDECODE`, `AI_AGENT`, `GITHUB_ACTIONS` and `NO_COLOR` (`agent_detection.rs`; `command/lint.rs` 371–380). The working directory changes results too: the root config, the suppressions file and `.eslintignore` are read from it (`lint.rs` 128–410). **Read in source code.**
- **Which files oxlint lints.** A git-ignored file is skipped when oxlint walks the folders but linted when named on the command line. `--debug files <paths>` prints the named files that survive `ignorePatterns` and `.eslintignore`, and does not lint them (case 5; `lint.rs` 128–330). The JSON for an ignored file and for a clean file look the same: both have no entry. **Verified by experiment.**

### Q3. Running

- **Not in a worker thread.** `inworker.mjs` ran oxlint's CLI entry inside a worker of a host whose working directory was `/tmp`. The JSON went to the host's fd 1 (2,195 bytes). `worker.stdout` captured 0 bytes. The worker cannot `chdir` (`ERR_WORKER_UNSUPPORTED_OPERATION`). The native code uses `env::current_dir()` (`lint.rs` 70), so discovery ran from `/tmp`. **Verified by experiment.**
- **A fresh CLI per part** (`out/cost-*.json`; n = 5, or 3 with type-aware; median [min–max]; load 15.8 to 18.6; Squeal's `src/`, 855 files; config: correctness rules, `typescript`, `unicorn`, `oxc`, `import` with `import/no-cycle`):

| Run | CPU, default threads | CPU, `--threads 1` | Wall, `--threads 1` | Peak RSS, default / `--threads 1` |
|---|---|---|---|---|
| one leaf file | 160 ms [150–170] | 80 ms [70–100] | 70 ms | 175 / 84 MB |
| one file importing much of `src/` | 380 ms [300–410] | 150 ms [140–190] | 140 ms | 296 / 92 MB |
| same file, no import plugin | – | 80 ms [80–90] | 80 ms | 88 MB |
| 16 files | 340 ms [320–390] | 140 ms [120–180] | 130 ms | 287 / 90 MB |
| 16 files, no import plugin | 190 ms [170–200] | 90 ms [80–100] | 80 ms | 217 / 86 MB |
| whole, 855 files | 1,930 ms [1,770–3,190] | – | 470 ms | 457 MB |
| type-aware: one file / 16 files | 3,890 ms (16 files) | 3,740 / 3,760 ms | 590 / 610 ms | 363–377 MB |
| type-aware, whole | 9,090 ms [8,160–9,230] | – | 2,230 ms | 566 MB |

  With the default threads, sys time was 90 to 200 ms of these totals. oxlint starts one thread per CPU (`threads_count` 24). With the import plugin on, linting one file parses the files it imports. `--threads 1` does not bound tsgolint. A type-aware run costs the same for 1 file as for 16, because tsgolint builds the program on every run. The replay's tiny fixture shows the floor (`out/replay-*.json`, one-file runs; loads 7.0 to 17.1): 150 ms (A), 390 ms (B), 260 ms (C), 470 ms (D). **Verified by experiment.** Peak RSS is GNU time's largest single process, oxlint or tsgolint (**inferred** from `getrusage`).
- **`oxlint --lsp`, the long-lived mode** (`out/lsp-*.json`; 15 edits; load 19.8 to 20.1):
  - A leaf file: first result in 86 ms, with 120 ms of CPU; each edit below the 10 ms tick; RSS 134 MB.
  - The file importing much of `src/`: first result in 114 ms; 100 ms of CPU per edit [90–130]; RSS 249 MB, then 310 MB.
  - With type-aware: 3,480 ms per edit [3,400–4,020]. The server starts a new `tsgolint headless` for each lint (`tsgolint.rs` 423–456).
  - A dependency edited on disk without a notice was seen at the next lint (`import/named` appeared, then went away).
  - A JS plugin's imported module edited on disk was **not** seen, even after a watched-file notice. A fresh CLI saw it. `loadPlugin` imports by plain URL, so Node's module cache keeps the old code.
  - The server lints one buffer and reads every other file from disk (`server_linter.rs` 839–855). It rebuilds everything on any watched-file event (534–549).

  **Verified by experiment; read in source code.**
- **Faults** (`out/contain.json`; each run in its own process group):
  - A plugin that blocked (`Atomics.wait`, no CPU) never ended; the 5 s guard's SIGKILL freed it.
  - A plugin that threw gave exit 1 and a finding `"Error running JS plugin."` with a `filename` and no `code`.
  - `process.exit(7)` gave exit 7 and no output.
  - A late asynchronous throw gave exit 1, complete JSON with **no** finding, and the stack on stderr.
  - A SIGKILL to oxlint's pid alone during a type-aware run left `tsgolint` and its Node wrapper running. A kill of the whole group left nothing. The probe then killed the group; no oxlint or tsgolint process remained.

  **Verified by experiment.**

### Q4. Output

- **JSON shape** (1.90.0, `output.txt`): `{ "diagnostics": [ { message, code?, severity, url?, help?, note?, filename, labels: [ { label?, span: { offset, length, line, column } } ] } ], number_of_files, number_of_rules, threads_count, start_time }`. The JSON reporter is miette's `JSONReportHandler` (`output_formatter/json.rs`).
- **Mapping to `LintFinding`.**
  - **Rule:** `code` is `plugin(rule)`, for example `eslint(no-unused-vars)`, `typescript(no-floating-promises)`, `import(named)` or `local(no-ident)` for a JS plugin. The config writes the same rule as `plugin/rule`.
  - **Message:** the `message` field. `help` and `note` are separate.
  - **Severity:** `error` or `warning`.
  - **Line:** 1-based, from `labels[0].span.line`.
  - **Column:** 1-based, but counted in UTF-8 bytes. In `"ü😀" && x == 1`, `==` reads column 47; the UTF-16 column is 44 (`out/column.txt`). ESLint's column is UTF-16, so the two tools' columns differ on non-ASCII lines.
  - **Path:** `filename`, relative to the working directory.

  **Verified by experiment.**
- **Parse errors and failures.**
  - A parse error is a finding with no `code`, for example `"Unexpected token"`, `severity` `error`, with a `filename` and a line.
  - A plugin error looks the same: `"Error running JS plugin."`, with no `code`.
  - A suppressions file with uncovered violations adds a finding with `filename` `""`: "There are new violations not covered by the suppressions file."
  - A config that does not load, root or nested, prints `Failed to parse oxlint configuration file…` as **plain text** on stdout and exits 1. Examples: invalid JSON, an unknown rule, a missing JS plugin. So does `No files found to lint` when every named file is ignored, though JSON follows it.
  - A missing tsgolint is plain text too.

  **Verified by experiment.**
- **Between versions.** 1.80.0 and 1.90.0 printed byte-identical output on the same files, after removing versions and timings. 1.64.0 adds `"causes": []` and `"related": []` to every finding. The fields named above did not change. The versioning policy calls "Improving rule descriptions or diagnostic messages" non-breaking. It puts type-aware rules and JS plugins outside semver (`versioning.md`). So a minor release can change messages, and with them D2's fingerprint. **Verified by experiment; read in official docs.**

### Q5. Dogfood and prior art

Default branches, cloned 2026-11-01, read only. Config counts leave out fixtures and templates. **Read in source code.**

| Repository @ commit | oxlint | Configs | Type-aware | JS plugins | Notes |
|---|---|---|---|---|---|
| vitejs/vite @ `90bc034a` | 1.89.0 | 1 `oxlint.config.ts` | yes (`options.typeAware`) | eslint-plugin-n, eslint-plugin-regexp, @e18e/eslint-plugin | lint-staged runs `oxlint --fix` |
| vitest-dev/vitest @ `2debb4e5` | 1.88.0 | 1 `.oxlintrc.jsonc` | no | none | `import` plugin, `reportUnusedDisableDirectives` |
| nestjs/nest @ `8d9dd9d1` | 1.90.0 | 1 `.oxlintrc.json` | no | none | `oxlint packages integration` |
| storybookjs/storybook @ `43a13889` | 1.85.0 | 3, nested with `extends` | no | 4 to 7, one local | lint-staged runs oxlint on staged files |
| n8n-io/n8n @ `c08ba2dd` | 1.78.0 | 57, most extend `@n8n/oxlint-config` | yes, in 55 | 5 or more | 21 packages still on ESLint |
| cezar @ `950750be` | not installed | 0 | – | – | `docs/adr/0001-typescript-7.md` line 25 chooses oxlint |

- **Editors.** The VS Code extension (oxc-vscode `e5ab460`) starts `<binary> --lsp`. It looks for the binary in a setting, then `node_modules/.bin`, then global installs and `PATH`, and bundles none (`findBinary.ts` 93–122). The server watches config files, their `extends` and, with type-aware rules, `**/tsconfig*.json` (`server_linter.rs` 496–532). It re-lints the changed file on type or on save. It keeps the built config and code actions, but no results. Its module map is rebuilt for every lint (`runtime.rs` 430–525).
- **lint-staged** `v17.6.0` keeps nothing between runs. It spawns the command once per run with the staged files (`lib/getSpawnedTask.js` 101).
- **oxlint has no results cache**: no `--cache` flag in `command/lint.rs`. So nothing prior keys oxlint results; Squeal's key would be the first.

## Recommendation for Squeal

1. **Replace D3's worker with a child process per part (Q3).** Run `<node> <root>/node_modules/oxlint/bin/oxlint --format json --threads 1 <files>`. Set `cwd` to the root, start it in its own process group, apply D3's guard, and kill the **group**. A pid-only kill leaves tsgolint running. Squeal's own Node must be 22.18 or later for TS configs. `--threads 1` halved the CPU of a 1-file or 16-file part.
2. **D4 does not apply.** Nothing is kept warm, so no reload level is needed. A fresh run reads every config, plugin and package again. Reject `--lsp`: it keeps old JS plugin code, rebuilds on every watched file, and saves nothing with type-aware rules.
3. **D5's shape fits with oxlint parts in place of ESLint's.** Key a file by:
   - its blob, and the oxlint version (tsgolint's with type-aware, Node's major with JS plugins or a TS config);
   - the root config's closure, and each folder's config or none between the file and the root;
   - `.eslintignore` and `oxlint-suppressions.json`;
   - `OXLINT_TSGOLINT_PATH` and `VP_VERSION`;
   - the provider version.

   When the import plugin is on in any config, or type-aware rules are on, add D5's program segment: every listed module file, the tsconfig files and the install fingerprint. When JS plugins or a TS config are present, add the bytes the JavaScript side read, recorded by a `--import` preload in the oxlint process, as D5's held bytes. This key had no miss in 440 edits.
4. **Ask oxlint which named files it lints.** Use `--debug files <part>` before each part (Q2). An ignored file is excluded, never `pass`. This needs 1.65 or later.
5. **Make a file `unknown`, not keyed, when:**
   - a config above the root applies (outside the listing; or key it by path and blob, as D5 does for files outside the root);
   - the run printed non-JSON (a config does not load: every covered file, D9);
   - the exit code is not 0 but no finding has severity `error`, or stderr holds an uncaught exception;
   - a finding has no `code` and reads `Error running JS plugin.`;
   - the JS side read through an API the preload does not patch, or started a thread or a process (017-07's rule).

   A parse error stays a finding with `rule: null`. Drop the `filename: ""` suppressions finding.
6. **Type-aware rules are a cost decision for the human.** Every type-aware part costs about 3.5 to 3.9 s of CPU on 855 files, against about 80 ms without. Vite and n8n turn type-aware on.
7. **Dogfood (Q5).** Vitest for the plain case: one JSON config and native rules. Vite for type-aware rules with JS plugins. Storybook for nested configs.

## Open questions

1. Can a run turn off the root config's `options.typeAware`? I found no CLI flag that disables it ("CLI flags take precedence" applies to `--type-aware` only). **Not determined, because** it needs a read of the CLI parser beyond this brief.
2. With a suppressions count of 1 and two matching violations, which ones are reported? **Not tested.**
3. Is `--debug files` a stable interface? The docs list it under "Enable debug output options." **Not determined, because** the versioning policy does not name it.
4. What do type-aware runs cost on a larger program, and does tsgolint's time scale with the program rather than the part? Only one 855-file program was measured.
5. Vue, Svelte and Astro files, which oxlint lints partly: **not tested.**

Limits: one small fixture with one JS plugin and one typed rule, 440 edits. Costs come from one 855-file program at loads of 15.8 to 20.1, with n = 3 to 5. The survey read only the repositories' own configs.

## Sources

- Probe and outputs: [probes/oxlint-provider/](probes/oxlint-provider/README.md).
- oxc, https://github.com/oxc-project/oxc at `oxlint_v1.90.0` (`9b6fff42f`):
  - `apps/oxlint/src/lint.rs`, `config_loader.rs`, `command/lint.rs`, `agent_detection.rs`, `output_formatter/json.rs`, `lsp/server_linter.rs`, `run.rs`, `CHANGELOG.md`;
  - `crates/oxc_linter/src/tsgolint.rs`, `crates/oxc_linter/src/service/runtime.rs`, `crates/oxc_language_server/src/backend.rs`;
  - npm `oxlint@1.90.0`: `dist/cli.js`, `dist/bindings.js`, `dist/js_config.js`, `dist/lint.js`.
- Docs, https://github.com/oxc-project/website at `6591a4582` (published at https://oxc.rs/docs/guide/usage/linter/): `config.md`, `nested-config.md`, `ignore-files.md`, `type-aware.md`, `multi-file-analysis.md`, `versioning.md`, `generated-cli.md`, `quickstart.md`.
- oxc-vscode, https://github.com/oxc-project/oxc-vscode at `e5ab460`: `client/findBinary.ts`, `client/tools/linter.ts`, `client/tools/lsp_helper.ts`, `package.json`.
- lint-staged, https://github.com/lint-staged/lint-staged at `v17.6.0` (`48f9f4ea`).
- Survey repositories at the commits in the Q5 table, https://github.com/<owner>/<repo>; cezar from `~/projects/cezar` at `950750be`.
- npm: https://api.npmjs.org/versions/oxlint/last-week, `/versions/oxlint-tsgolint/last-week` and `/downloads/point/last-week/{oxlint,eslint,@biomejs/biome}`, fetched 2026-11-01; release dates from `npm view oxlint time`.
- Squeal: `../spec.md` D2 to D5 and D9, `eslint-provider.md`, 016 `binding-cost.md` and `diagnostic-identity.md`, `src/core/lint/provider/protocol.ts`, `src/core/lint/pass/provider.ts`, `src/core/types/lint.ts`.
