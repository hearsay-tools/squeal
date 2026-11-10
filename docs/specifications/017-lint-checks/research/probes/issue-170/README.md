# Issue 170 probe

Throwaway research fixture. It writes only a temporary SQLite lint store and
removes it after each case. No daemon, linter, test suite, build or network call
runs in the probe. It imports the real store reader and formatters from source.
`node_modules` must stay outside git. Run from the repository root:

```sh
timeout 30s pnpm --config.verifyDepsBeforeRun=false exec tsx docs/specifications/017-lint-checks/research/probes/issue-170/probe.ts
```

The probe checks one-minute host load against logical CPU count before making
stores. Exit 77 means skipped for load. Exit 0 means all five assertions of
**observed behavior**, including the defect, matched. It is not a fixed-behavior
regression test. The 25 source paths and blob/key strings are synthetic. The
pass control stores 25 pass results; unknown controls store no judged result.

- `output-final.txt`: final formatted probe on 0.1.425, load 7.35 / 24 CPUs;
  all five controls passed.
- `output.txt`: 0.1.425, initial run, 6.05 load / 24 CPUs.
- `output-0.1.424.txt`: initial tagged-source run, including pnpm's unexpected
  automatic install attempt and build-script refusal. Probe still exited 0.
- `output-0.1.424-clean.txt`: repeat with automatic dependency verification
  disabled, 6.45 load / 24 CPUs, all five controls passed.

Exact tagged-source repeat (no install or build requested):

```sh
set -e
probe_root=$(mktemp -d /tmp/squeal-170-tag-XXXXXX)
trap 'rm -rf "$probe_root"' EXIT
git archive squeal--v0.1.424 src package.json | tar -x -C "$probe_root"
mkdir -p "$probe_root/docs/specifications/017-lint-checks/research/probes/issue-170"
cp docs/specifications/017-lint-checks/research/probes/issue-170/probe.ts "$probe_root/docs/specifications/017-lint-checks/research/probes/issue-170/probe.ts"
ln -s "$PWD/node_modules" "$probe_root/node_modules"
probe_output="$PWD/docs/specifications/017-lint-checks/research/probes/issue-170/output-0.1.424-clean.txt"
(cd "$probe_root" && timeout 30s pnpm --config.verifyDepsBeforeRun=false exec tsx docs/specifications/017-lint-checks/research/probes/issue-170/probe.ts) > "$probe_output" 2>&1
cat "$probe_output"
```

The first tagged-source command was the same except that it omitted
`--config.verifyDepsBeforeRun=false` and wrote `output-0.1.424.txt`. This caused
pnpm to touch the linked worktree's dependency metadata. Use the disabled check
above when repeating; no package setup is needed for this research fixture.
