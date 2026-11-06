# Issue 152 throwaway probe

This is a research fixture, not product code or a regression test. Run from the
Squeal checkout with its existing pnpm dependencies. Node 24.22.1 and the retained
Squeal 0.1.407 runtime were used. The script checks one-minute load against CPU
count before starting a daemon. It never requests a full-suite checkpoint.

```sh
node --disable-warning=ExperimentalWarning docs/specifications/011-core/research/probes/issue-152/probe.mjs
node --disable-warning=ExperimentalWarning docs/specifications/011-core/research/probes/issue-152/probe.mjs docs/specifications/011-core/research/probes/issue-152/evidence-edited --edit-later
```

The script creates an isolated Git repository in the task's temporary directory,
with `fast.test.ts` (50 ms), `slow.test.ts` (20 s), and `later.test.ts` (50 ms).
It links the checkout's `node_modules`; it does not install dependencies. No
`node_modules` or fixture repository is committed. Vitest has two workers and a
40 s test timeout. Squeal uses lookup-only baseline, tier size 2, backlog tier
size 4, 60 s runner timeout, and disabled coverage/complexity in the fixture.

The exact CLI is:

```sh
node --disable-warning=ExperimentalWarning /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.407/dist/cli/squeal.mjs
```

Each following command runs with the fixture as its working directory. The
script clears inherited runner, Git and harness identities, sets a private
`XDG_RUNTIME_DIR` and `XDG_CONFIG_HOME`, and uses this sequence:

```sh
squeal daemon "$fixture"
squeal status --json
squeal status --wait 60000 --json fast.test.ts slow.test.ts
# While that named wait runs:
squeal status --json fast.test.ts slow.test.ts
squeal status --wait 1500 --json fast.test.ts
squeal status --wait 1500 --json later.test.ts
# The edited variant adds a comment to later.test.ts before its wait,
# and gives that wait 10000 ms instead of 1500 ms.
squeal status fast.test.ts later.test.ts
squeal status --json fast.test.ts slow.test.ts later.test.ts
# After the original named wait ends:
squeal status --wait 20000 --json fast.test.ts slow.test.ts later.test.ts
squeal stop "$fixture"
```

Here `squeal` abbreviates the exact Node command above. All waits are named.
`events.json` records command return times, codes, load and versions. Raw status
JSON and text are retained alongside it. `store-*.json` contains read-only SQL
snapshots of keys, results and runs; the queries are in `store()` in the probe.
The initial unedited run predated the automatic SQL snapshots: its `store-mid`
and `store-final` were captured separately with the same queries at their
recorded timestamps; it has no `store-before-end`. The edited run uses the
script's automatic snapshots. Later edits only formatted the script and removed
an unused import.

Both fixture daemons exited 0 after `stop`. Temporary fixture repositories are
left for inspection under the roots recorded in `events.json`; they are outside
the project worktree. No other daemon or existing hold was changed.

The shared dependency link produced a diagnostic that pnpm's installed lock did
not describe two existing fixture packages. Squeal fell back to dependency
`package.json` hashes. This is recorded in the status JSON, not hidden. The
original fast and slow keys stayed equal before and after their runs.
