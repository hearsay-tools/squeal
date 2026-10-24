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
| `stop.requireSlowSuite` | `false` | At Stop, wait for the slow files (see `slow.include`) not current at the current revision, up to `stop.slowWaitMs`. Silent when they pass; keeps the agent going once with a slow failure, or at the bound with the files still running and `squeal run --slow --wait`. Until the waiting hook has run once in the worktree (a Codex user trusts it first, with `/hooks`), and at a subagent's Stop, it does not wait: it keeps the agent going once, right away, while a slow file is not current. A main agent whose worktree had no revision since its session registered is not held for slow files: a session that changed no file finishes without them. |
| `stop.slowWaitMs` | `120000` | How long Stop waits for the slow files under `stop.requireSlowSuite`. The default covers a small slow file (13 to 28 s from Stop to a result, measured) and a tier of four end-to-end files (63 s at the median, 106 s at p90). Capped at 600000 by the waiting hook's timeout. |
| `baseline.onStart` | `"lookup-only"` | On daemon start, reuse the results stored at each test file's inputs and run no other test file, except one whose stored result is another worktree's failure: it runs once here, to confirm or clear that failure. Your edits' tests still run. `"lookup-then-run-missing"` also runs every test file without a result at its inputs. |
| `inputs` | `[]` | Extra files (globs) that test files read at runtime and Squeal cannot observe (see `observe.runtimeInputs`), so a change to them re-runs those tests. A list applies to every test file. A map from test-file glob to input globs applies to the matching test files only, for example `{"test/harness/plugin.test.ts": ["plugins/claude-code/dist/**"]}`. Keys and globs match worktree-relative paths from the start of the path to its end: `"plugin.test.ts"` matches only a file at the root, `"**/plugin.test.ts"` one in any directory. A key that matches no test file, or a glob that matches no file, gets a note in `squeal status`. |
| `observe.runtimeInputs` | `true` | Squeal records the project files each test file reads, stats, lists, loads or executes at run time, in its worker and in every Node process and Worker the test starts (a child started with `env: {}` too), and re-runs the test file when one changes or a listed directory gains or loses a file. A result is stored under a key that includes what its run read. Not seen, so name them in `inputs`: what a non-Node child reads (a shell script's `cat`), native file access (`node:sqlite`), Vitest's own process (`globalSetup`, plugins), gitignored files and files outside the worktree. `false` keys by imports and `inputs` only. |
| `env.allowlist` | `[]` | Environment variables whose values are part of a result's identity. |
| `runner.tierSize` | `4` | Test files per run while an edit's tests are queued. |
| `runner.backlogTierSize` | `200` | Test files per run while only backlog work is queued (the baseline, an environment change, `run --all`), up to 300 s of last known file time or half of `runner.timeoutMs`. An edit cancels such a run; the files it finished keep their results. |
| `runner.timeoutMs` | `600000` | Limit per run; `null` for none. |
| `nodeTest` | `[]` | node:test projects validated beside Vitest. Each entry has `name` (unique), `include` (test-file globs relative to `cwd`, at least one) and optionally `exclude`, `cwd` (relative to the repository root, default the root), `node` (executable path or name, default `node` on the daemon's PATH), `argv` (the flags before `--test`, in order, for example `["--import", "tsx"]`) and `env` (variables merged over the daemon's environment). A bad entry is skipped with a note in `squeal status`; the other projects are kept. |
| `nodeTest[].slow` | `false` | `true` makes every file the entry's `include` lists a slow file (see `slow.include`). |
| `pytest` | `[]` | pytest projects validated beside Vitest and node:test. Each entry has `name` (unique), `include` (test-file globs relative to `cwd`, at least one) and optionally `exclude`, `cwd` (relative to the repository root, default the root; pytest runs from here), `python` (an environment directory or interpreter path relative to `cwd`, default `.venv`, then the interpreter `.pdm-python` names; absolute only for an environment outside the worktree), `args` (arguments the project's own pytest command passes that change what runs, for example `["--ds=settings"]`) and `env` (variables merged over the run environment). Squeal never uses an activated `VIRTUAL_ENV` or the `python` on the PATH. A bad entry is skipped with a note in `squeal status`; the other projects are kept. |
| `pytest[].slow` | `false` | `true` makes every file the entry's `include` lists a slow file (see `slow.include`). |
| `pytest[].batchSize` | `5` | Test files per pytest process. A larger batch pays pytest's start-up fewer times; a smaller one shares less session state between files. Squeal runs `runner.tierSize` batches at once. |
| `vitest.excludeProjects` | `[]` | Vitest project names Squeal never runs, for projects the repository's own test script leaves out (a browser e2e project that needs servers booted). Squeal never creates, runs or counts them; `squeal status` and the session's first message name each as not run, and a file only their tests read is uncovered (see `delivery.uncoveredEdits`). Each name is matched as Vitest's `--project` matches it. A name no project has is left out with a note in `squeal status`; the others apply. |
| `vitest.exclude` | `[]` | Globs, worktree-relative, of Vitest test files Squeal does not cover, for tests of a build output Squeal does not produce (an e2e suite over a bundle). Squeal never lists, runs, keys or counts them; `squeal status`, `squeal setup --check` and the session's first message name the globs as not covered, so run them yourself. A glob Squeal cannot use is reported in `squeal status`, and then nothing is excluded. |
| `slow.include` | `[]` | Test-file globs, worktree-relative and matched against the test files of every runner; a matching file is a slow file, run apart from edits' tests in the slow tier. A glob Squeal cannot use is left out with a note in `squeal status`; the others are kept. |
| `slow.maxWorkers` | `2` | Workers of one slow run. |
| `slow.maxLoadPerCpu` | `1.0` | The slow tier waits while the one-minute load average per CPU is above this. |
| `slow.maxDeferMs` | `600000` | How long the slow tier waits for the load to drop before it runs a slow file anyway, with a note. |
| `slow.maxParallel` | `4` | The most slow files run at once when the machine is idle (nothing of the edits' or the backlog's running or queued, load below `slow.maxLoadPerCpu`); otherwise one at a time. Also how many slow files all of one user's daemons run at once. |
| `slow.trigger` | `"continuous"` | When the slow tier starts. `"continuous"`: once the latest edit's fast tests are done and no edit has come for `slow.quietMs`, whether or not the agent is mid-turn; a slow result arrives with the next tool call. `"idle"`: only when the agent pauses, or no session is registered. Both run on `squeal run --slow`. |
| `slow.quietMs` | `3000` | Under `"continuous"`, how long after the latest edit the slow tier waits before it starts a slow file. |
| `delivery.uncoveredEdits` | `true` | After an edit, the next delivery names the changed code files (`.js`, `.ts`, `.py` and their variants, outside `dist/`) that no test Squeal runs reads, once per file per session or subagent. `false` turns the line off. |
| `daemon.idleExitMinutes` | `60` | The daemon exits after this long with no registered session. |
| `store.retentionDays` | `7` | Results for file contents no worktree has any more are dropped after this many days. |
| `store.maxSizeMb` | `null` | Size cap of the store; `null` for none. |

## Complexity

With `complexity.enabled`, Squeal counts the cyclomatic complexity of each function in the files it sees after each edit, with no test run: ESLint's classic `complexity` rule for `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs` and `.cjs`, radon's for `.py`. A function over `complexity.threshold` fails, and its state is kept as a test's is.

- The session's first message counts the functions over the threshold and never lists them: `Complexity: 62 functions over 20; squeal code lists them.` While the first count runs, it says `Complexity: counting, 340 of 600 files.`
- A function that goes over, or a new one over, arrives with the next tool call after any test failure: `FAIL complexity: selectTier (src/core/scheduler/tiers.ts:120) is 23, over 20 (ESLint rule)`. One that goes back at or under arrives as `PASS complexity: ...`, and a failing one that is removed as `RESOLVED complexity: ... is no longer in the code`. A message lists at most 5 of them and counts the rest: `and 14 more complexity changes; squeal code --changed lists them.` A move or a rename that keeps the function's body says nothing.
- A count that changes while the function stays over says nothing, with two exceptions, each said once. The first edit in a session to a function already over: `STILL FAIL complexity: selectTier (src/core/scheduler/tiers.ts:120) is 23 after the edit; it was already over 20 before it (ESLint rule); Squeal stays quiet about it until it is at or under 20, and squeal code src/core/scheduler/tiers.ts shows its count.` The first edit after a `FAIL` that leaves the function over: `STILL FAIL complexity: selectTier (src/core/scheduler/tiers.ts:120) is 22 after the edit, over 20 (ESLint rule); Squeal stays quiet about it until it is at or under 20, …`. After a `STILL FAIL`, Squeal says nothing more about that function until it is back at or under the threshold, so a later edit that leaves it over is quiet; `squeal code <path>` shows its count at any time.
- A change of the threshold or of the files counted is one line, such as `Complexity threshold is now 15: 117 functions over; squeal code lists them.`
- A file over `complexity.maxFileBytes` is not counted; the first edit to it in a session says so once.
- A complexity failure never denies an edit and never counts in `Known failures`. It keeps you going at Stop only with `complexity.blocking`, and then only for a function that went over since the session started.

| Key | Default | Meaning |
| --- | --- | --- |
| `complexity.enabled` | `false` | Count complexity per function and keep its state. Off, Squeal counts nothing and keeps no code store. |
| `complexity.threshold` | `20` | A function fails when its complexity is above this. |
| `complexity.include` | `["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,py}"]` | Globs, worktree-relative, of the files counted. Test files, files under `node_modules` and files git ignores are never counted. |
| `complexity.exclude` | `["**/dist/**", "**/build/**", "**/vendor/**", "**/*.min.js"]` | Globs left out of `include`; a project's list replaces the default. |
| `complexity.maxFileBytes` | `524288` | A larger file is not counted, and `squeal code` names it. |
| `complexity.blocking` | `false` | Stop also names each function that went over since the session started, and keeps you going once. A function already over at the session's start never blocks. |
