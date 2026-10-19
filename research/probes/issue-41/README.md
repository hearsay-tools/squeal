# Issue 41 throwaway probe

Throwaway research, not product tests. Run from the repository root with Node 24.21.0:

```sh
node --experimental-transform-types --disable-warning=ExperimentalWarning --import ./research/probes/issue-41/source-loader.mjs research/probes/issue-41/probe.mjs
```

No npm install, build, test suite, daemon or external service is needed. The loader resolves this checkout's `.js` imports to its `.ts` sources; Node transforms the TypeScript. The probe refuses to run when one-minute load exceeds available CPU count.

The fixture uses a temporary Git repository and linked worktree under ignored `.tmp/`, a real SQLite store, the real scheduler and state sink, and a synthetic runner that returns passing results without executing tests. A heartbeat row is seeded to exercise live status formatting; there is no daemon at its socket. The fixture is deleted in `finally`.

1. Warm one test file in the first worktree.
2. Start the linked worktree with four listed test files and `lookup-only`. Assert one file's results are inherited, no runner invocation occurs, and the other three files have null pending phases and count as unknown.
3. Change the helper in the inherited file's closure and submit a watch batch directly. Assert only that file runs, no run remains open, and the other three stay unknown.
4. After closing the scheduler, remove those three unknown rows and seed 553 unrelated queued rows. Render real status and a synthetic completed edit wait for 91 files. This recreates the reported phrases, but proves no scheduler produced those queued rows or waited on 91 real files.
5. Render a load retry at 7.45 on 24 CPUs. This probes wording only, not an actual retry.

Expected last line:

```text
PASS: lookup-only scheduler keeps misses unknown; queued wording requires queued stored rows in this probe.
```

During development, probe assertions were corrected to read `inherited.count` (not `.length`) and to get the phase summary from `waitLine` (not `formatStatus`). These were probe mistakes, not product failures. See the findings for the final successful run and limits.
