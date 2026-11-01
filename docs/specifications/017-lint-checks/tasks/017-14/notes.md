# 017-14: the oxlint provider, notes for row 017-15

Worker 442461fb, 2026-11-01. Spec D11, brief `tasks/wave-4.md` W3. The module runs a project's own oxlint and returns `LintFinding`s or `unknown` per file. It is not wired into the pass. It does not edit `LintProvider`; the changes it needs are in "Where `LintProvider` does not fit".

## Seam map

| File | What it holds |
| --- | --- |
| `src/core/lint/provider/oxlint/index.ts` | The exports: `oxlintProvider`, `OxlintProvider`, `OxlintDeclaration`, `OxlintSnapshot`, `OXLINT_PROVIDER_VERSION` (1), `KEYED_ENV`, `TYPE_AWARE_OFF`, `isOxlintConfigInput`. |
| `provider.ts` | The provider: `open`, `refresh(level)`, `inputs`, `lint`, `close`; D9's 3 failures in 10 minutes; the snapshot and report environment. |
| `discover.ts` | `oxlint/package.json` from the root upward, as Node looks for a package; off below 1.65. |
| `configs.ts` | Config names, the walk for nested configs (`node_modules` and `.git` left out), a JSON config's `extends` closure through a JSONC reader, the import plugin and JS plugins as JSON shows them, one file's config chain, the first config above the root. |
| `config-set.ts` | What one refresh reads: `configFiles`, `closure`, `importPlugin`, `javascript`, `above`, and `--print-config`'s `options.typeAware` and plugins. |
| `run.ts` | One oxlint process and what it means: D3 failures, D11's `unknown` cases, the preload's reads as `held`, `--debug files` (`lintedFiles`). |
| `spawn.ts` | A child in its own process group, the guard, SIGKILL to the whole group on the guard, on abort and after every exit. |
| `preload.ts` | The `node --import` preload as a string, written to a private `mkdtemp` folder per provider and removed at `close`. No build step. |
| `output.ts` | oxlint's JSON as findings: `code` as the rule, `null` for a parse error; the UTF-8 byte column as ESLint's UTF-16 column; a JS plugin's error as `unknown`; the suppressions finding with an empty `filename` dropped. |

## Where `LintProvider` does not fit

These are the changes 017-15 makes. This row did not edit the interface (brief).

1. **The tool.** `LintTool` is `"eslint"`, and `LintDeclaration.tool` is `"eslint"`. Change: `LintTool = "eslint" | "oxlint"` in `src/core/types/lint.ts`, and `LintDeclaration.tool: LintTool` in `pass/provider.ts`. Then `OxlintDeclaration` is `LintDeclaration`, and `OxlintProvider` is a `LintProvider` with no other change. Both are additive type changes.
2. **No reload levels.** `refresh(level)` takes D4's levels. `none` returns the last snapshot and runs nothing. Any level above `none` reads discovery and every config again; this costs one `--print-config` run. `instance` and `thread` mean the same here. The pass's `refreshLevel` and `mayTurnOn` (`pass/refresh.ts`) know only ESLint's names. For oxlint, use `isOxlintConfigInput(path)` in place of `isFlatConfig`: a config name at any depth, or the root's `.eslintignore` or `oxlint-suppressions.json`. A change to a `closure` path refreshes too, as now.
3. **Held bytes come from one run.** Each run is a new process, so a report's `held` is that run's only. It is not merged with earlier runs as the ESLint worker's delta is. Each path holds the git blob of each distinct use of its bytes (`others`). A read-capable open gives `unobserved: true`. The report also holds the blob on disk after the run of each config and closure file, which oxlint's native side read. A pass that compares `held` with its key's blobs works unchanged. A snapshot's `held` is what `--print-config` read: the TS config's imports, and the JS plugins with their imports.
4. **The closure grows after a lint.** A JS plugin's rule reads files when it lints, for example `banned.txt`, so `--print-config` does not see them. They join the closure in the report and in later snapshots. The pass's `grew.closure` path (`pass/lint-part.ts`) then stores nothing for that part and keys again: one more lint per refresh for such a project.
5. **`program` is always `[]`**, and `walked` and `lookups` are absent. With the import plugin on in any config, every file's `wholeProgram` is `true`, and D5's program segment over the listing keys cross-file results. The replay below keys that way.
6. **oxlint reads the disk, not the given text.** After each run the provider compares each linted file's bytes on disk with the given text, or with `LintFile.blob` when the pass gives it. A difference gives `unknown: it changed while oxlint ran`. A change and its undo within one run is not seen. The provider does not check the program files that the import plugin reads. Proposal: after a whole-program part, the pass compares the segment's listed blobs with the disk, as it does for `held`, and stores nothing on a difference.
7. **Cost per call.** `inputs()` is one `--debug files` run, about 100 ms of CPU. `lint()` adds a `--debug files` run only when oxlint linted fewer named files than it was given (`number_of_files`). A file's ignore state changes only with a config input. Proposal: the pass calls `inputs()` for new paths and after a refresh above `none`, not for each edited file.
8. **`packages` is `["oxlint"]`**, so the pass keys the install fingerprint (`pass/keys.ts` keys `installed` only when `packages` is not empty). It covers installed JS plugins and import targets in `node_modules`.
9. **`env`** holds only the keyed variables that are set: `OXLINT_TSGOLINT_PATH` and `VP_VERSION`.

## Decisions the spec did not settle

