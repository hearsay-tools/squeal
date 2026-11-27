# Issue 306 throwaway probe

Run from the repository root:

```sh
pnpm exec tsx docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-306/probe.ts > docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-306/result.json
```

Uses the real remote lane, blob hashing and Git tree membership with two small temporary directories. Git tracks the local inputs. The remote adapter is synthetic: invalidation copies bytes, and runs return actual blob hashes from the second directory. No Vitest, SSH, provider, daemon or store runs. No real HOME/config changes. Temporary directories are removed in `finally`.

Three scenarios: eight settled edits with delivered invalidation; one local edit after expected hashes were captured but before the remote reply; and an edit during each of the two attempts, followed by an explicit new run after edits settle. The race is deterministically injected at the adapter boundary without delivering a watcher event during that window. Changed file lengths avoid timestamp-resolution dependence. Assertions cover request counts, completion/refusal and zero local execution.

This tests a possible proof-race mechanism, not the timing frequency, automatic scheduler recovery, or the original Agent37/server incident. It starts only below the CPU-count load limit. No dependency install or full suite is needed.
