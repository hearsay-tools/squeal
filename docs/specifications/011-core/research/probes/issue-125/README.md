# Issue 125 throwaway probes

Research only. No product behavior or configuration changes. This directory is
outside the normal Vitest include and is not validated by the Squeal daemon.
Dependencies come from the existing worktree `node_modules`; none are copied or
committed here. Helpers create temporary stores outside the repository and remove
them after each check. The two real Node children exit within seconds. No daemon
is started or stopped, and no existing hold is changed.

From the repository root:

```sh
python3 docs/specifications/011-core/research/probes/issue-125/run.py
```

The runner records one-minute load and CPU count, skips when load exceeds CPUs,
and otherwise executes exactly this command with a 60-second subprocess timeout:

```sh
pnpm exec vitest run --config docs/specifications/011-core/research/probes/issue-125/vitest.config.ts docs/specifications/011-core/research/probes/issue-125/selection.probe.ts docs/specifications/011-core/research/probes/issue-125/hold.probe.ts --maxWorkers=1 --reporter=verbose
```

`load.json` and `output.txt` retain the final run. An initial run before removing
unused fixture helpers also passed all four checks (8.37 s, load 10.2671/24);
the final run took 8.36 s at load 12.1450/24. These are probe wall times, not
estimates for a parity gate. The shell's Node is v24.22.1; Vitest reported 5.0.3.

`selection.probe.ts` reduces the fixture from
`test/scheduler/promoted-tier-select.test.ts`. It asks the real selector for a
single tier of 12 promoted whole-file identities beside three backlog files,
with and without one queued edit. No CPU pool or test runner executes those
identities; durations are unknown. It tests selection, not throughput.

`hold.probe.ts` calls the real wrapper and `CommandHold` against temporary stores.
Daemon replies are synthetic. One check observes the real hold timer expire
while a child remains alive; the other never acknowledges settled cancellation
and observes the wrapper start its child after the default three-second wait.
The child exit codes are evidence only, not imported test verdicts.

Source and version commands used:

```sh
gh issue view 125 --repo hearsay-tools/squeal --json title,body,comments,url
gh issue view 123 --repo hearsay-tools/squeal --json title,body
gh issue view 121 --repo hearsay-tools/squeal --json title,state,comments
gh issue view 79 --repo hearsay-tools/squeal --json title,body,comments
gh release view squeal--v0.1.377 --repo hearsay-tools/squeal --json tagName,publishedAt,url
git rev-parse HEAD
git log -1 --format='%H %s' squeal--v0.1.377
git diff squeal--v0.1.377 HEAD -- src/core/scheduler/promoted-tier.ts src/core/scheduler/yield-sooner.ts src/cli/hold.ts
git diff squeal--v0.1.374 HEAD -- src/cli/hold.ts
git diff squeal--v0.1.374 HEAD -- src/core/scheduler/command-hold.ts
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal --version
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal --help
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --full
```

Both source comparisons for `hold` were empty. The source comparison against the
release tag was empty. Biome was attempted with the three TypeScript paths:

```sh
pnpm exec biome check --write docs/specifications/011-core/research/probes/issue-125/selection.probe.ts docs/specifications/011-core/research/probes/issue-125/hold.probe.ts docs/specifications/011-core/research/probes/issue-125/vitest.config.ts
```

It ignored all three paths under the repository configuration, exit 1 and zero
files processed. No lint pass is claimed. No external 56-file gate or product
full suite ran. See [findings](../../issue-125.md) for conclusions and limits.

The affected-status check (exact command and output in `squeal-status.txt`)
returned exit 3 because no test closure holds the three TypeScript probe paths.
The daemon reported known failures 0 and all 1321 test files current. Those
existing results do not validate these probes; the explicit run above does.
