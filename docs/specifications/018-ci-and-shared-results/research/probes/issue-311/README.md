# Issue 311 throwaway probe

This probe uses no test runner and makes no application writes while the spy is installed. It creates the real evidence recorder before replacing `fs.writeFileSync`, then records one input read and flushes it. It restores the function and removes its temporary directory.

Run from the repository root:

```sh
node docs/specifications/018-ci-and-shared-results/research/probes/issue-311/probe.cjs "$PWD/src/runners/ci-runtime/evidence.cjs"
node docs/specifications/018-ci-and-shared-results/research/probes/issue-311/probe.cjs ~/.codex/plugins/data/squeal-hearsay/versions/0.1.665/dist/ci/evidence.cjs
```

Exit 0 with `spyCalls: 1` reproduces interference. Exit 1 means no intercepted write. The probe skips when one-minute load exceeds the CPU count.
