# Issue 249 probe

Throwaway research, not a regression test or implementation. Run from the repository root, with its existing pnpm installation:

```sh
timeout 90s pnpm exec tsx docs/specifications/011-core/research/probes/issue-249/probe.ts
```

The script prints uptime, CPU count, load, source version and SHA before starting. It skips when one-minute load exceeds CPU count. It runs three tiny Vitest tests in a temporary directory, then calculates source-core closure keys across scripts-only manifest edits. No live project manifest changes, no daemon and no installation. The temporary directory and dependency link are removed on completion. `output.txt` is the one recorded run; see `../../issue-249.md` for its negative reproduction verdict and limits.
