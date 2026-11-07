# Issue 164 throwaway probe

This is a throwaway research fixture, not a product test or implementation.
It runs the committed Pi CLI bundle in separate Node processes. It creates a
synthetic repository and store under `/tmp`, then deletes them in `finally`.
It never starts Pi, a model, a daemon, or a test suite. It does not access the
shared repository store. The child environment contains only PATH, isolated
HOME/TMPDIR/XDG_STATE_HOME, and a synthetic PI_SESSION_ID.

From the repository root:

```sh
pnpm exec tsx docs/specifications/009-pi-adapter/research/probes/issue-164/probe.ts > docs/specifications/009-pi-adapter/research/probes/issue-164/output.jsonl
```

The script checks the one-minute load before the probe and before each CLI
process. It stops if load exceeds the CPU count. `output.jsonl` records the
version, commit, load, exact argv, exit codes, stdout, stderr and assertions'
final verdict. `<repo>` substitutes the repository root; `<scratch>` substitutes
the unique temporary directory. These substitutions affect logs only. No
`node_modules` or generated store belongs in git.

The store is deliberately minimal: one revision and no listed tests or daemon.
Only the registered-consumer control adds a synthetic consumer record. Thus the
probe establishes the status notice behavior, not live test delivery or daemon
lifecycle. It does not execute the installation commands printed in notices.

Final affected-check command (exit 3, no matching test closures; stale heartbeat):

```sh
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 docs/specifications/009-pi-adapter/research/issue-164.md docs/specifications/009-pi-adapter/research/probes/issue-164/probe.ts docs/specifications/009-pi-adapter/research/probes/issue-164/README.md docs/specifications/009-pi-adapter/research/probes/issue-164/output.jsonl
```
