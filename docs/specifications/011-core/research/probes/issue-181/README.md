# Issue 181 throwaway probe

Research fixture only. It is not product code and not a regression test. Delete it at will.

Run from the Squeal checkout root with its installed pnpm dependencies:

```sh
cat /proc/loadavg; nproc
node docs/specifications/011-core/research/probes/issue-181/probe.mjs docs/specifications/011-core/research/probes/issue-181/evidence-blocked
node docs/specifications/011-core/research/probes/issue-181/probe.mjs docs/specifications/011-core/research/probes/issue-181/evidence-control --control
```

The script stops before it starts a daemon when the one-minute load is above the CPU count.
It makes a Git repository under `$TMPDIR` (`sq-181-*`), links the checkout's `node_modules`
(nothing installed, nothing committed), and gives the daemon a private `XDG_RUNTIME_DIR`
and `XDG_CONFIG_HOME`, so no other session's daemon, socket or store is touched.
It clears inherited `VITEST*`, `GIT_*`, `CODEX_*`, `CEZ_*`, `CLAUDE*`, `SQUEAL*`, `NODE_OPTIONS`, `NODE_PATH`.

CLI: retained Squeal 0.1.429, `/home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.429/dist/cli/squeal.mjs`.
Fixture: `fast.test.ts` (50 ms), `slow.test.ts` (30 s), Vitest 5.0.3, two workers;
`squeal.config.json` lookup-only baseline, tier size 2, backlog tier size 4, runner timeout 60 s,
coverage and complexity off.

Sequence (both scenarios; `--control` skips steps 2 and 3):

1. `squeal daemon <fixture>`, poll `squeal status --json` until both files are listed.
2. Append a comment to `slow.test.ts` (an edit; its 30 s run starts).
3. Poll `squeal status --json slow.test.ts` until it says running.
4. Write the new file `blocked-switch.test.ts`, one test that fails on purpose.
5. At once, in parallel: `squeal status --wait 15000 blocked-switch.test.ts` and the direct run
   `node_modules/.bin/vitest run blocked-switch.test.ts` (fixture only, never the repository suite).
6. `squeal status --json blocked-switch.test.ts`, then `squeal status --wait 60000 blocked-switch.test.ts`.
7. `squeal stop <fixture>`.

Evidence files: `named-wait.out` (step 5 wait, exit code in `events.json`), `direct.out`,
`mid-json.out` / `after-wait-json.out` (JSON then the stderr summary), `final-wait.out`,
`store-runs.txt` (read-only query of the fixture store's `runs` and `results` after the run).

Known defect of the script: in `events.json` the `ms` of an event that carries a duration is that
command's duration, not the time since start (the spread overwrote it). Run times since start are
taken from `store-runs.txt` instead.
