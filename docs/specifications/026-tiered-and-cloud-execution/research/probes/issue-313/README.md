# Issue 313 component probe

Throwaway research fixture. It creates and removes temporary Git repositories.
Product files stay unchanged. No browser, VM, SSH, install or suite runs.

From the repository root:

```sh
env -u NODE_OPTIONS pnpm exec tsx docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-313/probe.ts > docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-313/results.jsonl
```

The probe uses the actual remote lane, tree host, protocol, Git ignore checks,
`provenObserved` and `RuntimeFiles`, with synthetic runner observations and
completed PASS/FAIL reports. Ten assertion sets cover five cases for each
outcome: fresh ignored scratch, declared runtime file, undeclared remote-only
input, missing `unsynced` metadata, and a retained differing ignored input.
The missing-metadata case overrides only the tree host's `unsynced` answer; it
simulates an older wire reply, not a verified deployment of an older runtime.
The lane's refused report is observed; the scheduler/store UNKNOWN transition
is not run.

The probe aborts when one-minute load exceeds the CPU count. The recorded run
exited 0 on Node v26.13.0, source 0.1.667 at `7b7e595db`, load 0.32 on 16 CPUs.
