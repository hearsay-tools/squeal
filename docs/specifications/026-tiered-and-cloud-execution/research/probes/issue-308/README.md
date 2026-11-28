# Issue 308 probe (throwaway)

Synthetic remote lane only: real in-process tree host and wire protocol,
fake runner adapters, temporary Git trees. No SSH, cloud provisioning or real
package builds. The fixture cleans its trees after the run.

Run from the repository root:

```sh
pnpm exec vitest run --config docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-308/vitest.config.ts docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-308/ignored.test.ts
```

This file is outside the repository's configured test projects and Squeal's
coverage. The issue research task requires this small direct experiment.
Do not treat it as reproduction of the original application's tests or its
scheduler/status state.
