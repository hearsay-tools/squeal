# Issue 161 throwaway probes

Throwaway research, not product tests. Run from the Squeal checkout:

```sh
node docs/specifications/011-core/research/probes/issue-161/probe.mjs idle > docs/specifications/011-core/research/probes/issue-161/output.jsonl 2>&1
node docs/specifications/011-core/research/probes/issue-161/probe.mjs running > docs/specifications/011-core/research/probes/issue-161/running.jsonl 2>&1
node docs/specifications/011-core/research/probes/issue-161/probe.mjs excluded > docs/specifications/011-core/research/probes/issue-161/excluded.jsonl 2>&1
```

Run sequentially. Each invocation checks one-minute load against CPU count,
then creates `.fixture/` here as an independent Git repository. It refuses an
existing fixture. The first excluded invocation met this guard before live work;
`guard-refusal.txt` preserves it. The successful invocation followed cleanup.

The probe uses the installed 0.1.414 CLI/daemon bundle directly, with a SHA-256
recorded in each log, and links the checkout's existing Vitest 5.0.3 dependencies.
No install or build. No `node_modules`, nested Git repository, database or socket
is committed. The fixture has its own Git common directory, Squeal store and
socket identity. Only its foreground daemon is stopped. Squeal's own ephemeral
socket and daemon scratch paths follow its normal runtime layout outside the
fixture; no existing daemon, store, policy or hold is altered.

Baseline is lookup-only. A named wait obtains the reader's baseline verdict.
A new included `src/added.test.ts` is created, queried, committed and queried
again. The reader uses `readFileSync` on that path, with runtime observation on.
Each case waits 32 seconds before its last query, covering one idle reconciliation
interval. CLI children and the test gate have finite timeouts. Cleanup removes
only the generated fixture after its daemon exits.

- `idle`: query the new file before and after commit.
- `running`: edit the reader, wait for its `.git/entered` marker, then add and
  commit the new file before releasing the test gate. Scheduler cancellation is
  allowed, so the marker proves entry, not continued execution throughout a query.
- `excluded`: set Vitest's `exclude: ['src/added.test.ts']` before startup. This
  negative control verifies reader selection without an own-test verdict.

The first idle capture preceded adding the mode switch and reader gate to the
script. Its default configuration, test assertion and query sequence are the same;
its first JSON line has no `mode` field. Logs contain complete CLI stdout/stderr,
argument arrays, exit codes and elapsed milliseconds. `issue.json` is the fetched
issue plus comments. `incident-ref.txt` preserves GitHub's 404 for the incident
commit named in the issue. Results and limits are in `../../issue-161.md`.
