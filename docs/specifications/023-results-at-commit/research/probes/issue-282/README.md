# Issue 282 source probe (throwaway)

Run from the repository root: `pnpm exec tsx docs/specifications/023-results-at-commit/research/probes/issue-282/probe.mjs`.
It calls the production `needsOf`, `heldAt` and `listingsHeld` functions against
this checkout's tracked `src/runners/` directory and a tracked file within it.
It reads git and directory names only; no tests, daemon, install or commit is
started. It skips when one-minute load exceeds online CPUs. It verifies the
predicate mismatch, not the original Squawk proof or the provenance of a result.

On Squeal 0.1.636, checkout `65d90b0fd07946ece721f7cbcf3bd8729f2115da`:

```json
{"load":9.62,"cpus":16,"folder":"src/runners/","proofPreflightNeeds":"src/runners/","commitHoldsBlob":true,"commitHoldsFolderAsBlob":false,"commitDaemonListingHeld":true,"blobPreflightNeeds":null}
```

Exit 0, 0.44 seconds wall time. No dependencies are added.
