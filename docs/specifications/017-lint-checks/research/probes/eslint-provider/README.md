# Probe: eslint-provider (017-01)

**Throwaway.** Evidence for `../../eslint-provider.md`, not product code. Nothing here runs in the suite. The tools were installed in the scratch directory `/tmp/r01701`, never in the worktree; no `node_modules` is in git. No timings were taken. Node v24.21.0.

## Fixture

`fixture/` is one project, installed twice: ESLint 10.13.0 (`package.json`) and ESLint 9.39.5 (`package.eslint9.json`), both with typescript-eslint 8.72.0, TypeScript 6.0.3, eslint-plugin-import-x 4.17.1 and eslint-import-resolver-node 0.3.9.

- `eslint.config.js`: flat config. `@eslint/js` recommended, the shareable config `eslint-config-probe` (a package, copied into `node_modules` as a folder), `eslint/local.js` (a file the config imports, with a local rule `eslint/rules/no-foo.js` that has no `meta.name`), import-x's `named` rule on `*.js` (it reads the imported file), and the typed rule `@typescript-eslint/no-floating-promises` on `*.ts` with `projectService: true`.
- `src/a.js` imports `x` from `src/b.js`; `src/t.ts` calls `load()` from `src/u.ts`. `dist/out.js` (`let z = 1;`, made at setup since git ignores `dist/`) is ignored by the config.
- `package.eslint8.json` and `eslintrc.eslint8.json`: ESLint 8.57.1 with `.eslintrc.json`, for the eslintrc form of the computed config only.

## Scripts

- `lib.mjs`: finds the project's ESLint as eslint_d does (`require.resolve("eslint/package.json")` from the project root), loads it with `loadESLint` when present, and reads `calculateConfigForFile`.
- `key.mjs <root> <file>...`: a fresh process; computed-config hash, typed flag, plugins, parser and findings per file.
- `mutations.mjs`: twelve input changes with reverts (see `out/cases.txt` for the list).
- `cases.mjs <root>`: for each change, `key.mjs` before and after; does the computed config move when the findings move? Output `out/cases.txt` (Q2).
- `worker.mjs`, `warm.mjs <root> [steps]`: one warm worker thread, 200 edits. After each edit the worker lints four files with a kept `ESLint` instance and with a new instance; both are compared to a fresh `eslint -f json` CLI process. Twelve change windows (apply, five edits, revert) are spread over the first 192 steps; the other steps edit one source file each. Output `out/warm-eslint{10,9}.txt`, grouped by `summarize.mjs` into `out/warm-summary.txt` (Q3). `KEPT_ONLY=1 NO_CLI=1` runs the kept instance only, without the CLI, for memory; with `node --expose-gc` the worker collects before it reads memory (`out/memory-*.txt`).
- `thread.mjs <root>`: for the five changes a new instance missed, a new worker thread in the same process; output `out/thread.txt`.
- `typed.mjs <root>`: what a warm typescript-eslint project service sees of a file it is not asked to lint, and of a tsconfig change; output `out/typed.txt`.
- `program.mjs <root> <file>`: the files of the program the project service builds for one typed file; output `out/program.txt`.
- `out/npm-eslint-versions-last-week.json`: `https://api.npmjs.org/versions/eslint/last-week`, fetched 2026-10-26 (Q1).

## Re-run

```sh
S=/tmp/r01701; P=<this dir>
for v in 10 9; do
  mkdir -p $S/p$v && cp -r $P/fixture/. $S/p$v/ && cd $S/p$v
  [ $v = 9 ] && mv package.eslint9.json package.json
  mkdir -p pkgs dist && mv eslint-config-probe pkgs/ && echo 'let z = 1;' > dist/out.js
  npm install --ignore-scripts --no-audit --no-fund
  rm node_modules/eslint-config-probe && cp -r pkgs/eslint-config-probe node_modules/ && rm -rf pkgs
  node $P/cases.mjs $S/p$v
  node $P/warm.mjs $S/p$v 200 > $P/out/warm-eslint$v.txt
  node $P/thread.mjs $S/p$v; node $P/typed.mjs $S/p$v
done
```

Every script reverts what it changes; `warm.mjs` reverts an open window when it stops early.
