# Issue 303 throwaway probe

This is research, not a product test. Run from the repository root:

```sh
pnpm exec tsx docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-303/probe.ts
```

It imports the source Git bootstrap, keeper and tree host, and the existing
`fakeSshAt` helper. Real Git operates on one tiny temporary repository; the SSH
helper executes the shipped remote shell commands locally in a separate temporary
home. It uses no network, daemon, production VM or installed runner bundle. It
removes its fixture in `finally`; it installs no dependencies. It refuses to run
when the one-minute load exceeds the available CPU count.

`result.txt` is the observed output on 2026-11-27 at source commit
`06c08dc790af8844d1c7d7c90a583b04d5dca682` (0.1.658). The result reproduces
staged-index drift and shows explicit refresh after commit repairs it. It does
not reproduce cached result reuse through a live Squeal daemon.
