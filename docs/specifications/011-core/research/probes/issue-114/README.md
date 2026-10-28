# Throwaway issue 114 probe

This is research evidence, not a product test. It runs the checkout's real retry CLI function, scheduler, store and slow-slot code with the existing fake runner from `test/scheduler/claims-fixture.ts` and a socket acknowledgement from `test/cli/fake-daemon.ts`. It creates and removes an isolated temporary repository and slow-slot directory. It does not start or stop a product daemon or alter a production hold.

From the repository root, with its already-installed pnpm dependencies:

```sh
pnpm exec vitest run --config docs/specifications/011-core/research/probes/issue-114/vitest.config.ts docs/specifications/011-core/research/probes/issue-114/probe.test.ts > docs/specifications/011-core/research/probes/issue-114/result.txt 2>&1
```

The final assertions prove that “runs once more now” can accompany a retry queued behind fast work and then an occupied slow slot. Release produces exactly one extra slow run. `evidence.json` records the successful run; the report pins its source version. Rerunning overwrites that evidence. The code refuses to run when one-minute load exceeds available CPU count. No dependencies are installed here; keep `node_modules` out of git.

The short held promises and lock prove ordering, not a 68-minute real-world wait. The synthetic runner cannot cancel. During its fast run the slow-activity marker is absent, so the probe reads the queued key and the fast runner's active count. It does not claim full end-to-end daemon or browser coverage.
