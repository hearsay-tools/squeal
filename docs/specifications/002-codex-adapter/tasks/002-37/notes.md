# 002-37: updater exclusion and publication admission

2026-10-27. Repair against spec 002 D8/D9 and `../wave-5-integration.md`.

## Scope and mechanism

Only product edits: `src/harness/codex/runtime-update/lock.ts` and `update.ts`.
Tests stay under `test/harness/codex/runtime-update/`. Packaging 002-31 and
identity 002-36 retain their files. No CLI, schedule, state, store, artifact,
launcher, identity, dependency, version or committed bundle change.

The exclusive SQLite transaction on `<data>/runtime/update.lock.sqlite` is
the single exclusion mechanism. It stays open through cleanup, release
resolution, staging, publication, pruning and state recording. The kernel
releases its locks on process death. The database file stays permanently in
place: never remove, rename or replace it during recovery or release.
`node:sqlite` already underpins process locks in this repository and fits its
Node 22.19 floor. The parent confirmed this choice on 2026-10-27.

`update.lock` remains a JSON owner hint for the busy response. Its timestamp,
PID, contents and existence never grant ownership. A missing or corrupt hint
reports PID 0 while exclusion remains intact. A hint is written atomically
after acquisition and removed before closing the owning connection. Release
is idempotent and never removes a successor's hint or database lock.
Only SQLite busy errors produce busy; filesystem and other SQLite errors
surface. Polling uses a monotonic clock and requests at most the remaining
wait budget per sleep. Filesystem calls and event-loop scheduling can delay
return beyond that budget.

The SQLite path has a suffix so abandoned pre-repair JSON is never opened as
a database. Legacy JSON alone does not exclude a new updater. The updater is
still an unreleased feature; this repair does not support running the old
JSON-lock source implementation concurrently with the new implementation.

## Reproduction and discriminating checks

Squeal at revision 1 observed the controlled X/B/C interleaving produce two
successful lock owners. A reads dead X; the read hook lets B replace X; A
renames B aside; the rename hook lets C acquire the empty path. The existing
relink cannot repair simultaneous B/C ownership. The same test now admits
one owner. A second regression failed because an old timestamp evicted a
live owner. Old or corrupt metadata now leaves the SQLite owner in place.

At revision 2, all four initial publication checks failed: an abort or an
expired monotonic deadline after actual staging, or before retained-runtime
selection, still returned updated and changed current. They passed after
the repair. The final checks place abort/expiry at three seams: after actual
staging, after retained-root validation, and after the final selection
recheck. Every case preserves current and pin bytes, cleans its staging,
and reports `aborted` or `timeout`.

Further checks prove:

- Three real Node children contending on the same data directory admit one
  owner and two busy responses naming that owner.
- SIGKILL of a real lock owner permits a later update, without changing the
  database inode. That update removes abandoned staging, selects the new
  runtime, and leaves the running session pinned to the old runtime.
- Releasing an old owner twice cannot release its successor.
- A live owner older than the former stale interval still yields busy after
  a bounded polling wait. The stalled-download deadline check remains.

## Deadline limit

`left()` checks both caller cancellation and the original monotonic deadline.
It runs before network steps, after release resolution, after staging,
after the final selection recheck, and immediately before retained-runtime
publication. Post-stage checks run inside the cleanup `finally` scope.

This is a deadline for asynchronous network work and admission to synchronous
publication. It is not a hard bound on total wall time. Staging, readiness
validation, publication, pruning, state recording and cleanup use synchronous
filesystem work. An admitted `publishRuntime(select: true)` cannot observe a
timer or cancellation while its synchronous copy/verification/selection runs.
It can finish and select after the deadline. A controlled-clock test advances
past the deadline inside the real publication call and records this outcome
as updated. A stronger guarantee requires a different store/publication seam
or a separately supervised process; neither belongs to this repair.

## Interfaces and residue

No exported type shape changes. The internal `LockRecord` type and its token
are removed; advisory JSON now carries schema, PID and start time only.
`STALE_LOCK_MS` remains exported for existing
callers but is deprecated and no longer decides ownership. `timeoutMs` now
documents publication admission rather than an unsupported whole-operation
bound. No new dependency.

The coordinator owns builds and generated drift, candidate review, version
allocation and release. Future cleanup must preserve the lock database path.
The retained-root and final-selection checks are deliberate: resolution and
staging checks alone do not protect later synchronous validation seams.

## Verification

Initial coherent repair: `8ef147488`.

- `pnpm run lint`: exit 0, `Checked 2493 files in 801ms. No fixes applied.`
- `pnpm run typecheck`: exit 0.
- `git diff --check`: exit 0.
- Scoped Biome formatting checks: exit 0; formatting applied to the new tests.
- `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000`
  over the six updater test files (`lock-process`, `lock`, `preserve`,
  `publication`, `update`, `schedule`, each `.test.ts`): revision 13,
  `no known failures; 6 test files, each with a current result`.
- The same command over `src/harness/codex/runtime-update/lock.ts`,
  `src/harness/codex/runtime-update/update.ts`, and
  `test/harness/codex/runtime-update/lock-owner.ts`: final revision 14,
  exit 1, `5 known failures: 5 tests; 237 test files, each with a current
  result, after 21.7 s`. This is 233 passing files and four generated-output
  files with five expected failures. Earlier reads returned exit 3 with
  pending catch-up work; the final selected set has no pending/stale/unknown.
  The whole worktree still has 462 unknown files outside this selected set.

The five affected failures are unchanged baseline packaging work:

- `test/harness/codex/plugin.test.ts`,
  `test/harness/pi/package.test.ts`, `test/harness/plugin.test.ts`, and
  `test/harness/opencode/package.test.ts`: committed `cli/squeal.mjs` differs
  from the source build (four checks).
- The OpenCode package test also expects launcher format 8 while its committed
  copy is format 7 (one check).

The worktree has eight known failures overall: these five plus the three
baseline launcher-copy checks in `test/cli/launcher.test.ts`. These are outside
this row's ownership. No source behavior failure remains in the affected set.
No direct Vitest run, build, full-suite checkpoint, version raise or release.
