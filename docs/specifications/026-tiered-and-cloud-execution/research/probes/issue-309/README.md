# Issue 309 throwaway probe

Adapted from issue 307's probe. Run from the repository root:

```sh
pnpm exec tsx docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-309/probe.ts > docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-309/result.json
```

Creates and commits a sibling module in a tiny temporary local Git tree, then deliberately sends only its importer to a second tree. Real import-closure walking, lane orchestration and blob proof decide whether a synthetic transform failure is accepted. A control includes the candidate in proof paths and checks the existing resend. Explicit delivery checks recovery. An assertion skips execution above the CPU-count load threshold. Both trees are removed.

Synthetic transport, runner and transform; no real Vitest, daemon, watcher, store, scheduler, SSH, Agent37, cloud instance, timeout or reconnect. The missed delivery is injected, not discovered. No runtime observations are returned. Real production sync loss, store currentness and later host loss remain unverified. The recorded 0.1.665 run exited 0 in about 0.74 seconds at load 3.05/16 CPUs.
