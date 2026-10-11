# Probes for `fresh-worktree-reuse.md` (001-218)

Throwaway. Not product code, not tested, kept as the record of how the findings were measured. Nothing here is imported by Squeal.

- `store-query.mjs <store.sqlite> "<sql>"`: one read-only query against a Squeal store (`node:sqlite`, `readOnly`).
- `closure-diff.mjs <store.sqlite> <rootA> <rootB> <test path>...`: hashes every path in a test file's stored closure in two checkouts and prints the ones that differ. A directory is shown by its entry names.
- `observed-stats.mjs <store.sqlite>`: counts the shared observed sets' entries per project, and the entries that are JSON spawn records or contain a UUID.
- `env-probe.ts <worktree root>`: runs Squeal's own `createVitestAdapter(...).environment()` and prints each project's environment-hash inputs, with `resolvedConfig` and `packages` shortened to hashes. `PROBE_DUMP=<prefix>` also writes each project's canonical config.
- `deps-probe.ts <root>...`: Squeal's `installedDependencies` and `staleHiddenLockfile` for each root.

The two `.ts` probes take `SQUEAL_SRC=<a Squeal checkout>/src` and need that checkout's `node_modules` resolvable from it. They ran with the scratch cezar worktree's `tsx`:

```
SQUEAL_SRC=<copy>/src <cezar worktree>/node_modules/.bin/tsx env-probe.ts <cezar worktree>
env -u CLAUDECODE -u CLAUDE_CODE -u AI_AGENT SQUEAL_SRC=... tsx env-probe.ts <cezar worktree>
env CI=1 SQUEAL_SRC=... tsx env-probe.ts <cezar worktree>
```

`evidence/` holds those three runs on the cezar worktree at `c07b0bfc`. `environment-<variant>.json` is the per-project output; `contract-config-<variant>.json` is the `contract` project's canonical config. `mine` is a Claude Code session's env, `noagent` has the three agent variables unset, `ci` adds `CI=1`.

The daemon runs used pinned copies of the hub bundles (`node <copy>/dist/cli/squeal.mjs start <root>`, `status`, `why`, `stop`). The scratch worktrees were `git worktree add --detach <tmp>/cezar-sN c07b0bfc` plus `npm ci`, and were removed after the measurements.
