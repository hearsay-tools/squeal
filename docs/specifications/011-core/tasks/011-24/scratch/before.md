### gh-45 zero: `squeal status`

```text
Revision: 26 · 64cf3a8f + 1, dirty
Known failures: 0
Affected checks: 20 passed (20 tests), 0 running, 20 queued (20 tests), 60 stale (60 tests)
Idle: nothing is running and no run is open; 20 queued (20 tests) (`squeal run --all --wait` runs every test file without a result and waits)
Full-suite checkpoint: none completed at any revision (the counts are for revision 26; `squeal run --all` requests one)

Worktree: /work/repo (HEAD 64cf3a8, dirty at revision 26)
Daemon: running, last heartbeat 2 s ago
Inherited from other worktrees: none (every current result here was run in this worktree)
Closure method: static imports plus declared inputs
Store schema: 1
```

### gh-45 zero: registration header

```text
SQUEAL · registered at revision 26
Revision 26 · 64cf3a8f + 1, dirty: 20 current (20 tests), 20 pending (20 tests), 60 stale (60 tests), 0 unknown. Full-suite checkpoint: none completed at any revision (the counts are for revision 26; `squeal run --all` requests one).
Known failures: 0
```

### gh-45 zero: Stop

```text
SQUEAL · status at revision 26
Revision 26 · 64cf3a8f + 1, dirty: 20 current (20 tests), 20 pending (20 tests), 60 stale (60 tests), 0 unknown. Full-suite checkpoint: none completed at any revision (the counts are for revision 26; `squeal run --all` requests one).
Known failures: 0
```

### gh-45 oldrev: `squeal status`

```text
Revision: 26 · 64cf3a8f + 1, dirty
Known failures: 1 (1 test)
Earlier failures: 1 pending rerun, 1 stale (not counted until a rerun fails)
  FAIL  src/moved-key.test.ts > moved-key
        AssertionError: expected 1 to be 2
        observed at revision 6, stale
        recorded 60 min ago in this worktree at revision 6, load 0.40 per CPU when it ran; no retry asked at these inputs
  FAIL  src/queued.test.ts > queued
        AssertionError: expected 1 to be 2
        observed at revision 6, pending
        recorded 60 min ago in this worktree at revision 6, load 0.40 per CPU when it ran; no retry asked at these inputs
  FAIL  src/same-key.test.ts > same-key
        AssertionError: expected 1 to be 2
        observed at revision 6, current
        recorded 60 min ago in this worktree at revision 6, load 0.40 per CPU when it ran; no retry asked at these inputs
Affected checks: 0 passed, 0 running, 1 queued (1 test), 1 stale (1 test)
Idle: nothing is running and no run is open; 1 queued (1 test) (`squeal run --all --wait` runs every test file without a result and waits)
Full-suite checkpoint: none completed at any revision (the counts are for revision 26; `squeal run --all` requests one)

Worktree: /work/repo (HEAD 64cf3a8, dirty at revision 26)
Daemon: running, last heartbeat 2 s ago
Inherited from other worktrees: none (every current result here was run in this worktree)
Closure method: static imports plus declared inputs
Store schema: 1
```

### gh-44 E1: `squeal status --wait 60000 test/f01.test.mjs` (exit 0)

