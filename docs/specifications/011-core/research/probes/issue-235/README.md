# Issue 235 throwaway probe

This is an **unrun** research probe, not a product regression test. The load
gate skipped its only attempt on 2026-11-17: load1 36.87, 24 CPUs, exit 77.
No scheduler assertion has been verified. Expected outcomes in the code are
hypotheses from source reading.

From the repository root, with its existing pnpm dependencies:

```sh
node docs/specifications/011-core/research/probes/issue-235/run.mjs
```

The wrapper measures load immediately before starting Vitest and skips when
load1 exceeds CPU count. It runs only `scheduler.probe.ts` using a separate
config. Squeal's normal config does not include this probe. All temporary
fixture repositories and pool files go below ignored `.runtime/tmp` through
`TMPDIR`. No real Vitest adapter or daemon is started. The existing fixture
uses the real scheduler, SQLite store and isolated pool with a synthetic
adapter and virtual scheduler clock. Each case closes its scheduler and store.

The seven-file fixture edits one source. Its namesake and four short direct
importers should run automatically; two slower direct importers should remain
catch-up. The narrow request names two current files and one catch-up file,
matching the report's 2 current / 1 queued shape. It examines time 0, 60 seconds
and 120 seconds. The second case adds the public `promote` request as a control:
the selected file should run, with the other catch-up file still delayed.
This control is an experiment plan, not a proposed implementation.

`PROBE_SOURCE_ROOT` can point to another source checkout with compatible test
helpers and dependencies. Default: the working tree. No other version was run.
Do not count the probe's pass as proof of the CLI socket/wait lifecycle: it
calls the scheduler and renderer directly, and does not sleep for 60 seconds.
