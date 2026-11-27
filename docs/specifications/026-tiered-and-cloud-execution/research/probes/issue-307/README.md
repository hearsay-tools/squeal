# Issue 307 throwaway probe

Run from the repository root, below the CPU-count load threshold:

```sh
pnpm exec tsx docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-307/probe.ts > docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-307/result.json
```

Uses the real `withRemoteLane`, `importClosure`, Git tree membership and blob hashing on two tiny temporary trees. The transport, runner and Vite transform are synthetic. A newly added tracked directory exists locally; the changed importer is delivered to the second tree, but delivery of the added file is deliberately withheld. The synthetic transform throws a missing-import error when that file is absent. The real graph walker decides which paths survive that error, and the real lane decides whether the returned file-level error is proven.

Two cases: the graph as returned, then a control that explicitly adds the missing file to its proof paths. The first repeats a lane run without new invalidations, then delivers the addition and checks recovery. The second checks the lane's existing resend when the candidate is known. Actual file hashes decide mismatches. Assertions cover errors, request counts, resend and zero local runs. Temporary trees are removed in `finally`.

No real Vitest, SSH, Agent37, daemon, scheduler, store, full suite or cloud resource runs. No real configuration or held resources change. This models the resulting tree delta of a rebase, not the Git rebase operation. It deliberately omits runtime observations: whether the real transform and observation pipeline expose the missing import remains open. A second `lane.run` models the repeated execution portion of retry, not the CLI retry's full invalidation/keying behavior.

Recorded run: source 0.1.665, exit 0, about 0.33 s command wall time. The initial run exited 1 because this probe's synthetic file error used the wrong shape (`error` instead of `errors`); corrected before recording the successful output. That was a probe construction error, not a product failure.