```text
Revision: 1 · 64cf3a8f + 1, dirty
Known failures: 0
Affected checks: 3 passed (2 tests, 1 test file loaded), 0 running, 0 queued
Idle: nothing is running and no run is open; 24 test files without a result, none queued (`squeal run --all --wait` runs every test file without a result and waits)
Full-suite checkpoint: none completed at any revision (the counts are for revision 1; `squeal run --all` requests one)

Worktree: /work/repo (HEAD 64cf3a8, dirty at revision 1)
Daemon: running, last heartbeat 2 s ago
Inherited from other worktrees: none (every current result here was run in this worktree)
Test files without checks: 0 pending, 24 unknown
Test files without a result: 24 (nothing current at their inputs, none queued)
  test/f02.test.mjs: no result: never run at this key: the baseline is lookup-only, so nothing queued it
  test/f03.test.mjs: no result: never run at this key: the baseline is lookup-only, so nothing queued it
  test/f04.test.mjs: no result: never run at this key: the baseline is lookup-only, so nothing queued it
  test/f05.test.mjs: no result: never run at this key: the baseline is lookup-only, so nothing queued it
  test/f06.test.mjs: no result: never run at this key: the baseline is lookup-only, so nothing queued it
  test/f07.test.mjs: no result: never run at this key: the baseline is lookup-only, so nothing queued it
  test/f08.test.mjs: no result: never run at this key: the baseline is lookup-only, so nothing queued it
  test/f09.test.mjs: no result: never run at this key: the baseline is lookup-only, so nothing queued it
  test/f10.test.mjs: no result: never run at this key: the baseline is lookup-only, so nothing queued it
  test/f11.test.mjs: no result: never run at this key: the baseline is lookup-only, so nothing queued it
  test/f12.test.mjs: no result: never run at this key: the baseline is lookup-only, so nothing queued it
  test/f13.test.mjs: no result: never run at this key: the baseline is lookup-only, so nothing queued it
  test/f14.test.mjs: no result: never run at this key: the baseline is lookup-only, so nothing queued it
  test/f15.test.mjs: no result: never run at this key: the baseline is lookup-only, so nothing queued it
  test/f16.test.mjs: no result: never run at this key: the baseline is lookup-only, so nothing queued it
  test/f17.test.mjs: no result: never run at this key: the baseline is lookup-only, so nothing queued it
  test/f18.test.mjs: no result: never run at this key: the baseline is lookup-only, so nothing queued it
  test/f19.test.mjs: no result: never run at this key: the baseline is lookup-only, so nothing queued it
  test/f20.test.mjs: no result: never run at this key: the baseline is lookup-only, so nothing queued it
  test/f21.test.mjs: no result: never run at this key: the baseline is lookup-only, so nothing queued it
  and 4 more test files
Closure method: static imports plus declared inputs
Store schema: 1
Notes:
  2026-10-19T16:14:00.000Z, revision 0: node-test project "unit": 1 test file(s) loaded nothing beyond themselves; declare their inputs in squeal.config.json

Selected: test/f01.test.mjs
Named test files at revision 1: no known failures; 1 test file, each with a current result, after 0.5 s. Worktree: known failures 0; checks 0 running, 0 queued
```

### gh-38 A: `squeal status --wait 20000 src/lib.js` (exit 3)

```text
Revision: 2 · 64cf3a8f + 1, dirty
Known failures: 0
Affected checks: 2 passed (1 test, 1 test file loaded), 0 running, 0 queued, 4 stale (2 tests, 2 test files loaded)
Full-suite checkpoint: none completed at any revision (the counts are for revision 2; `squeal run --all` requests one)

Worktree: /work/repo (HEAD 64cf3a8, dirty at revision 2)
Daemon: running, last heartbeat 2 s ago
Inherited from other worktrees: none (every current result here was run in this worktree)
Closure method: static imports plus declared inputs
Store schema: 1

Selected: tests/a.test.ts
Stale (1): tests/a.test.ts: last pass
Named test files have no verdict: 1 test file without a current result at revision 2 (1 stale). Worktree: known failures 0; checks 0 running, 0 queued
```

### gh-43: `squeal status --wait 10000 test/slow.test.ts` (exit 3)

