# Throwaway issue 264 probes

These scripts record a bounded synthetic experiment, not a replay of the original Squawk break commit. See [the findings](../../issue-264.md) for commands, versions, load, results and limits.

Run only in a task-owned boat.dev sandbox. Each script creates its own scratch git repository under `/tmp`. Keep its dependencies out of this repository. The node:test script has no dependencies. Before the Vitest script, create its scratch repository and install exactly Vitest 5.0.3 there. Set `SQUEAL_CLI` to the copied shipped CLI.
