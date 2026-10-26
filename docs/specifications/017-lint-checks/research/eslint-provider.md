# Running a project's own ESLint as a live check

Researcher 017-01, 2026-10-26, Squeal at `7e3e54bb8`. Brief: [eslint-provider-brief.md](eslint-provider-brief.md). Probe: [probes/eslint-provider/](probes/eslint-provider/README.md). Tools: ESLint 10.13.0, 9.39.5 and 8.57.1, typescript-eslint 8.72.0, TypeScript 6.0.3, eslint-plugin-import-x 4.17.1, Node v24.21.0. Sources read: ESLint `v10.13.0` and `v9.39.5`, eslint_d `v15.0.3`, vscode-eslint `66e1e45` (3.0.35), lint-staged `v17.6.0`. No timings, no test suite, no agent session.

**Verdict:** a warm worker can give the CLI's results, but only with three rules. (1) Build a new `ESLint` instance when a config file changes. (2) Start a new worker thread when anything the config loads changes: an imported file, a plugin, a shareable config or a tsconfig. (3) For typed rules, lint every changed program file in the same thread before the files that depend on it. `calculateConfigForFile` plus package versions is not a sound key: it missed 6 of the 12 input changes, and the file itself caused one of the 6.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Discovery | Resolve `eslint/package.json` from the project root, as eslint_d does. Since 8.57, `loadESLint()` chooses flat config or eslintrc. ESLint 10 is flat config only and looks up a config from each file's directory; ESLint 9 looks up from `cwd`. Downloads, 2026-10-16 to 10-22: v9 54.5%, v10 23.0%, v8 18.4%, v7 and older 4.1%. | verified by experiment; read in source code; npm API |
| 2 | Inputs | The computed config moved on 6 changes: config data, imported config data, shareable-config rules, ignores, a nested config (v10), and a plugin version that changed no finding. It missed 6 that changed findings: the file itself, local rule code, plugin code, an import target (an untyped rule), a typed program file and the tsconfig. `parserOptions.project`/`projectService` detects typed rules, but import plugins also read other files and declare nothing. | verified by experiment |
| 3 | Warm runs | 200 edits. A kept instance differed from a fresh CLI on 65 steps (v10) and 57 (v9). A new instance per edit differed on 30 and 30. A new thread fixed every remaining case. RSS, whole process: about 290 MB after the first lint and 307 to 319 MB at the end, collected before reading. | verified by experiment |
| 4 | Survey | 15 of 20 repositories lint with ESLint. 13 of the 15 use flat config, 5 use typed rules in their own config, 4 have more than one config and 8 turn on `--cache`. 4 of the other 5 use oxlint. | read in source code (repositories at the commits listed) |
| 5 | Prior art | eslint_d restarts when `package.json` or a lockfile changes. vscode-eslint builds a new instance on each lint and never unloads modules. ESLint's `--cache` keys on the file plus a hash of the config and does not track other files. lint-staged keeps nothing warm. | read in source code; read in official docs |

## Findings

### Q1. Discovery

- **Resolution.** eslint_d calls `require.resolve('eslint/package.json', { paths: [ESLINT_D_ROOT?, process.cwd()] })` and falls back to its bundled copy (`lib/resolver.js` 20–39). vscode-eslint resolves `eslint` from the linted file's directory, or from the `eslint.nodePath` setting, then from the global package path. It caches the loaded library per path for the server's life (`server/src/eslint.ts` 1079–1126, `path2Library`). Its working directory is the nearest folder above the file that holds an `eslint.config.*` (`findWorkingDirectory`, 1496–1524). The probe resolves from the project root in the same way (`lib.mjs`). **Read in source code; verified by experiment.**
- **Flat config or eslintrc.** `loadESLint` exists since 8.57. ESLint 8.57.1 chooses flat config when `ESLINT_USE_FLAT_CONFIG=true` or when it finds `eslint.config.js` from `cwd`. ESLint 9.39.5 chooses flat config unless `ESLINT_USE_FLAT_CONFIG` is `"false"` (`lib/eslint/eslint.js` 1349). ESLint 10 removed eslintrc: "Starting with ESLint v10.0.0, the old configuration format is no longer supported" (`docs/src/use/migrate-to-10.0.0.md`). So an environment variable changes which config applies. **Read in source code and official docs.**
- **Monorepos.** ESLint 10 "determines configuration for each target file by first looking in the directory that contains the file and then searching up ancestor directories" (`configure/configuration-files.md`). ESLint 9 does this only with the `v10_config_lookup_from_file` flag. In the probe, a new `src/eslint.config.js` changed `src/a.js`'s findings in ESLint 10 and did not change them in ESLint 9 (case `nested-config`). Each ESLint instance caches the config path per directory and the config array per file (`config-loader.js` 325–372). **Verified by experiment; read in source code.**
- **A worker thread cannot change directory.** `process.chdir()` in a worker throws `ERR_WORKER_UNSUPPORTED_OPERATION`. eslint_d and vscode-eslint both call `chdir` before each lint. A worker must pass `cwd` to ESLint. Code that reads `process.cwd()` sees the daemon's directory (**verified by experiment** for the throw; the rest is **inferred**).
- **Version share** (`api.npmjs.org/versions/eslint/last-week`, fetched 2026-10-26, 102.3 M downloads): 9.x 55.8 M (54.5%), 10.x 23.5 M (23.0%), 8.x 18.9 M (18.4%), 7.x 2.2 M (2.2%), older 1.9%. So about 77% run a major that defaults to flat config, and 18% run v8, which defaults to eslintrc (**inferred** from the share and the source above).