```text
Revision: 0 · 64cf3a8f + 1, dirty
Known failures: 0
Affected checks: 0 passed, 0 running, 0 queued
Idle: nothing is running and no run is open; 1 test file without a result, none queued (`squeal run --all --wait` runs every test file without a result and waits)
Full-suite checkpoint: none completed at any revision (the counts are for revision 0; `squeal run --all` requests one)

Worktree: /work/repo (HEAD 64cf3a8, dirty at revision 0)
Daemon: running, last heartbeat 2 s ago
Inherited from other worktrees: none (every current result here was run in this worktree)
Test files without checks: 0 pending, 1 unknown
Test files without a result: 1 (nothing current at their inputs, none queued)
  test/slow.test.ts: no result: timed out after 600 s
Closure method: static imports plus declared inputs
Store schema: 1

Selected: test/slow.test.ts
Unknown (1): test/slow.test.ts: no result: timed out after 600 s
Named test files have no verdict: 1 test file without a current result at revision 0 (1 unknown). Worktree: known failures 0; checks 0 running, 0 queued
```

### gh-40 B: `squeal status --wait 1500 <3 fast files> <1 slow file>` (exit 3)

```text
Revision: 0 · 64cf3a8f + 1, dirty
Known failures: 0
Affected checks: 0 passed, 0 running, 0 queued; 28 test files without checks yet: 4 running, 24 queued
Full-suite checkpoint: none completed at any revision (the counts are for revision 0; `squeal run --all` requests one)

Worktree: /work/repo (HEAD 64cf3a8, dirty at revision 0)
Daemon: running, last heartbeat 2 s ago
Inherited from other worktrees: none (every current result here was run in this worktree)
Test files without checks: 28 pending, 0 unknown
Closure method: static imports plus declared inputs
Store schema: 1

Selected: tests/fast/f1.test.ts, tests/fast/f2.test.ts, tests/fast/f3.test.ts, tests/slow/s1.test.ts
Pending (4): tests/fast/f1.test.ts: queued behind the vitest tier running since 16:14:56; tests/fast/f2.test.ts: queued behind the vitest tier running since 16:14:56; tests/fast/f3.test.ts: queued behind the vitest tier running since 16:14:56; tests/slow/s1.test.ts: slow, run after the fast tests or on `squeal run --slow`
Named test files have no verdict: the deadline passed after 1.5 s: 4 test files still pending at revision 0: 3 queued behind the vitest tier running since 16:14:56, 1 slow, run after the fast tests or on `squeal run --slow`. Worktree: known failures 0; checks 0 running, 0 queued; 28 test files without checks: 4 running, 24 queued
```

### gh-40 A: the same wait while the files sit in a running 27-file backlog tier (exit 3)

```text
Revision: 0 · 64cf3a8f + 1, dirty
Known failures: 0
Affected checks: 0 passed, 0 running, 0 queued; 28 test files without checks yet: 27 running, 1 queued
Full-suite checkpoint: none completed at any revision (the counts are for revision 0; `squeal run --all` requests one)

Worktree: /work/repo (HEAD 64cf3a8, dirty at revision 0)
Daemon: running, last heartbeat 2 s ago
Inherited from other worktrees: none (every current result here was run in this worktree)
Test files without checks: 28 pending, 0 unknown
Closure method: static imports plus declared inputs
Store schema: 1

Selected: tests/fast/f1.test.ts, tests/fast/f2.test.ts, tests/fast/f3.test.ts
Pending (3): tests/fast/f1.test.ts: running since 16:14:56 in the vitest lane; tests/fast/f2.test.ts: running since 16:14:56 in the vitest lane; tests/fast/f3.test.ts: running since 16:14:56 in the vitest lane
Named test files have no verdict: the deadline passed after 1.5 s: 3 test files still pending at revision 0: 3 running since 16:14:56 in the vitest lane. Worktree: known failures 0; checks 0 running, 0 queued; 28 test files without checks: 27 running, 1 queued
```

### gh-41 E1: `squeal status --wait 60000` (quiet)

