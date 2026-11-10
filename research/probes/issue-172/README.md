# Issue 172 throwaway probe

This is research evidence, not a product test. It creates an isolated Git repository
under ignored `.scratch/`, with two Vitest projects named `server` and `browser`.
Both use Node. The browser stand-in has one trivial assertion and a global setup
that only writes a marker. No browser, server, build or daemon is started.
`node_modules` is a symlink to this worktree's installed dependencies and is never
committed. No dependencies are installed by the probe.

Run from the Squeal worktree:

```sh
node research/probes/issue-172/probe.mjs
```

The default CLI is the pinned installed 0.1.426 runtime. A first argument may name
another runtime explicitly. Each case checks one-minute load against the CPU count
and skips if load is higher. Each CLI has a 30 s collection budget and a 45 s outer
process bound. Raw results go to `.scratch/<case>.json`.

Cases, in order:

1. Browser custom input `src/**`, without an import of the changed source.
2. Browser also imports that source.
3. Case 2 with `--test test/server.test.ts`.
4. Case 1 with setup at the Vitest root, and explicit server test selection.

The committed `custom-input-only.json` is the actual first-case result from
2026-11-10. The next three cases were skipped at load 28.85 on 24 CPUs. They are
available for a later run, not claimed as executed. Start load was 23.01. The run
started at 16:12:11Z and finished at 16:12:13Z. The first result was exit 0, one
selected and completed server test, and an empty setup marker. Later changes to
the probe only applied Biome formatting, import sorting and template syntax.

The probe records stdout and stderr seen before the setup marker when setup runs.
The completed case did not run setup, so its `beforeMarker: null` proves no output
ordering claim. Source inspection supplies that finding in the report.
