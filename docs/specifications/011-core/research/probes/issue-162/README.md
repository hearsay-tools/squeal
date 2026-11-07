# Issue 162 throwaway probe

This is a throwaway research fixture, not a product test. It starts no daemon.
Run from the repository root with the installed dependencies:

```sh
pnpm exec tsx docs/specifications/011-core/research/probes/issue-162/probe.ts /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.414/dist/cli/squeal.mjs
```

Before each case it compares `os.loadavg()[0]` with
`getconf _NPROCESSORS_ONLN`. It skips the case when load exceeds that count.
Each case creates a temporary Git repository and initializes its own store
through the checked-out `openStore`. The locked case holds `BEGIN IMMEDIATE`
on that store while the installed CLI runs a harmless marker child. The
unlocked case is the control. The child reads hold rows and writes a marker
only inside the temporary repository. A 15-second child timeout bounds each
hold invocation. The probe releases its lock and removes its temporary
repository in `finally`. It never reads or changes an existing repository's
store or holds. Keep `node_modules` out of git.

`results.jsonl` preserves the first run, before this fixture moved from
`research/probes/issue-162/` to this directory on the parent's instruction.
Only the relative source import changed in that move. Each JSON line records
the exact CLI argument array, runtime version, host gate, exit code, output,
marker and hold rows. `results-relocated.jsonl` records verification from the
final location.