```text
Revision: 1 · 64cf3a8f + 1, dirty
Known failures: 0
Affected checks: 455 passed (364 tests, 91 test files loaded), 0 running, 0 queued
Idle: nothing is running and no run is open; 553 test files without checks queued (`squeal run --all --wait` runs every test file without a result and waits)
Full-suite checkpoint: none completed at any revision (the counts are for revision 1; `squeal run --all` requests one)

Worktree: /work/repo (HEAD 64cf3a8, dirty at revision 1)
Daemon: running, last heartbeat 2 s ago
Inherited from other worktrees: none (every current result here was run in this worktree)
Test files without checks: 553 pending, 0 unknown
Closure method: static imports plus declared inputs
Store schema: 1

Returned on quiet: nothing the edits since revision 1 re-keyed is pending (91 test files) at revision 1 after 0.0 s; 0 checks and 553 test files without checks pending in all. Worktree: known failures 0; checks 0 running, 0 queued; 553 test files without checks: 0 running, 553 queued
```

### gh-41 comment: a load retry's wording at 7.45 on 24 CPUs

```text
waits for the one-minute load average to fall below the CPU count (load average 7.45 on 24 CPUs now)
```

### gh-39: `squeal status --wait 90000 packages/cezar/src/core/cursor-print-capabilities.test.ts` from packages/cezar (exit 3)

```text
Revision: 20 · 64cf3a8f + 1, dirty
Known failures: 0
Affected checks: 0 passed, 0 running, 0 queued
Full-suite checkpoint: none completed at any revision (the counts are for revision 20; `squeal run --all` requests one)

Worktree: /work/repo (HEAD 64cf3a8, dirty at revision 20)
Daemon: running, last heartbeat 2 s ago
Inherited from other worktrees: none (every current result here was run in this worktree)
Closure method: static imports plus declared inputs
Store schema: 1

No verdict: no test file's closure holds packages/cezar/packages/cezar/src/core/cursor-print-capabilities.test.ts. Worktree: known failures 0; checks 0 running, 0 queued
```

### gh-42 E2: `squeal status --wait 1 test/cli/main.test.ts test/cli/remove.test.ts` (exit 3)

```text
Revision: 837 · 64cf3a8f + 1, dirty not known
Known failures: 0
Affected checks: 0 passed, 0 running, 0 queued
Full-suite checkpoint: none completed at any revision (the counts are for revision 837; `squeal run --all` requests one)

Worktree: /work/repo (HEAD 64cf3a8, dirty state not known: no daemon is validating)
Daemon: no daemon running since 2026-10-19T16:05:00.000Z
Inherited from other worktrees: none (every current result here was run in this worktree)
Test files without checks: 0 pending, 468 unknown
Test files without a result: 468 (nothing current at their inputs, none queued)
  test/cli/main.test.ts: no result: no dependencies are installed in this worktree
  test/cli/remove.test.ts: no result: no dependencies are installed in this worktree
  and 466 more test files
Closure method: static imports plus declared inputs
Store schema: 1

Selected: test/cli/main.test.ts, test/cli/remove.test.ts
Unknown (2): test/cli/main.test.ts: no result: no dependencies are installed in this worktree; test/cli/remove.test.ts: no result: no dependencies are installed in this worktree
Named test files have no verdict: no daemon has validated since 2026-10-19T16:05:00.000Z: the daemon stopped; results are as of revision 837; `squeal start` starts one. Worktree: known failures 0; checks 0 running, 0 queued
```

### gh-46: `squeal status` while the slow file runs

```text
Revision: 0 · 64cf3a8f + 1, dirty
Known failures: 0
Affected checks: 3 passed, 1 running, 0 queued
Full-suite checkpoint: none completed at any revision (the counts are for revision 0; `squeal run --all` requests one)
Slow tier: 1 test file; running e2e/held.e2e.ts since 16:14 (no earlier run). Squeal runs them after the fast tests; `squeal run --slow --wait 60000` waits for its result.

Worktree: /work/repo (HEAD 64cf3a8, dirty at revision 0)
Daemon: running, last heartbeat 2 s ago
Inherited from other worktrees: none (every current result here was run in this worktree)
Closure method: static imports plus declared inputs
Store schema: 1
```
