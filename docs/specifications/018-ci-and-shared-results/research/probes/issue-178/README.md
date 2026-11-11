# Issue 178 probe (throwaway)

Run from the repository root with dependencies already installed:

```sh
node docs/specifications/018-ci-and-shared-results/research/probes/issue-178/probe.mjs > docs/specifications/018-ci-and-shared-results/research/probes/issue-178/output.txt 2>&1
```

The probe uses the committed Claude Code CLI bundle. It creates a temporary
repository with two one-assertion Vitest files, records two shards with one
worker each, and exports in a fresh clone. It then provokes an unhandled error
in global setup. On the examined versions this abort writes no part. Finally,
it copies a real completed part, marks it `crashed`, and empties `testFiles` to
test the export refusal separately from runner crash classification. It checks
that the complete control exports, the mixed set refuses, and the missing
shard refuses. Assertion failures make the probe exit nonzero.

It checks the one-minute load against CPU count before each recording. It
uses installed dependencies through ignored symlinks, removes its temporary
directory, and does not start a daemon, publish results, or use the shared
store. `node_modules` is not committed. It inherits but never dumps the
environment. The log contains the actual commands, output and exit status.

`ci-log-excerpt.txt` is a selected historical log, fetched with:

```sh
gh run view 42832873309 --repo hearsay-tools/cezarion --job 129895933692 --log | rg 'refused|did not complete|squeal--v|Process completed|ci export|--parts'
```

The local probe does **not** reproduce the original cezar test's crash. It
reproduces how export handles its part state. See `../../issue-178.md` for the
contract and limits.
