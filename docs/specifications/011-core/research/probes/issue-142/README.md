# Issue 142: throwaway probe

This is a synthetic CLI reproduction, not a product test or a real discovery run.
It creates a temporary Git repository, seeds its private Squeal store, and serves
a stand-in daemon socket. It invokes the **installed 0.1.390 CLI**, checks its
SHA-256 against that runtime's manifest, and removes the fixture when done.
It starts no daemon or runner and changes no existing repository's store or holds.
No dependencies or `node_modules` belong in this directory.

From the Squeal repository root:

```sh
pnpm exec tsx docs/specifications/011-core/research/probes/issue-142/probe.mts > docs/specifications/011-core/research/probes/issue-142/output.txt 2>&1
```

An optional first argument replaces the version directory. The probe requires
version 0.1.390. Each invocation checks one-minute load against CPU count and
skips the case if load is higher. Each CLI wait requests 1,500 ms.

The store-seeding imports come from checkout `8ce4f23fc18c67cb1259b894fed74f395c0c02b5`
(package 0.1.393). Store, identity, socket and relevant status sources are unchanged
from release `squeal--v0.1.390`, commit `ee3531548ed52c4ba692b48b0ae430d9c4965e48`.
The tested CLI comes directly from the installed bundle, with no build or edits.

`output.txt` records the final six-case run: runtime hash, load, exact child argv,
working directory, exit code, elapsed time, selected JSON fields, and the complete
CLI stderr text as a JSON string (including whitespace). The selected fields are
a projection of stdout, not a full snapshot.
Socket request counts are cumulative. The final passing result is deliberately
injected into the fixture; no test passed in a runner. It checks the existing
accept-after-sync rule only. Assertion success does not mean a product suite ran.
