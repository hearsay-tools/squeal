# Issue 305 throwaway probe

Run from the repository root:

```sh
pnpm exec tsx docs/specifications/011-core/research/probes/issue-305/probe.ts
```

Synthetic, in-process experiment of production `selectNarrow` and
`narrowAnswer`. Runner answers, inventory and scheduler clock hooks are stubs.
The default `tests` group owns the listed control. Nothing creates a daemon,
runner process, store, test file, Git index or HOME. No dependencies belong here.

It demonstrates an inventory boundary and the CLI's immediate empty-selection
answer. It does **not** reproduce discovery, a real untracked file, the original
configuration or startup latency. See [findings](../../issue-305.md).
