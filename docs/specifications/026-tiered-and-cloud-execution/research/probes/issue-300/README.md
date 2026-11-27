# Issue 300 throwaway probe

Run from the repository root:

```sh
pnpm exec tsx docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-300/probe.ts
```

This is a research fixture, not a regression test. It imports the real lane,
comparison and blob-reading sources. Its runner adapters, remote responses and
invalidation delivery are stubs. Four tiny temporary Git repositories are
removed in `finally`. No SSH, Agent37, provider acquisition, daemon, scheduler,
shared store or test runner starts. `node_modules` stays out of this folder.

The cases inject config drift, persistent proof refusal, one repairable proof
refusal, and a newly written helper with a delivered invalidation. All use
`whenLost: "not-run"` and remote planning. Counts named `remoteRunRequests` count
adapter calls, including refusals before execution, not executed tests.

`result.json` is the captured output on 2026-11-27 from Squeal source 0.1.656,
commit `2f10594e6e8b32bfec773e200e59ad94eadb392b`, Node v26.13.0. The assertions
passed, exit 0. It proves the conditional lane behaviour, not the cause of the
reported real-worktree drift or the CLI's UNKNOWN aggregation.
