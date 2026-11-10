# Issue 173 throwaway probes

These are research fixtures, not product tests. They need the repository's installed
Vitest 5.0.3 and Node 24.22.1. They do not install dependencies. Squeal is pinned to
`/home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.426/dist/cli/squeal.mjs`.

From the repository root:

```sh
node docs/specifications/011-core/research/probes/issue-173/run.mjs
```

`run.mjs` creates two independent Git repositories in the ignored `.scratch/`
directory. Each has one test, a global setup, and a child that prints two markers
and exits 1. The `attached` wrapper exposes its captured stdout/stderr on `cause`;
the `discarded` wrapper does not. Both log a separate setup console marker. Each
repository has a private store and a short private runtime socket directory under
`/tmp/i173-*`. Existing daemons and stores are not used. Only `node_modules` is
symlinked from the repository; it is ignored in both fixture repositories.

Immediately before each daemon starts, the script checks the one-minute load
against `os.cpus().length` and skips that case when load is higher. It runs the
single-file baseline, reads `status --json` until the setup failure appears (at
most 60 seconds), then reads `why setup.js --include-logs` in text and JSON. This
bounded polling is the experiment's readiness check. It sends SIGTERM to its own
daemon, waits up to eight seconds, and records exit and run files. No full suite
is requested. Socket directories are removed; ignored scratch evidence remains.

For the raw Vitest rejection, pass a fixture path printed by the first script:

```sh
node docs/specifications/011-core/research/probes/issue-173/api.mjs docs/specifications/011-core/research/probes/issue-173/.scratch/1794330201628/attached
node docs/specifications/011-core/research/probes/issue-173/api.mjs docs/specifications/011-core/research/probes/issue-173/.scratch/1794330201628/discarded
```

The timestamp directory above names this run; replace it for another run. This
probe also checks load before starting Vitest. It calls `createVitest`,
`standalone`, `globTestSpecifications`, and `runTestSpecifications`, records the
rejection and reporter console events, then closes Vitest. An expected setup
rejection is evidence, so the probe exits 0; it does not mean the fixture passed.

`evidence.json` retains the observed CLI versions, gates, command arguments and
exit codes, setup states, `why` output, run rows, run logs, daemon output, and API
rejections. Absolute checkout prefixes are replaced with `<repo>`, and API stacks
keep their first frame. The underlying raw output remains in ignored `.scratch/`.
Findings are in `../../issue-173.md`.
