# Issue 155 throwaway probe

Research fixture only. It is not product code and not a repository test.
Run it from the Squeal worktree root with installed dependencies. Do not build or install:

```sh
node --check docs/specifications/015-coverage-complexity/research/probes/issue-155/run.mjs
node docs/specifications/015-coverage-complexity/research/probes/issue-155/run.mjs
PROBE_COVERAGE=absent node docs/specifications/015-coverage-complexity/research/probes/issue-155/run.mjs <out>.json
PROBE_INPUTS=1 node docs/specifications/015-coverage-complexity/research/probes/issue-155/run.mjs <out>.json
PROBE_SLOW=1 node docs/specifications/015-coverage-complexity/research/probes/issue-155/run.mjs <out>.json
PROBE_SLOW=1 PROBE_SETTLE=1 node docs/specifications/015-coverage-complexity/research/probes/issue-155/run.mjs <out>.json
```

`run.mjs` uses the installed Claude Code plugin CLI
`~/.claude/plugins/cache/hearsay/squeal/0.1.407/dist/cli/squeal.mjs` (override with `PROBE_CLI`)
and this worktree's Vitest 5.0.3 through a `node_modules` symlink. It makes one private git
repository under `$TMPDIR` with private HOME, XDG config and runtime directories. It checks
one-minute load against CPU count before the daemon start and before each observation. It starts
one daemon and stops it in `finally` (SIGTERM, then SIGKILL after 5 s). The scratch repository
stays for inspection; nothing in it is committed.

The fixture has three sources, each with one covering test file:

- `src/api.ts`: a function and an object-property arrow, tested by Vitest `src/api.test.ts`.
- `src/helper.testkit.ts`: a testkit helper that `src/api.test.ts` imports.
- `.github/scripts/label.cjs`: CommonJS, tested by node:test `.github/scripts/label.test.cjs`.

Phase `initial` reads revision 0. Phase `after-edit` adds a new object-property arrow (`triple`),
a new testkit arrow (`makeOther`) and a new `.cjs` function (`last`), with calls in the existing
test files, then reads again.

Switches:

- `PROBE_COVERAGE=absent`: no `coverage` or `crap` key in `squeal.config.json`, as in Cezarion.
- `PROBE_INPUTS=1`: Cezarion-style `inputs` globs on two extra test files that only read source text.
- `PROBE_SLOW=1`: an extra slow-tier Vitest file `src/api.e2e.test.ts` that also imports `src/api.ts`.
- `PROBE_SETTLE=1`: in `after-edit`, poll `squeal code` and `squeal status` every 2 s until `triple`
  has CRAP or 60 s pass.

Saved outputs (exact argument arrays, stdout, stderr, exit codes, loads, daemon log):
`results.json` (default), `results-coverage-absent.json`, `results-inputs.json`, `results-slow.json`,
`results-slow-settle.json`. The switches were added to `run.mjs` between runs; each earlier output
came from the script without the later switches, which only add code paths behind their variables.
