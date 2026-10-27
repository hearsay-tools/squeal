# Shutdown fixture runtime paths (002-40)

## Cause and reproduction

The shared restart helper still ran `plugin/dist/cli/squeal.mjs`. The fixed
Codex plugin no longer ships that file. Its seed CLI lives under `plugin/seed/`;
the running daemon uses `plugin.data/versions/<runtime>/dist/cli/squeal.mjs`.
The fixture's ordinary CLI had already moved to the seed, but `cliWith` had
its own obsolete path and dropped the fixture's Codex environment.

Before the repair, on Node 24.21.0:

```text
pnpm exec vitest run test/e2e/stop-gap.test.ts
Test Files  1 failed (1)
Tests       1 failed | 1 passed (2)
Duration    111.07s
FAIL Codex, stop-gap.test.ts:59
the daemon stopped in its stop gap: expected false to be true
```

This reproduces CI40509176585's Node 22 failure at the same assertion. Claude
passed. A focused regression then failed in 4.16 s with `MODULE_NOT_FOUND` for
`/dev/shm/squeal-e2e-qOUG48/plugin/dist/cli/squeal.mjs`, exit code 1. Thus the
requested stop never reached the daemon. Increasing the pause timeout cannot
repair this path.

`cliProcess`, `daemonProcesses` and the fixture's cleanup scan also matched
only the removed path. The failed baseline left PID 2153112 stopped, with argv:

```text
squeal repo daemon @1e0bfb21 /dev/shm/squeal-e2e-eOcnOI/plugin.data/versions/0.1.368/dist/cli/squeal.mjs daemon /dev/shm/squeal-e2e-eOcnOI/repo
```

The fixture directory had already been removed. I killed only this baseline
process with SIGKILL. The later process scan found no remaining process for
that fixture.

## Repair and interfaces

`test/e2e/fixture-cli.ts` owns one fixture CLI identity. Claude uses its bundled
CLI. Codex uses the seed before bootstrap and reads `runtime/current.json`
after selection. Adapter version is never used as a runtime version. An
invalid current record fails the fixture explicitly.

The same identity matches exact CLI and command arguments in NUL-delimited
`/proc` output and space-delimited `ps` output. It recognizes the Codex seed
and every retained release directory, including an older version and paths
whose files cleanup has removed. It rejects another fixture, invalid version
directories and commands such as `daemon-other`. Paths with spaces and regex
characters have checks. The displayed argv0 prefix does not hide the CLI.

`cliWith` now delegates to `E2E.cli`. That method merges per-command values
over the fixture environment. It keeps private HOME, CODEX_HOME, PLUGIN_DATA
and XDG_RUNTIME_DIR while adding the pause preload. Process diagnostics,
cleanup kills and the suite's final leak check use the same identity.

Additive fixture APIs only:

- `E2E.cliIdentity: FixtureCli`.
- `E2E.cli(root, args, env = {})`, with an optional third argument.
- `FixtureCli.path`, `matches(args, command, separator)` and `pids(command)`.

No product type changed. The spec does not settle fixture APIs; the choice
here is that commands follow current while discovery covers all retained
versions. No product decision or scope expansion was required.

`stop-gap.test.ts` is unchanged. Its pause, socket, lock, stop-mark,
registration-order and replacement-validation assertions all remain. No
timeout, skip, generated output, bundle, version or sibling file changed.

## Verification

Squeal excludes `test/e2e/**`, so these paths ran explicitly:

```text
pnpm exec vitest run test/e2e/fixture-cli.test.ts test/e2e/stop-gap.test.ts test/e2e/lifecycle.test.ts --maxWorkers=2
Node 24.21.0: 3 files passed, 10 tests passed, 38.51s
```

That run used the first two fixture regression cases. After adding the
environment and path-boundary cases:

```text
PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH pnpm exec vitest run test/e2e/fixture-cli.test.ts test/e2e/stop-gap.test.ts test/e2e/lifecycle.test.ts --maxWorkers=2 --reporter=verbose
3 files passed, 15 tests passed, 42.67s

pnpm exec vitest run test/e2e/fixture-cli.test.ts --reporter=verbose
Node 24.21.0: 1 file passed, 7 tests passed, 6.23s
```

Node 22 frozen Codex evidence showed PID 2209300 in `Tsl`, its WRITE lock in
`/proc/locks`, and replacement PID 2210653 alive. Both argv paths named
`plugin.data/versions/0.1.368/dist/cli/squeal.mjs`. Claude likewise showed its
paused owner and replacement. Both stop-gap cases passed, including the stop
remaining incomplete while the first daemon held the lock.

The new real-daemon check separately verifies each actual `/proc/<pid>` is
gone after cleanup, then checks both process helpers report no daemon. Both
harnesses passed this on Node 22 and Node 24. The suite leak checks passed;
a separate `ps` scan found no baseline or frozen-test fixture daemon left.

```text
pnpm run lint
Checked 2516 files in 1159ms. No fixes applied. Exit 0.

pnpm run typecheck
tsc --noEmit. Exit 0.
```

The first lint invocation found formatting and a helper named `escape` that
shadowed a global. Those were fixed before the passing invocation above.

```text
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 test/e2e/harness.ts test/e2e/restart-evidence.ts test/e2e/fixture-cli.ts test/e2e/fixture-cli.test.ts
Revision 4: 7 selected test files, each with a current result.
No known failures. Exit 3 because the named e2e paths are excluded.
Worktree: 216 of 1303 test files unknown; no full-suite claim.
```

The selected covered files are version-sensitive, handover-gap, handover-tier,
step-down-keeps, step-down-lanes, step-down and test-pause. The six direct
restart-helper callers also ran explicitly, as the brief requires:

```text
pnpm exec vitest run test/daemon/handover-gap.test.ts test/daemon/handover-tier.test.ts test/daemon/step-down-keeps.test.ts test/daemon/step-down-lanes.test.ts test/daemon/step-down.test.ts test/daemon/test-pause.test.ts --maxWorkers=2
Node 24.21.0: 6 files passed, 11 tests passed, 28.24s
```

No full suite or build was run. This row is ready for the parent's integration
and candidate review; it does not assert that the repaired candidate passed CI.
