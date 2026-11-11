# Issue 176 throwaway probes

These probes are research fixtures, not product tests. They create private Git
repositories under `os.tmpdir()`, each with its own store and daemon. They never
open another repository's store or stop another daemon. The fixtures contain no
test files. Their dependency symlink stays outside Git. No build is needed.

From the Squeal repository root, with its installed dependencies:

```sh
node docs/specifications/011-core/research/probes/issue-176/probe.mjs > docs/specifications/011-core/research/probes/issue-176/output.jsonl
node docs/specifications/011-core/research/probes/issue-176/probe.mjs async-stop >> docs/specifications/011-core/research/probes/issue-176/output.jsonl
```

Each mode checks one-minute load against `os.cpus().length` before it starts.
Above that count it skips the mode. A daemon has a 35-second kill bound; each CLI
child has an eight-second bound. Cleanup targets only the spawned daemon and
the freshly created fixture directory.

- `async`: Vitest config awaits a 14-second timer before returning an empty test
  include. Observe status and a one-second group request while it waits.
- `sync`: the same config uses `Atomics.wait` for 14 seconds on the daemon's main
  thread. This uses no CPU loop. Observe the same calls.
- `lock`: a diagnostics-channel preload acts at the existing `store-open` test
  seam. A child holds `BEGIN IMMEDIATE` on the fixture's store for four seconds,
  then rolls back and closes it. Observe registration and request acceptance.
- `async-stop`: send `stop` as soon as config loading begins. The CLI child is
  killed at eight seconds if still waiting. Observe the daemon again after the
  config's timer has ended. This does not test the CLI's own 60-second bound.

`output.jsonl` is the unfiltered capture from 2026-11-11, Squeal 0.1.430,
Node 24.22.1, Vitest 5.0.3. It records each daemon command, CLI arguments, durations,
exit codes, status JSON and daemon logs. The CLI commands run in the recorded
fixture root with `XDG_RUNTIME_DIR` set to its private `runtime` directory.
`ISSUE176_ROOT` and `ISSUE176_MODE` select the preload's private lock target.

The empty lookup-only baseline can print a completed checkpoint. No test suite
ran. The daemon also runs its normal SQLite integrity check on these tiny stores;
that is not a test-suite run. The shared dependency symlink caused a pnpm lock
consistency note and fallback to manifest-based dependency keys. This fixture
does not model Cezar's dependency tree or store size.
