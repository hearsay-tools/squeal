# Policy

## When an edit is denied

With policy `interrupt.onRegression` on (the default), the first file edit after a regression is denied once: a check that passed in this worktree, or passed where its result was inherited from, fails now. The denial lists those checks and says the edit was not applied. A failure first observed, from Squeal's run at start or from a test file just written, never denies; it arrives with the next tool call. The same edit can be re-issued; the same regression does not deny twice.

## When Stop keeps you going

`stop.blockOnKnownFailures` and `stop.requireFullSuite` can keep you going at Stop, once per stop. The message names the failures, or the missing full-suite checkpoint. Failures whose re-run is still pending are named as pending, with the revision they last failed at, and do not block.

## Policy keys

`squeal.config.json` at the repository root, committed. Every key is optional; `squeal init` writes all of them with their defaults.

| Key | Default | Meaning |
| --- | --- | --- |
| `interrupt.onRegression` | `true` | Deny one edit when a check that passed here fails. |
| `stop.blockOnKnownFailures` | `false` | Keep the agent going at Stop while failures exist at the current revision. Failures whose re-run is still pending are named as pending, with the revision they last failed at, and do not block. Blocks once per stop. |
| `stop.requireFullSuite` | `false` | Keep the agent going at Stop until a full-suite run completed at the current revision. Blocks once per stop. |
| `stop.waitMs` | `0` | At Stop, wait this long for pending checks of the current revision. Capped at 1500 ms by the 2 s hook timeout. |
| `stop.requireSlowSuite` | `false` | Keep the agent going at Stop while a slow file (see `slow.include`) is not current at the current revision, naming the slow files and that `squeal run --slow` runs them. Blocks once per stop. |
| `baseline.onStart` | `"lookup-then-run-missing"` | On daemon start, reuse stored results and run the rest, or `"lookup-only"`. |
| `inputs` | `[]` | Extra files (globs) that test files read at runtime and Squeal cannot observe (see `observe.runtimeInputs`), so a change to them re-runs those tests. A list applies to every test file. A map from test-file glob to input globs applies to the matching test files only, for example `{"test/harness/plugin.test.ts": ["plugins/claude-code/dist/**"]}`. Keys and globs match worktree-relative paths from the start of the path to its end: `"plugin.test.ts"` matches only a file at the root, `"**/plugin.test.ts"` one in any directory. A key that matches no test file, or a glob that matches no file, gets a note in `squeal status`. |
| `observe.runtimeInputs` | `true` | Squeal records the project files each test file reads, stats, lists, loads or executes at run time, in its worker and in every Node process and Worker the test starts (a child started with `env: {}` too), and re-runs the test file when one changes or a listed directory gains or loses a file. A result is stored under a key that includes what its run read. Not seen, so name them in `inputs`: what a non-Node child reads (a shell script's `cat`), native file access (`node:sqlite`), Vitest's own process (`globalSetup`, plugins), gitignored files and files outside the worktree. `false` keys by imports and `inputs` only. |
| `env.allowlist` | `[]` | Environment variables whose values are part of a result's identity. |
| `runner.tierSize` | `4` | Test files per run while an edit's tests are queued. |
| `runner.backlogTierSize` | `200` | Test files per run while only backlog work is queued (the baseline, an environment change, `run --all`), up to 300 s of last known file time or half of `runner.timeoutMs`. An edit cancels such a run; the files it finished keep their results. |
| `runner.timeoutMs` | `600000` | Limit per run; `null` for none. |
| `nodeTest` | `[]` | node:test projects validated beside Vitest. Each entry has `name` (unique), `include` (test-file globs relative to `cwd`, at least one) and optionally `exclude`, `cwd` (relative to the repository root, default the root), `node` (executable path or name, default `node` on the daemon's PATH), `argv` (the flags before `--test`, in order, for example `["--import", "tsx"]`) and `env` (variables merged over the daemon's environment). A bad entry is skipped with a note in `squeal status`; the other projects are kept. Results arrive once the node:test runner lands; until then a configured project lists no test files. |
| `nodeTest[].slow` | `false` | `true` makes every file the entry's `include` lists a slow file (see `slow.include`). |
| `slow.include` | `[]` | Test-file globs, worktree-relative and matched against the test files of every runner; a matching file is a slow file, run apart from edits' tests in the slow tier. A glob Squeal cannot use is left out with a note in `squeal status`; the others are kept. |
| `slow.maxWorkers` | `2` | Workers of one slow run. |
| `slow.maxLoadPerCpu` | `1.0` | The slow tier waits while the one-minute load average per CPU is above this. |
| `slow.maxDeferMs` | `600000` | How long the slow tier waits for the load to drop before it runs a slow file anyway, with a note. |
| `daemon.idleExitMinutes` | `60` | The daemon exits after this long with no registered session. |
| `store.retentionDays` | `7` | Results for file contents no worktree has any more are dropped after this many days. |
| `store.maxSizeMb` | `null` | Size cap of the store; `null` for none. |
