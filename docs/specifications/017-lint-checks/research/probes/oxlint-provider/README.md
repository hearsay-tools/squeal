# Probe: oxlint as a live check (017-12)

**Throwaway.** Evidence for [`../../oxlint-provider.md`](../../oxlint-provider.md). Nothing here is product code. Every run happens in a scratch folder under `/tmp` with `HOME` set there. No `node_modules` is committed: the tools were installed with npm into `/tmp/oxp-2abab56c/v190` (oxlint 1.90.0, oxlint-tsgolint 7.0.2005, TypeScript 5.9), `v180` and `v164`.

| File | What it shows | Output |
|---|---|---|
| `fixture/` | A small project: root `.oxlintrc.json` (written per mode by `replay.mjs`) that extends `configs/base.json`, a nested `pkg/.oxlintrc.json`, a JS plugin `plugins/local.mjs` that imports `helper.mjs` and reads `banned.txt`, an import cycle, `import/named` targets in the project and in an installed package (`probe-dep`, copied into `node_modules`), and a typed pair (`t.ts`, `u.ts`). | – |
| `replay.mjs` | Q2. 110 seeded edits per mode (A: import plugin; B: plus type-aware; C: plus JS plugins; D: both). After each edit, a fresh whole run is the truth. Four keys built from declared inputs are checked for a key seen before with another result. The files whose fullest key is new are linted in one part, and each file whose result changed is linted alone; both are compared with the truth. | `out/replay-{A,B,C,D}.json`, `out/replay-runs.log` |
| `observe.mjs` | A `node --import` preload for the oxlint process: records the modules and files its JavaScript side loads and reads. It cannot see what the Rust binding or tsgolint read. | used by `replay.mjs`, `cases.sh` |
| `cases.sh` | Q1, Q2. One-off inputs: tsconfig `paths`, tsconfig `strict` under a typed rule, a config above the root, a TypeScript config and its import, a git-ignored file walked or named, thread count. | `out/cases.txt` |
| `output.sh` | Q4. JSON for findings, a parse error and configs that do not load, on 1.90.0, 1.80.0 and 1.64.0. | `out/output.txt`, `out/column.txt` |
| `cost.mjs` | Q3. CPU, wall time and peak RSS of a fresh CLI per run, through GNU `time`, interleaved, at nice 10, with the one-minute load. Project: a copy of Squeal's `src/` at `834bf0730` (855 files). | `out/cost-*.json` |
| `lsp.mjs` | Q3. `oxlint --lsp` driven as an editor: first result, CPU per edit, RSS; a dependency edited on disk; a JS plugin edited on disk (env `PLUGIN_EDIT`). | `out/lsp-*.json` |
| `contain.mjs` | Q3. A JS plugin that blocks (sleeping, no CPU), throws, exits or throws late; a kill during a type-aware run by process group and by pid alone. | `out/contain.json` |
| `inworker.mjs` | Q3. oxlint's CLI entry inside a `worker_threads` worker of a host whose cwd is elsewhere. | `out/inworker.txt` |
| `out/npm-*` | npm downloads by version, 2026-10-23 to 2026-10-29, and release dates. | – |

Run, for example: `node replay.mjs D 110 24 /tmp/oxp-2abab56c /tmp/oxp-2abab56c/v190`.

The first mode C run used an observer that did not call `syncBuiltinESMExports()`, so it missed the plugin's `readFileSync` of `banned.txt`. Mode C was run again with the fixed observer; the committed `replay-C.json` is that run. Mode D ran with the fixed observer from the start.
