# Issue 255 throwaway probe

Run from the repository root:

```sh
pnpm exec tsx docs/specifications/018-ci-and-shared-results/research/probes/issue-255/probe.ts
```

This is a store-level probe, not a daemon or CLI end-to-end test. It creates one
SQLite fixture under the system temporary directory and removes it on exit.
It skips when the one-minute load exceeds the CPU count. It imports one synthetic
passing result before a local environment exists, records the environment as
keying does, reads the real import status formatter, and imports the same bundle
again. It asserts the first import keeps the exported key, status gives the exact
reported reason, and the second import stores the local key. It runs no suite.
The fake runner descriptor and blob represent the accepted `allowOnly` difference
from spec 018 D10; no test code runs and no result is used outside this fixture.
