# Intermittent CI probes

Throwaway research, 2026-10-31, wave 60 R2. No product repair. See
[the findings](../../ci-intermittent.md). Fixtures live in private `/tmp`
directories and are removed. Neither probe adds CPU load on purpose.
`evidence.txt` preserves the target CI errors and the observed local results.

Run from the repository root, only when the one-minute load is below the CPU
count. The experiments used Node 22.19.0 and the installed tsx 4.23.15.
Use the pinned Node first on PATH. Do not install dependencies again.

```sh
env -u PLUGIN_ROOT -u PLUGIN_DATA pnpm --config.verify-deps-before-run=false exec tsx docs/specifications/011-core/research/probes/ci-intermittent/lock-window.mjs
env -u PLUGIN_ROOT -u PLUGIN_DATA pnpm --config.verify-deps-before-run=false exec tsx docs/specifications/011-core/research/probes/ci-intermittent/start-window.mjs
```

- `lock-window.mjs` calls the real `acquireLock`. Its `now` callback starts a
  second process after `BEGIN EXCLUSIVE` but before the owner hint is written.
  Expected: busy PID 0 before publication, then busy with the holder's PID.
- `start-window.mjs` runs the committed Claude Code CLI in a temporary repo.
  Its preload holds only the daemon's main thread for 2.5 s before it removes
  `.starting`. The socket worker still answers. The source hooks compare an
  equal version, then an older hook version (a newer daemon). Expected:
  `marker-held` records no `ensureDaemon` calls and no hook errors;
  `marker-cleared` records `alive`, with the same PID. This forces a valid
  ordering; it does not measure its natural probability. It uses no network.

Isolated Vitest repetitions used the task's explicit research allowance:

```sh
env -u PLUGIN_ROOT -u PLUGIN_DATA pnpm exec vitest run test/harness/codex/runtime-update/lock-process.test.ts --maxWorkers=1
env -u PLUGIN_ROOT -u PLUGIN_DATA pnpm exec vitest run test/scheduler/runs.test.ts --maxWorkers=1 -t 'runs a file again when a batch during its crashed run gave it a new key'
```

The lock file ran nine times at `b34b00682`, with failures on runs 6 and 7.
The next launch was withheld because load reached 24.63 on 24 CPUs. The
scheduler test ran ten times at `37c3c7125`, with no failure. Its six sibling
tests were skipped. Runs were sequential, with no added load. Launch loads
were 21.38–23.04 for the lock and 17.41–20.46 for the scheduler.

The scheduler copy was made with `git archive 37c3c7125` of `src`, `test`,
`package.json`, `pnpm-lock.yaml`, the two tsconfigs and `vitest.config.ts`,
extracted below `/tmp/squeal-ci-r2-da2b436c/scheduler-tree`. Dependencies were
linked from this worktree. The first `pnpm exec` automatically attempted an
install before running, reported `ERR_PNPM_IGNORED_BUILDS`, then continued to
Vitest, which passed. All ten commands exited 0; this setup warning is not a
clean dependency-install pass. The lockfile is unchanged between the two
examined commits. Future archive runs should set
`--config.verify-deps-before-run=false` as the probe commands above do.

No full suite or `pnpm run build` ran. No unmodified repetition of the whole
step-down test file ran; its local evidence is the controlled real-daemon
probe. No scheduler failure phase was captured. Temporary dependencies and
fixtures are not committed.

Saved-probe verification: `node --check` passed for all three `.mjs` files.
Both saved probes ran again on Node 22.19.0 and exited 0 with the same results
(see the final lines of `evidence.txt`). `pnpm ... biome format --write` on
these paths processed no files: the repository configuration excludes docs.
No repository lint pass is claimed.
Probe text was then formatted through Biome stdin as `probe.mjs`; all three
syntax checks passed again. This is formatting, not a repository lint run.

Squeal evidence: `env -u PLUGIN_ROOT -u PLUGIN_DATA
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000
docs/specifications/011-core/research/ci-intermittent.md
docs/specifications/011-core/research/probes/ci-intermittent` exited 3:
`No verdict: no test file's closure holds` either research path. The worktree
had `known failures 0; not current: 81 of 1327 test files (81 unknown)` at
revision 5. Those unknown results are not a pass claim.
