# Policy

## When an edit is denied

With policy `interrupt.onRegression` on (the default), the first file edit after a new regression is denied once. The denial lists the failing checks and says the edit was not applied. The same edit can be re-issued; the same regression does not deny twice.

## When Stop keeps you going

`stop.blockOnKnownFailures` and `stop.requireFullSuite` can keep you going at Stop, once per stop. The message names the failures, or the missing full-suite checkpoint. Failures whose re-run is still pending are named as pending, with the revision they last failed at, and do not block.

## Policy keys

`squeal.config.json` at the repository root, committed. Every key is optional; `squeal init` writes all of them with their defaults.

| Key | Default | Meaning |
| --- | --- | --- |
| `interrupt.onRegression` | `true` | Deny one edit when a check newly fails. |
| `stop.blockOnKnownFailures` | `false` | Keep the agent going at Stop while failures exist at the current revision. Failures whose re-run is still pending are named as pending, with the revision they last failed at, and do not block. Blocks once per stop. |
| `stop.requireFullSuite` | `false` | Keep the agent going at Stop until a full-suite run completed at the current revision. Blocks once per stop. |
| `stop.waitMs` | `0` | At Stop, wait this long for pending checks of the current revision. Capped at 1500 ms by the 2 s hook timeout. |
| `baseline.onStart` | `"lookup-then-run-missing"` | On daemon start, reuse stored results and run the rest, or `"lookup-only"`. |
| `inputs` | `[]` | Extra files (globs) that test files read at runtime, so a change to them re-runs those tests. A list applies to every test file. A map from test-file glob to input globs applies to the matching test files only, for example `{"test/harness/plugin.test.ts": ["plugins/claude-code/dist/**"]}`. Keys and globs match worktree-relative paths from the start of the path to its end: `"plugin.test.ts"` matches only a file at the root, `"**/plugin.test.ts"` one in any directory. A key that matches no test file, or a glob that matches no file, gets a note in `squeal status`. |
| `env.allowlist` | `[]` | Environment variables whose values are part of a result's identity. |
| `runner.tierSize` | `4` | Test files per run. |
| `runner.timeoutMs` | `600000` | Limit per run; `null` for none. |
| `nodeTest` | `[]` | node:test projects validated beside Vitest. Each entry has `name` (unique), `include` (test-file globs relative to `cwd`, at least one) and optionally `exclude`, `cwd` (relative to the repository root, default the root), `node` (executable path or name, default `node` on the daemon's PATH), `argv` (the flags before `--test`, in order, for example `["--import", "tsx"]`) and `env` (variables merged over the daemon's environment). A bad entry is skipped with a note in `squeal status`; the other projects are kept. Results arrive once the node:test runner lands; until then a configured project lists no test files. |
| `daemon.idleExitMinutes` | `60` | The daemon exits after this long with no registered session. |
| `store.retentionDays` | `7` | Results for file contents no worktree has any more are dropped after this many days. |
| `store.maxSizeMb` | `null` | Size cap of the store; `null` for none. |
