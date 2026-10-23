# Probes for 011-127 (`../../cli-build-inputs.md`)

Throwaway. Nothing here is product or test code. Every script acted on a scratch
clone at `/tmp/r127/repo` (main at 7580d1a1d, `npm ci --offline`), with `HOME`,
`XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` (host slots 4) and `TMPDIR` under `/tmp/r127`.
No live daemon or live store was touched. The clone was removed on 2026-10-23.
Files ending in `.txt` that hold code are code kept out of lint and typecheck.

Scripts:

- `patch-builders.mjs <clone>`: makes the clone's `node_modules/typescript/lib/tsc.js`
  and esbuild's `build`, `buildSync` and `context` append one JSON line per call to
  `$R127_LOG`, with the test file (`__vitest_worker__.filepath`, or `R127_TEST` in a child).
- `attrib.ts`, `vitest.r127.config.ts`: the setup file that sets `R127_TEST`, and the
  wrapper config that adds it. `run-census.sh` copies both into the clone and runs one plain
  `vitest run` at 4 workers, `test/e2e/**` excluded as `squeal.config.json` excludes it.
- `census.mjs`: groups the log by test file and entry. `gap.mjs`: per build file, the
  scratch store's closure and observed set, the declared inputs, and the `src/` files the
  build holds that the key lacks. `cli-reach.mjs`: the `src/` files the CLI entry's
  esbuild graph holds.
- `env.sh`, `measure.sh`, `edit.sh`, `ran.mjs`, `extra.mjs`: the scratch daemon (the
  clone's committed `plugins/claude-code/dist/cli/squeal.mjs`, 0.1.273), one timed
  `squeal run --all --wait` with the load beside it, one sample edit (a commit's `src/`
  diff reversed, then restored), what ran, and what option A added.
- `option-a.mjs`, `option-a.config.json`: option A as measured.
- `option-b.probe.test.ts.txt`: the option B probe test, copied into the clone as
  `test/r127-option-b.test.ts`.
- `option-c.*`: the import-cost probe for option C, run outside the clone.
- `exposure.mjs`: over git history (inferred), how many build files each `src/` commit
  leaves keyed short.

Results: `census.txt`, `census-run.txt`, `gap.txt`, `cli-reach.json`, `measure.log`,
`runs.json`, `option-a-added.txt`, `exposure.txt`.
