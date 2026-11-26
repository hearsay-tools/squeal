# Issue 291 throwaway probe

Run from the repository root:

```sh
pnpm exec tsx docs/specifications/011-core/research/probes/issue-291/probe.ts
```

This small in-process synthetic experiment exercises production request bookkeeping,
startup-holder rendering and selection verdict code. The startup gate and elapsed
clock are synthetic. No daemon, runner, socket, store or home directory is created.
It does not reproduce the original repository or measure real startup latency.
No dependencies or node_modules belong here. See ../../issue-291.md for findings.
