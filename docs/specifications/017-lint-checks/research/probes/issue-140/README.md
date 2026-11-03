# Issue 140: throwaway oxlint probe

This is research, not product code or a regression test. It changes no live
project and starts no daemon. Run it from this checkout with the already installed
pnpm dependencies:

```sh
node --disable-warning=ExperimentalWarning docs/specifications/017-lint-checks/research/probes/issue-140/probe.mjs
```

An optional argument is the released 0.1.392 `dist/cli/squeal.mjs` path. By default
it uses `/home/agent/.claude/plugins/cache/hearsay/squeal/0.1.392/dist/cli/squeal.mjs`.
The script checks its git blob against the local `squeal--v0.1.392` tag. It copies
the bundle into ignored `runtime/`, replaces only CLI entry execution with exports,
and calls its unchanged provider and lint pass. The exported pass needs the
bundle's `init_pass3()` initializer; importing its function alone is insufficient.

The fixture has 32 files and one local JS rule. Each rule creation waits 200 ms
with `Atomics.wait`, without burning CPU. One file has a seeded violation. This
models a finite slow rule, not the original ten-rule plugin or host contention.
The direct CLI uses `--format json --threads 1 --` followed by all 32 paths in
order, `src/f00.js` through `src/f31.js`. Exit 1 is expected for the seeded finding.

The probe checks one-minute load against CPU count before each measured phase.
It stops if load exceeds CPUs. It records:

1. Provider open and discovery over 32 paths.
2. A deliberately oversized 32-file provider call with the default guard.
3. Two subsequent 16-file calls, then another 32-file call.
4. Direct oxlint over all 32 files, with a 20-second outer safety bound.
5. A fresh real lint pass, recording its provider call sizes and stored states.
6. An edit that fixes the seeded violation, through the same pass.

`observations.json` is the successful run's output. `runtime/` holds disposable
fixtures and the copied release. Each fixture's ignored `node_modules` contains
only a link to this checkout's oxlint 1.90.0. No dependencies or generated runtime
files belong in git. The script closes providers and stores before exit.
