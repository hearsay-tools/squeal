# Issue 240 throwaway probe

This is a disposable research fixture, not a regression suite. Run from the checkout:

```sh
node --disable-warning=ExperimentalWarning docs/specifications/011-core/research/probes/issue-240/probe.mjs > docs/specifications/011-core/research/probes/issue-240/output-static.jsonl
OBSERVE=1 node --disable-warning=ExperimentalWarning docs/specifications/011-core/research/probes/issue-240/probe.mjs > docs/specifications/011-core/research/probes/issue-240/output-observed.jsonl
```

`SQUEAL_CLI` can select another absolute installed launcher. By default it resolves
`~/.codex/plugins/data/squeal-hearsay/bin/squeal`. It links the checkout's existing
node_modules, installs nothing, and starts and stops only its newly created Git
fixture under `.fixture-*` here. The fixture is removed after a successful stop.
It skips if load1 exceeds the online CPU count. No repository suite runs.

Both legs enable runtime-input observation. `OBSERVE=1` changes the ignored
control from a static import to `readFileSync`. The initial static run omitted
the explicit `observe` setting, whose installed default is true. The checked-in
script now spells that default out. An intermediate repeat explicitly enabled
observation but still used the static control; its output is retained separately
as `output-observed-static-control.jsonl`.

Each leg runs two named fixture tests to establish its baseline, then creates and
deletes 120 TS files twice under `packages/pkg/src/lint-base/`, excluded by
`.git/info/exclude`. Four seconds after each mutation it reads status and the
fixture's store read-only. It finally edits a tracked input and an ignored input
that a test actually reads. Output preserves command results, keys, revisions,
runs, closures and observed maps; fixture and home paths are normalized.
