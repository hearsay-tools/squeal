# 011-271 notes: `run --slow --wait` waits through delayed acceptance

Row 011-271 (`tasks/wave-60.md` W1, gh-119). Worker run `c90dd5a3`, 2026-10-31. Baseline: `b34b00682`.

## What changed

- **One budget.** `runSlowCommand` (`src/cli/run-slow.ts`) takes the clock once, before the `run-slow` request. With `--wait <ms>`, `taken()` polls the scheduler until `start + ms`, not for the fixed 10 s (`RECORD_WAIT_MS`). Once the scheduler takes the request, `statusWaitCommand` gets `ms` minus the time the acceptance used, at least 0.
- **Pending with `--wait`: exit 3.** When the budget ends with the request still pending, the command prints one line and exits 3 (spec 004 D9: no verdict). The result wait does not start, so no `sync` is sent:
  `Returned on timeout after 3.1 s: the daemon has not taken slow tier request s1 yet, so no slow file has a result. The daemon takes it once its current work allows; \`squeal status --wait 60000 <slow test file>\` then waits for that file's result.`
- **Pending without `--wait`: exit 0.** After 10 s the receipt is unchanged (`Slow tier requested (request s1); the daemon takes it once its current work allows`); the exit is 0, not 1. The daemon has the request; it did not fail.
- `taken()` no longer prints the pending case. It returns `{ pending: requestId }`, and `pendingText` prints it. Its error branches are unchanged: an unsupported or failed request and a daemon that stops before it takes the request still exit 1.
- Help (`src/cli/main.ts`): `--wait` waits up to `<ms>` in all, first for the daemon to take the request, then as `status --wait` does; exit 3 when the ms end with the request or a slow file pending.

## Tests

`test/cli/run-slow-accept.test.ts` (new). Each `run-slow-status` poll moves a faked `Date` (only `Date`; timers stay real) on by 1.5 s, so 10 s of acceptance passes in about one second of real time. All four tests failed on `b34b00682` and pass with the change:

1. Taken at 15 s under `--wait 20000`: it reaches the result wait and returns on quiet, exit 0.
2. Taken at 15 s under `--wait 16000`, slow file never finishes: the result wait times out in less than 8 s (it gets about 1 s, not 16 s), exit 3.
3. Never taken under `--wait 3000`: the pending line, exit 3, no `sync`.
4. Never taken without `--wait`: the receipt after 7 polls (10.5 s), exit 0.

Kept, unchanged and passing: prompt acceptance, no slow files, unsupported and older daemons, no daemon (exit 1), usage errors (`run-slow.test.ts`); queued slow file waits, timeout exit 3, news, fast files (`run-slow-wait.test.ts`); held slow files (`run-slow-held.test.ts`). A failing slow result ends the wait on news with exit 0, as before; this row does not change it.

## Decisions the brief did not settle

- **The clock is `Date.now`, as `taken()` used before.** `waitForStatus` uses `performance.now`. Mixing them only matters if the wall clock jumps during the acceptance. `Date` made the test cheap to fake without freezing the status wait's own clock.
- **The budget starts before the `run-slow` request**, after the worktree root and the socket path are resolved. Those two steps are local and short.
- **The pending line starts with `Returned on timeout after N s:`**, the form a status wait's verdict line has, so an agent reads it the same way. N is the time measured, not the budget.
- **The next command is `squeal status --wait 60000 <slow test file>`.** The plain `status --wait` does not hold for slow files (004 D9), so a named wait is the one that waits for a slow result (`research/issue-119.md` Q4). The CLI does not know the slow files before the scheduler takes the request, so the line names a placeholder, not paths.
- **A daemon that stops before it takes the request still exits 1** with or without `--wait`. 004 D9 says a slow wait without a daemon exits 3; changing this is outside the brief's seam, so it stays as it was.

## For the next worker

- `run --slow` has no `--json`, so there is no JSON form to keep in step.
- `src/cli/run.ts` has its own `RECORD_WAIT_MS` (10 s) for `run --all`/`--fast` checkpoints. It already takes a caller's deadline (`deadline ?? Date.now() + RECORD_WAIT_MS`); this row does not touch it.
