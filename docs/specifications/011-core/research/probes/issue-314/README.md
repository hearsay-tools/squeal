# Issue 314 probe

Throwaway research probe, outside the normal test suite. It uses the real scheduler,
store, SQLite group slot, remote lane, in-process proxy and tree host, with fake
runner adapters. It creates temporary fixture repositories and deletes them through
the existing fixtures' cleanup. It creates no cloud machine, SSH session or browser.

From the repository root:

```sh
pnpm exec vitest run --config docs/specifications/011-core/research/probes/issue-314/vitest.config.ts docs/specifications/011-core/research/probes/issue-314/refusal.test.ts --reporter=verbose --silent=false
```

The scheduler's two-file repository and the remote lane's fixture repository are
separate. The first file's run is delegated to the real remote lane, whose closure
includes a locally present git-ignored input. The second file uses the scheduler
fixture's fake successful runner. Assertions check that the group holds its one
slot during each run, releases it after refusal, and runs the second named request.
This exercises the refusal-to-cleanup path, not the complete reported daemon setup.
