# Probe: issue #102 (throwaway)

Throwaway fixture for `docs/specifications/015-coverage-complexity/research/issue-102.md`.
Not product code; delete it freely. `node_modules` stays out of git.

`run.sh <vitest-version>`, `variants.sh` and `fixes.sh` (run after `run.sh`) copy this fixture to `/tmp/issue-102/<version>/`,
install that Vitest (and jsdom) with HOME and npm_config_cache in temp
directories, and run its configs. The test file is `probe.spec-102.js` so that Squeal's own Vitest config does not include it. The provider is a copy of
`plugins/codex/dist/coverage/provider.mjs` under `/tmp/issue-102/data/`,
outside the project, as a plugin data directory is.