1. **Type-aware detection** reads `options.typeAware` from `--print-config`, which loads a TS config as oxlint does. One run per refresh above `none`, about 170 ms of CPU. A JSON reader alone could not read `oxlint.config.ts`.
2. **A config above the root** makes every file `unknown: a config above the root applies: ../.oxlintrc.json`. D11 allows keying it by path and blob instead; this row does not.
3. **The config chain.** A file's `LintFileInputs.config` is `{"chain": [[folder, config or null], ...]}`, from its folder up to its nearest config, which oxlint uses. Every config's bytes are in `configFiles` (the walk), so any config edit re-keys every file: sound, and coarse.
4. **The import plugin is on** when a JSON config, its `overrides` or what it extends names `import` in `plugins`, or a rule starts with `import/`; when a nested config is JS or TS, which a JSON reader cannot read; or when `--print-config` lists `import` for the root. Any of these makes every file whole-program.
5. **The preload runs only when user code runs** in oxlint's process: a JS or TS config, or `jsPlugins` in any config or in `--print-config`. `--print-config` always runs with it. Without it, a one-file run costs about 20 ms of CPU less (below).
6. **oxlint's own reads are its own.** Reads and process starts made by code inside oxlint's package are not recorded. Its binding's loader reads `/usr/bin/ldd` and may run `ldd --version`. Without this rule every run would read `unknown`, and an absolute path outside the root would enter every key.
7. **A JS plugin's error** (`Error running JS plugin.`, no `code`) gives that file `unknown: a JS plugin failed: Error: <message>`. It is not a D3 failure: oxlint exits 1 with an error-severity diagnostic, as with any error finding.
8. **D3 failures**, counted toward D9's 3 in 10 minutes: a timeout; a signal; an uncaught exception on the JavaScript side (the preload's `uncaughtExceptionMonitor`); an exit code other than 0, or other than 1 with an error finding; no preload report when one was due. A thread or process started, and an unobserved read, give `unknown` and are not failures, as ESLint's worker-thread rule. A config that does not load gives `unknown: the oxlint config does not load: <first line>` and is not a failure.
9. A severity other than `error` reads as a warning. Each file's findings are sorted by line and column, ESLint's order. Diagnostics of files not asked for are dropped. Paths follow `--`, so a file named `-x.ts` is not read as a flag.
10. The preload's variables: `SQUEAL_OXLINT_OBSERVE` (its report path), `SQUEAL_OXLINT_FORMAT`, `SQUEAL_OXLINT_PACKAGE`.
11. `oxlint` 1.90.0 is an exact devDependency, as `eslint` is.

## Tests

| File | What it shows |
| --- | --- |
| `test/lint/oxlint/output.test.ts` | The UTF-16 column (`out/column.txt`'s line: byte column 47 is column 44), a parse error with `rule: null`, the suppressions finding dropped, a JS plugin's error as `unknown`, text for JSON. |
| `test/lint/oxlint/contain.test.ts` | A plugin that blocks (guard, then the group's child is dead), throws, throws late, exits, exits after starting a child (the child is dead), starts a process; the third failure in 10 minutes turns the provider off until a refresh above `none`; an older failure does not count. |
| `test/lint/oxlint/discover.test.ts` | No oxlint; 1.64.0; the declaration with nested configs and `.eslintignore`; a type-aware root in JSON and in a TS config that imports it; on again after a refresh; a config above the root. |
| `test/lint/oxlint/inputs.test.ts` | What a key needs reaches the report: a JS plugin's import and read with their blobs, a TS config's import, each file's chain, the import plugin, `VP_VERSION`, `isOxlintConfigInput`; a file ignored at lint time; bytes that differ from the given text. |
| `test/lint/oxlint/replay.test.ts` | The 017-12 probe's replay, modes A and C, through the provider. A fresh whole CLI run is the truth after each edit. The parts equal it, `inputs()` equals the walk's `--debug files`, and a key built only from what the provider reports never misses. |

The replay's default schedule runs each edit three times: 42 steps in mode A and 51 in mode C. `SQUEAL_OXLINT_REPLAY_STEPS=110` runs the probe's length with its seed. That run passed once, on 2026-11-01 at about 23:23Z: 107 s wall and 115 s of CPU for both modes, at load 25 to 37. The default schedule never edits `banned.txt` while `src/w.ts` is linted, because `.eslintignore` ignores `w.ts` at each of those steps. With the preload's reads removed, the default replay still passed and `inputs.test.ts` failed (2 of 4 tests). That test, not the replay, guards the held bytes.

## Cost

One file of this repository with oxlint's default rules, n = 5, nice 10, load 24 to 32: a run costs 90 ms of CPU at the median, 110 ms with the preload, and `--debug files` costs 100 ms. Peak RSS is about 83 MB. `--debug files` must run with `--threads 1`: with the default threads it took 3.2 to 4.6 s of sys CPU on this 24-CPU host.

## What 017-15 must know

- The changes in "Where `LintProvider` does not fit" 1, 2 and 6, and the proposals in 6 and 7.
- `lint.tools` and one provider per tool. A project with both tools gets two checks per file (D11).
- TS configs need Squeal's own Node at 22.18 or later: the provider runs oxlint with `process.execPath`.
- Process groups are POSIX: `detached: true` and a kill of the negative pid.
- The tests write their fixtures from TypeScript strings in `test/lint/oxlint/replay.ts` and `helpers.ts`, so Biome and tsc never check them as code. Squeal sees the dependency through the imports, so `squeal.config.json` needs no `inputs` entry for `test/lint/oxlint/**`.
