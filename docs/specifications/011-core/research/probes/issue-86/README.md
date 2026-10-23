# Probe: issue 86 (throwaway)

Throwaway fixture for `research/issue-86.md`. Not product code; delete freely.

- `probe.ts` creates a fresh synthetic store under `mkdtemp(/tmp/i86-*)` with the worktree's `src/` (0.1.279), calls `askRetry` with the `retry` CLI's busy timeout (`CLI_SOCKET_TIMEOUT_MS`, 2,000 ms) while `holder.mjs` holds the store's write lock, prints the outcome and the record count, and deletes the directory. It never opens the shared live store.
- `holder.mjs` opens the synthetic store, takes `BEGIN IMMEDIATE`, holds it for the given milliseconds, commits.
- The probe refuses to run when the one-minute load is above the CPU count.

Command, from the worktree root: `timeout 120 npx tsx docs/specifications/011-core/research/probes/issue-86/probe.ts`. Output: `output-run1.txt`.
