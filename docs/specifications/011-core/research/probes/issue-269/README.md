# Issue 269 throwaway probe

Synthetic delivery probe, not a regression test. It imports the checkout's source and supplies an in-memory store double. It starts no daemon, browser or test runner. Run from the repository root:

```sh
pnpm exec tsx docs/specifications/011-core/research/probes/issue-269/probe.ts
```

The browser project name represents an on-request group. The mixed-policy header allows some edit group; the control disables all edit groups. The probe does not exercise policy discovery, a Git checkout, hook acknowledgement, or restart recovery.