### Q2. What decides one file's findings

Each case changes one input. A fresh `key.mjs` process runs before and after the change (`out/cases.txt`). The results are the same on ESLint 9 and 10, except for `nested-config`. **Verified by experiment.**

| Change | Config JSON moved | Findings moved | Reading |
|---|---|---|---|
| the linted file itself | no | yes | the file hash holds it |
| `eslint.config.js` adds a rule | yes | yes | caught |
| `eslint/local.js`, imported by the config, turns a rule off | yes | yes | caught |
| the code of a local rule (no `meta.name`) | **no** | yes | missed |
| shareable config package adds a rule, same version | yes | yes | caught (rules are data) |
| plugin code changes, same version | **no** | yes | missed |
| plugin version changes, same code | yes | no | over-keyed |
| `src/b.js` renames the export `a.js` imports (`import-x/named`) | **no** | yes | missed; `typed` is false |
| `src/u.ts` returns a Promise (`t.ts`'s `no-floating-promises`) | **no** | yes | missed; `typed` is true |
| `tsconfig.json` excludes `t.ts` | **no** | yes (parse error) | missed |
| config `ignores` adds `a.js` | yes (`undefined`) | yes | caught |
| new nested `src/eslint.config.js` | v10 yes, v9 no | v10 yes, v9 no | caught |

- **What the JSON holds.** `Config#toJSON` writes each plugin as `namespace:name@version` and the parser as `name@version` (`lib/config/config.js` 590–617). Rule code is not in it. The core plugin is written `"@"`, with no ESLint version. The TypeScript version does not appear: the computed config for `t.ts` holds no `6.0.3`. ESLint's own `--cache` adds the ESLint and Node versions itself: `hash(\`${pkg.version}_${nodeVersion}_${stringify(config)}\`)` (`lint-result-cache.js`). In ESLint 8 with eslintrc, plugins are bare names (`["import-x"]`) and `parser` is `null`, so no version enters at all. **Verified by experiment; read in source code.**
- **What the config loads.** Before the first result, the warm worker resolved 3 project files (`eslint.config.js`, `eslint/local.js`, `eslint/rules/no-foo.js`) and 88 installed packages (`out/warm-eslint10.txt`). A `module.registerHooks` resolve hook in the worker recorded them. The hook is the same mechanism Squeal's recorder uses. **Verified by experiment.**
- **Detecting typed rules.** For `t.ts`, the computed `languageOptions.parserOptions` held `projectService: true`; for `a.js` it held neither field. typescript-eslint also marks its typed rules with `meta.docs.requiresTypeChecking: true` (`no-floating-promises.js` line 54). typescript-eslint's `inferSingleRun` treats `project`, `projectService` and `programs` as the typed signals. **Verified by experiment; read in source code.** But `import-x/named` read `b.js` with no typed signal. ESLint's docs say the same of `--cache`: "Rules whose results depend on other files can therefore report stale results. This includes type-aware rules … and rules that resolve imports across modules, such as those in `eslint-plugin-import` and `eslint-plugin-import-x`" (`command-line-interface.md`, v10.13.0). **Read in official docs.**
- **Which files enter a typed result.** The project service builds `t.ts`'s program from the nearest tsconfig: 65 files, of which 2 are project files (`t.ts`, `u.ts`) and 63 are TypeScript's `lib` files (`out/program.txt`). The tsconfig and the TypeScript version enter too (case `tsconfig`; 016-33 Q4). **Verified by experiment.**
- **Is computed config plus package versions a sound key?** No. It needs these additions: the ESLint and Node versions, the content of the project files the config loads, the identity of every package the config loads (not only those that declare `meta.version`), the environment variables named above, and the files that cross-file rules read. **Inferred** from the table.

### Q3. Warm runs in a worker thread

`warm.mjs` ran 200 edits against one worker. After each edit the worker linted four files twice: with one kept instance and with a new instance. A fresh `eslint -f json` process gave the expected result each time. Twelve change windows were spread over the run; the other steps edited one source file each. Results are in `out/warm-summary.txt` and `out/thread.txt`. **Verified by experiment.**

| Cause | Kept instance | New instance, same thread | New thread |
|---|---|---|---|
| plain edits; import-x import target; plugin version | right | right | – |
| `eslint.config.js` edit; `ignores`; new nested config (v10) | **wrong** | right | – |
| file the config imports; local rule code; shareable config content; plugin code | **wrong** | **wrong** | right |
| `tsconfig.json` | **wrong** | **wrong** | right |
| an edit to `u.ts` seen from `t.ts` (typed) | wrong until `u.ts` is linted | wrong until `u.ts` is linted | – |

- **Totals.** Kept instance: 65 of 200 steps differed from the CLI (ESLint 10), 57 (ESLint 9). New instance: 30 and 30, all in the five module-cache and tsconfig windows. Every difference had a cause in the table.
- **Why.** An instance caches its config arrays for its whole life (`config-loader.js` 354–372). A new instance re-imports `eslint.config.js` with `?mtime=<mtime>` (213–233). Files the config imports and packages stay in the thread's module cache. The typescript-eslint project service is module-level and stubs file watching: "We don't watch the disk, we just refer to these when ESLint calls us" (`project-service/dist/createProjectService.js` 50). It updates a file's text only when ESLint lints that file (`openClientFile` with `codeFullText`). It reloads projects only when a file is in no project, at most once per throttle interval. **Read in source code.**
- **The typed case alone** (`out/typed.txt`, both majors): after `u.ts` changed, linting only `t.ts` stayed wrong. It stayed wrong with a new instance too. It became right once `u.ts` was linted in the same thread. A tsconfig change stayed wrong with a new instance. **Verified by experiment.**
- **Single-run mode.** typescript-eslint assumes one CLI run when `CI=true` or when `argv` holds the ESLint bin (`inferSingleRun.js` 36–50). In that mode it never refreshes anything. `TSESTREE_SINGLE_RUN=false` turns this off. **Read in source code.**
- **import-x warm.** `named` was right in every step. Its export map re-reads a file whose mtime changed (`utils/export-map.js` 55), and its resolution cache keeps entries 30 s by default (`utils/module-cache.js` 28). So a newly added or removed file could stay stale for up to 30 s. **Read in source code; not tested.**
- **Memory** (`process.memoryUsage()` of the whole process; the main thread was 58 MB before the worker started):

| Run, `--expose-gc`, collected before each read | RSS after first lint | RSS at end | Worker heap, first → end |
|---|---|---|---|
| kept instance only, ESLint 10 / 9 | 297 / 297 MB | 307 / 309 MB | 98 → 102 MB |
| plus a new instance per edit, ESLint 10 / 9 | 290 / 293 MB | 312 / 319 MB | 99 → 104 MB |

  Without a forced collection, the same runs ended at 458 to 602 MB RSS, with a heap of up to 408 MB. That memory was garbage not yet collected; none of it was retained. The share of TypeScript in the roughly 230 MB per worker was not measured.

### Q4. Survey (default branches, cloned 2026-10-26, read only)

"Configs" counts `eslint.config.*` and `.eslintrc*` outside fixtures, tests and examples. "Typed" means the repository's own config turns on `projectService`, `project` or a `*TypeChecked` preset. "Cache" means the lint script passes `--cache`.

| Repository @ commit | Linter | Form | Configs | Typed | Cache |
|---|---|---|---|---|---|
| babel/babel @ 368821f31 | ESLint | flat (`.ts`) | 1 | yes | off |
| excalidraw/excalidraw @ b7de45e88 | ESLint | eslintrc | 3 | not in own file; extends shared configs not read | off |
| facebook/react @ fd51cb10d | ESLint 7 | eslintrc | 3 | no | off (lints changed files) |
| jestjs/jest @ 61050e932 | ESLint 10 | flat | 1 | no | on |
| microsoft/TypeScript @ 8a62bbe74 | golangci-lint (Go port) | – | 0 | – | – |
| microsoft/vscode @ 2a83b5253 | ESLint 10 | flat | 1 | yes, for listed extension folders | on (`cacheStrategy: 'content'`) |
| mui/material-ui @ f762e401e | ESLint 10 | flat | 1 | not in own file; base config package not read | on locally, off in CI |
| n8n-io/n8n @ 5d6d06cda | ESLint in 23 packages, oxlint in 55 | flat | 59 | yes (`@n8n/eslint-config`) | turbo task cache |
| nestjs/nest @ d22065e0d | oxlint | – | 0 | – | – |
| nodejs/node @ ba3c34a93 | ESLint (vendored) | flat | 1, plus vendored deps' | no | on (`Makefile`) |
| prettier/prettier @ 7664e3687 | ESLint 10 | flat | 1 | no | off |
| remix-run/react-router @ bb7c1f021 | ESLint 10 | flat (`.ts`) | 1 | no | on |
| storybookjs/storybook @ 2d0df5c09 | oxlint; ESLint configs only in project templates | – | 0 own | – | – |
| sveltejs/svelte @ 356c8766a | ESLint 10 | flat | 1 | yes | off |
| vercel/next.js @ 502b6b7da | ESLint 9 | flat (+2 eslintrc) | 19 | no | off |
| vitejs/vite @ e954a9cda | oxlint | – | 0 | – | – |
| vitest-dev/vitest @ d5d7d2f06 | oxlint | – | 0 | – | – |
| vuejs/core @ ca034820b | ESLint 10 | flat | 1 | no | on |
| webpack/webpack @ 1bac8b0a9 | ESLint 9 | flat | 1 | not in own file; `eslint-config-webpack` not read | on |
| withastro/astro @ e71884a2c | ESLint 10 and Biome | flat | 1 | yes | on |

The 15 ESLint repositories: 13 use flat config and 2 eslintrc. 5 use typed rules in their own config, 7 do not, and 3 are not determined. 4 have more than one config. 8 use `--cache`. 4 use `--concurrency auto`, ESLint's own worker threads (`lib/eslint/worker.js`). mui's config documents the `--cache` gap: "eslint-plugin-mdx loads `.remarkrc.mjs` itself, but ESLint doesn't know that file is a config dependency, so `--cache` doesn't invalidate when it changes" (`eslint.config.mjs` 72–75). Babel lints in chunks because linting everything at once "needs too much memory and crashes" (`Makefile.source.ts`). **Read in source code.** The list was fixed before reading. It favours large tool repositories, so the shares describe this list, not npm users.

### Q5. Prior art

| Tool | Keeps warm | Reloads or invalidates when | Does not notice |
|---|---|---|---|
| eslint_d 15.0.3 | one daemon per resolved ESLint install (`.eslint_d` in its folder); each request runs `cli.execute`, so a new instance each time | the md5 of `package.json`, `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock` or `pnpm-lock.yaml` beside `node_modules` changes (`lib/hash.js`; `bin/eslint_d.js` 71); 15 min idle | files the config imports, local rules, plugin edits without a lockfile change, tsconfig (**inferred** from Q3) |
| vscode-eslint 3.0.35 | the ESLint module per path, for the server's life; a new instance per validation (`withClass` → `newClass`) | a watched file changes: `.eslintrc*`, `eslint.config.{js,mjs,cjs,ts,mts,cts}`, `.eslintignore`, `package.json` (`client/src/client.ts` 440–443). It clears settings and re-validates every open file ("A .eslintrc has change. No smartness here.", `eslintServer.ts` 293) | module changes until the user runs "Restart ESLint Server" (`package.json` 651); no code clears the module cache (**inferred**) |
| ESLint `--cache` 10.13.0 | results per file on disk | the file's metadata or content changes, or the hash of ESLint version, Node version and computed config changes | other files (docs quote in Q2), rule code without a version |
| lint-staged 17.6.0 | nothing | – (spawns the command per commit; looks up config per run) | – |

## Recommendation for Squeal

1. **Resolve and load the project's ESLint in its own worker thread, from the project root, with `loadESLint` when it exists (Q1).** Pass `cwd`; do not rely on `chdir`. Start the worker with `TSESTREE_SINGLE_RUN=false`, and key `ESLINT_USE_FLAT_CONFIG` (Q1, Q3). Support ESLint 9 and 10 first: they are 77.5% of downloads and 13 of the 15 surveyed ESLint repositories use flat config. ESLint 8 (18.4%) puts no versions in its computed config, so it needs the package-identity key below.
2. **Use three levels of reload, chosen by what changed (Q3).** A source file: lint with the kept instance. A config file or an ignore rule: a new instance. A project file the config loaded, an installed package, or a tsconfig: a new worker thread. Record the config's module closure in the worker with a resolve hook (Q2), as the observed-inputs recorder already does. This is stricter than eslint_d and vscode-eslint: each misses at least one case that Q3 shows.
3. **Key each file's result by more than the computed config (Q2).** Use the file hash, the ESLint and Node versions, the computed config JSON, the hashes of the config's project-file closure, the identities of the installed packages it loaded (Squeal already fingerprints installs, 011 C11), and the keyed environment variables.
4. **Treat a file as depending on other files when its config has typed signals or an import plugin's rules (Q2).** For typed rules, the key holds the program's files, the tsconfig and the TypeScript version. A warm run must lint the changed program files first (Q3). ESLint offers no general way to say that a rule reads other files. So the scope for untyped cross-file rules has to come from a list of known plugins or from project policy. The other choice is to rerun all of the project's files when any file changes.
5. **Do not reuse ESLint's `--cache` as the source of truth (Q5).** Its docs disown cross-file rules. 8 of 15 projects turn it on, so a Squeal run should not write the project's `.eslintcache` either (**inferred**).

Limits: one small fixture with one plugin, one shareable config and one typed rule. 200 edits, of which 84 fell inside the 12 change windows. ESLint 8 was checked for the computed config only. No timings. Memory was measured on one fixture. The survey's typed column reads only the repositories' own config files.

## Open questions

1. How much of a worker's roughly 230 MB comes from TypeScript's project service, and does that make one worker per project with typed rules too costly? Not determined: no untyped-only run was measured.
2. What does a big program cost: re-linting the changed program files first, or a new thread on every tsconfig change? Not measured; the brief forbids timings.
3. Which plugins besides import and import-x read other files (for example, a Vue or Next plugin that reads routes)? Not determined; that needs a survey of plugin source.
4. In a monorepo, packages may install different ESLint versions. Is one worker per resolved ESLint install (eslint_d's unit) right? Not tested.

## Sources

- Probe and outputs: [probes/eslint-provider/](probes/eslint-provider/README.md): `out/cases.txt`, `out/warm-eslint10.txt`, `out/warm-eslint9.txt`, `out/warm-summary.txt`, `out/thread.txt`, `out/typed.txt`, `out/program.txt`, `out/memory-*.txt`, `out/npm-eslint-versions-last-week.json`.
- ESLint, https://github.com/eslint/eslint at `v10.13.0` (`4637f9827`) and `v9.39.5` (`4a24e8c09`): `lib/config/config-loader.js`, `lib/config/config.js`, `lib/cli-engine/lint-result-cache.js`, `lib/eslint/eslint.js`, `lib/eslint/worker.js`, `lib/api.js`, `docs/src/use/command-line-interface.md`, `docs/src/use/configure/configuration-files.md`, `docs/src/use/migrate-to-10.0.0.md`. `v8.57.1`: `lib/api.js`, `lib/eslint/flat-eslint.js`.
- eslint_d, https://github.com/mantoni/eslint_d.js at `v15.0.3` (`5562045e5`): `lib/resolver.js`, `lib/hash.js`, `lib/service.js`, `bin/eslint_d.js`, `README.md`.
- vscode-eslint, https://github.com/microsoft/vscode-eslint at `66e1e4546` (3.0.35): `server/src/eslint.ts`, `server/src/eslintServer.ts`, `client/src/client.ts`, `client/src/extension.ts`.
- lint-staged, https://github.com/lint-staged/lint-staged at `v17.6.0` (`48f9f4ea4`): `lib/`, `README.md`.
- typescript-eslint 8.72.0 and eslint-plugin-import-x 4.17.1 as installed from npm: `project-service/dist/createProjectService.js`, `typescript-estree/dist/useProgramFromProjectService.js`, `typescript-estree/dist/parseSettings/inferSingleRun.js`, `eslint-plugin/dist/rules/no-floating-promises.js`, `lib/utils/export-map.js`, `lib/utils/module-cache.js`.
- npm downloads by version: https://api.npmjs.org/versions/eslint/last-week (fetched 2026-10-26, covering 2026-10-16 to 2026-10-22).
- Survey repositories at the commits in the Q4 table, https://github.com/<owner>/<repo>.
- Squeal: [016 diagnostic-identity.md](../../016-extensions/research/diagnostic-identity.md) Q4, 016-34 binding-cost findings (commit `4e426bc47`; not on this branch), [016 plugin-mechanisms.md](../../016-extensions/research/plugin-mechanisms.md) Q2, [011 C3 and C11](../../011-core/spec.md).
