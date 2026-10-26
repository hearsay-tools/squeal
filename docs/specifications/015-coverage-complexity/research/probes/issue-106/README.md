# Throwaway probes for issue #106

Throwaway. Not product code. `setup.sh` writes five fixture repositories under
`/tmp/issue-106/` and `run.sh` runs the worktree's built CLI
(`plugins/claude-code/dist/cli/squeal.mjs`) in each, with `HOME`,
`XDG_RUNTIME_DIR` and `XDG_CONFIG_HOME` under `/tmp/issue-106/home`.

- `a-preload`: node:test project, `argv: ["--import", "./preload.mjs"]`; `preload.mjs` imports `helper.mjs`; `helper.test.mjs` imports and calls it.
- `b-plain`: the same without the preload.
- `d-two-projects`: `a-preload` plus a second node:test project (`cwd: packages/p`) whose preload is the same file, as in hearsay-tools/cezarion.
- `e-order`: `b-plain` with only an unrelated test at first; `helper.test.mjs` is added after the helper is judged.
- `c-vitest`: Vitest, `setupFiles: ["./setup.ts"]`; `setup.ts` imports `src/helper.ts`; `test/helper.test.ts` imports and calls it.

Steps used (see `../../issue-106.md`): `run.sh <wt> <fixture> start`, then `run --all --wait`, `status --wait 30000`, `code <path>`.
For `e-order`: after the first `code`, copy `/tmp/issue-106/e-order.helper.test.mjs.later` to `scripts/helper.test.mjs`, wait, read `code`, then `stop`, `start` and read again.
Stop each daemon with `run.sh <wt> <fixture> stop` when done.
