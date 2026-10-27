# 017-11.R2: fixture harness identity

## Change

`test/daemon/helpers.ts` owns inherited test-environment isolation. Its
`childEnv` now strips `CODEX_SESSION_ID`, `PI_SESSION_ID` and
`OPENCODE_SESSION_ID`. These are the three identity names that
`src/cli/status-command.ts` reads to select harness-specific commands.
The existing `NODE_PATH` isolation stays intact.

`test/daemon/child-env.test.ts` poisons each controller identity separately,
creates a fixture and runs the real CLI's `stop` command. It checks the full
plain no-daemon output, successful exit, empty stderr and absent fixture
identity. It also checks that the controller identity remains set.

The first regression used `statusCommand(childEnv(...))` directly. Squeal
reported all three cases failing at revision 1: each returned its harness
command instead of `squeal`. The final test checks actual CLI output instead
of keeping that weaker check.

No production code, shutdown assertion, bundle, version, board or status
changed. No type changes or unresolved design decisions. No ESLint check is
needed for this test-environment repair. No build command or full suite ran.

## Verification

- `pnpm run lint`: exit 0, `Checked 2418 files in 5s. No fixes applied.`
- `pnpm run typecheck`: exit 0. The initial attempt found TS2322 in the new
  test's cleanup callback. Changed the callback to return void and reran.
- `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 test/daemon/child-env.test.ts`:
  revision 1, exit 1, all three identity cases failed before the repair.
- `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 test/daemon/child-env.test.ts test/daemon/stop-cancel.test.ts`:
  revision 4, exit 0, `Named test files at revision 4: no known failures;
  2 test files, each with a current result, after 36.2 s`.
  The shutdown test file is unchanged.
- `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 test/daemon/helpers.ts test/daemon/child-env.test.ts test/daemon/stop-cancel.test.ts`:
  revision 4, exit 3 after 60.7 s. The helper selected 104 files: 4 current
  passes, 4 running, 96 queued. Current passes include both named tests and
  the Codex version-copy hook/start tests. No known failure. The daemon
  reported a stale heartbeat while its socket stayed alive.

The broad helper selection remains pending. The worktree snapshot also had
607 unknown baseline test files; baseline lookup queued none of those.
These are not passing-suite claims. The parent should retain the broad
pending result when integrating; the requested regression and original
stop-cancel cases have current passing results.
