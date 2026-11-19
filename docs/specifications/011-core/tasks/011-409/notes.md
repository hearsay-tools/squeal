# 011-409 notes: the wave-18 B1 case's own walk threw on a killed child not yet reaped

Row 011-409 (repair, cause first). Worker run `f73fe4d5`, 2026-11-19. Files: `test/daemon/low-priority.test.ts`, and `src/core/daemon/low-priority.ts` (only an `export` and a doc comment, no behaviour change).

## Cause

The fault was in the test, not in the product.

The B1 case gives `lowerWhile` its own `walk`. The first walk lists the middle child and kills it 10 ms later. Every later walk was `descendants(pid).map(identity)`:

- `descendants` reads `/proc/<pid>/task/*/children`. A child that was killed but is not reaped yet is still listed there.
- `identity` calls `statOf`. `statOf` returns `null` for a process that is exiting (`PF_EXITING`) or a zombie, so `identity` throws `no process <pid>`.
- `lowerWhile` has one `try/catch` around its loop. It reads every throw as its abort and returns. The lowering stops for the rest of the case, so the late child stays at nice 0. After the 5 s poll the case fails with `expected +0 to be 10`. This is the CI message.

The product's own walk, `below`, skips a process that is exiting. It never throws. So the product does not have this fault. Only the test's walk had it.

The window opens when the second walk (about 100 ms after the first) runs before the carrier has reaped the killed child, or while the kernel is still taking the child down. Both processes run at nice 10 at that time, because the first look lowered them. On a busy runner, a nice-10 process can wait more than 100 ms for a CPU. On an idle host it does not wait that long.

## Evidence

- CI logs: in every failing attempt the case ran 6.3 to 6.6 s (the 5 s poll plus about 1.3 s of setup). Passing runs take about 1.6 s. Failing runs: 44530318969, 44553135113, 44562932474 and 44572362286, attempt 1 each.
- The file ran in shard 2/3 in passing and failing runs (main 44374987690 and 44470189983 on 2026-11-18 and 2026-11-19, and 44564950422). The shard did not move.
- 44562932474, Node 22 (2/3): attempt 1 failed and attempt 2 passed on the same commit. Both attempts used the same runner image, ubuntu-26.04 20261111.196.1, and provisioner 20261103.629, so the runner did not change. The neighbour files were the same in both attempts, but in attempt 1 they ran 15 to 33% slower. For example, `codex/adapter/dispatch.test.ts` took 4,752 ms against 3,579 ms, and `code-gate-log.test.ts` took 3,820 ms against 3,139 ms. That is a slower or busier runner, which is the condition the window needs.
- Probe on this host. It was an uncommitted copy of the case: the walk was wrapped to record throws, and the run used a vitest config outside `include`.
  - On 2 CPUs (`taskset -c 0,1`) at the host's own load (load average about 7 on 24 CPUs): 20 of 20 passed and no walk threw. The window does not open here by itself.
  - The same probe, with the carrier paused by `SIGSTOP` for 400 ms after the first walk, so the killed child stays a zombie the way a busy runner leaves it: 10 of 10 failed with `expected +0 to be 10`. Each failure recorded `walk 2: no process <middle>`, and `lowerWhile` had already settled.
  - The same pause, with the later walks using the product's `below`: 10 of 10 passed.

## Fix

- `below` is exported, with a doc line that says it skips an exiting process. The case's later walks are `below(pid)`, which is the daemon's own walk. The case still checks that a late child, left in the group by a parent that is gone, gets lowered while the carrier lives. The check now also covers the case where the killed child is still exiting.
- The first walk pauses the carrier for 300 ms (`SIGSTOP`, then `SIGCONT` from a guarded timer). The next looks then find the killed child not yet reaped on every run, not only on a busy runner.
- The poll ends when `lowerWhile` settles. The case asserts `{ late, ended }`, so a stopped lowering fails at once with `ended: true` instead of waiting 5 s.

Red check: the new case with the old walk (`childrenOf` recursion plus `identity`) failed 3 of 3 with `expected { late: +0, ended: true } to deeply equal { late: 10, ended: false }`. Green: the fixed case passed 15 of 15 alone on 2 CPUs. `low-priority.test.ts` and `low-priority-retry.test.ts` together passed 3 of 3 (10 tests each run) on 2 CPUs.

Under Squeal the case runs at nice 10 and passes trivially, as the file's header says. The checks above were direct runs at nice 0. Nothing ran on the lab VM.

## For later (not done here)

`lowerWhile` takes any throw from `children.carriers` or `walk` as its abort, and stops lowering in silence. The product's `below` cannot throw. `EscapedChildren.carriers` reads `/proc` through `snapshot()` and `readFile`. If it ever rejects for another reason, the run's later forks keep the daemon's priority and nothing reports it. A proposed row: return from the loop only when `signal.aborted`, and continue to the next look on other errors.
