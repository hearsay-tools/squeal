# Issue 82 throwaway probe

This is a research fixture, not a repository test suite. It uses three node:test
files in a fresh temporary Git repository and a second worktree of that repository.
It needs no installed test dependencies. It keeps `baseline.onStart: "lookup-only"`
throughout. It changes no existing repository or daemon and keeps the host's shared
capacity pool. Its own fixture daemons are stopped in cleanup.

From the Squeal repository root:

```sh
python3 docs/specifications/011-core/research/probes/issue-82/probe.py "$PWD/plugins/claude-code/dist/cli/squeal.mjs"
```

The probe checks load before creating the fixture. Above the CPU count it exits
without running any daemon or test. Otherwise it seeds passing results, checks
the selected check's inherited origin in the second worktree, stops that daemon,
changes a shared source, and starts it under lookup-only. It checks the stale
wait's exit 3, retries one exact test path, waits for exit 0, and checks that the
other affected file stays stale. The third file should remain current.

`output.txt` records the 2026-10-23 attempt: **skipped at load 30.36 / 24 CPUs**.
The fixture body has not been executed. Only Python syntax was checked.
`cli-output.txt` records separate version, help and invalid-argument checks against
the committed 0.1.276 bundle. Those checks start no daemon and run no tests.
