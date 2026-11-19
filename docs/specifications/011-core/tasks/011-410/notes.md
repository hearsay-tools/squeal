# 011-410 notes: process lowering stops only on its abort

Row 011-410 (repair), wave 124 W3. Worker run `9ae96b0f`, 2026-11-19. From `tasks/011-409/notes.md` "For later" and `reviews/011-409.md` S1.

Files: `src/core/daemon/low-priority.ts`, `test/daemon/low-priority-errors.test.ts` (new). `escaped.ts` and the callers (`escaped.ts` `afterEachRun`, `runner-host/workers.ts` `hostWorkers`) are unchanged.

## Change

`lowerWhile` used one `try/catch` around its whole loop and took every throw as its abort. Now:

- Only `signal` ends it. The loop runs `while (!signal.aborted)`. The `sleep` between looks is the only place an abort error is expected; it returns there.
- A rejection from `children.carriers` is caught for that look. When the signal has aborted by then, it returns quietly. Otherwise it is reported and the look goes on to walk the carriers it already lowered. `lost` stays set, so the next look asks for the group's orphan scan again.
- A throw from one carrier's `walk` is caught for that carrier only. The other carriers are walked, and what the look found is still lowered. The failed carrier's `walked` time is not updated, so the next look walks it again, also past its first second.
- An outer catch around the look reports anything else (for example from `lower`) and the loop goes on.
- Report: a new optional last parameter `report: (message: string) => void`, default `process.stderr.write` (the daemon's stderr is the worktree's log file when spawned, `src/cli/daemon.ts`; the runner host writes its errors there too, as `host.ts` does). The text is `squeal: lowering the test processes of <lane> failed, the next look retries: <message>`.

## Decisions

- **Once per message, per process.** The set of reported messages is module-level, so a daemon reports a repeated failure once in its life, not once per run or per look. It holds at most 100 messages; past that nothing more is reported, because a message that names a pid can differ on every look. The brief said "once per error message"; per process is my reading of "without repeating every look" in the review.
- **No new note path.** The review proposed "the daemon's existing note path". `afterEachRun`'s `note` writes run notes (stops, leftovers) into the run log; `hostWorkers` in the runner host has no note. Routing through `note` would change both callers and the `RunNote` meaning, outside W3's files. stderr reaches the daemon log in both processes. The coordinator can ask for a note path as a later row.
- **Per-carrier walk catch, not per-look.** A per-look catch would skip `lower(fresh)` for carriers found on the same look. They are in `lowered` already, so they would never be lowered. Catching per carrier avoids that.

## Type change

Additive: `lowerWhile` gains an optional seventh parameter `report`. No other signature changes. No key-format effect (daemon process handling only).

## Proposed spec text

001 D11 Capacity, **Priority**, after "…the polling interval plus the look's own time and the event loop's delay, with no hard deadline.":

> Only the run's end stops the looks. A look that fails to list the marked children, or to walk one lowered process, is reported once per message on the daemon's error output, and the next look tries again; what the failed look missed is lowered then (row 011-410, review 011-409 S1).

## Tests

`test/daemon/low-priority-errors.test.ts`, three cases:

1. A walk that throws on looks 2 to 4, then lists a late sleeper: the late sleeper reaches nice 10, the loop has not ended, and the message is reported exactly once.
2. `carriers` rejecting on looks 1 to 3, then listing a sleeper: the sleeper reaches nice 10, the loop has not ended, one report.
3. An abort while a `carriers` call is in flight that then rejects: the loop ends and reports nothing.

Each case uses a unique message, since the dedupe set is per process.

Coordinator repair (request 33d22591, 2026-11-19): at nice 10, as Squeal runs the file, cases 1 and 2 failed with `expected [] to have a length of 1 but got +0`. Cause: a sleeper started by a test process at nice 10 is at nice 10 already, so the poll for nice 10 ended before the look that throws, and no report existed yet. Now each case waits for the look after the one that lowers (walk 6, look 5; a look lowers what it found before the next starts), then asserts the loop has not ended, the priorities and the single report. At nice 0 the priority check still proves the lowering; at nice 10 the look count and the report carry the check. Red against the old `low-priority.ts`, at nice 0 and at nice 10: cases 1 and 2 fail at once with `expected { walks: false, ended: true } to deeply equal { walks: true, ended: false }` (and `looks` for case 2), `Tests 2 failed | 1 passed (3)`. Green after the repair: the three low-priority files together, `--maxWorkers=2`, 3 runs at nice 0 and 3 at nice 10 (`nice` printed each), `Tests 13 passed (13)` in all six; host load average 100 to 119 on 24 CPUs.

## Evidence

All direct runs at nice 0 (`nice` printed 0), `timeout`, `--maxWorkers=2`, on this host at load average about 119 on 24 CPUs (other coordinators' work; no artificial load).

- Red: the new file against the old `low-priority.ts` (HEAD copy put back temporarily): cases 1 and 2 failed after their 5 s poll (`Tests 2 failed | 1 passed (3)`); case 3 passed, as the old code also ended on abort.
- Green: `test/daemon/low-priority-errors.test.ts`, `test/daemon/low-priority.test.ts`, `test/daemon/low-priority-retry.test.ts` together, 3 of 3 runs: `Tests 13 passed (13)` each (21 to 26 s).
- `pnpm exec biome check src/core/daemon test/daemon`: clean after `--write` formatting. `pnpm run typecheck`: no errors.
- `test/e2e/**`: no file references `low-priority`; nothing to run there.
- `squeal status --wait 60000 src/core/daemon/low-priority.ts test/daemon/low-priority-errors.test.ts test/daemon/low-priority.test.ts test/daemon/low-priority-retry.test.ts`: no verdict. The daemon stayed at revision 0 with its heartbeat 28 s and then 81 s stale; it had not stored a pass over the edits, and it did not list the new test file yet. Known failures 0. A later wait on the three test files at revision 3: `low-priority.test.ts` and `low-priority-retry.test.ts` current, no known failures; the new `low-priority-errors.test.ts` still "not a test file any runner here lists" (no include or exclude in `vitest.config.*` or `squeal.config.json` names it, so the daemon's test list had not taken in the added file yet; not looked into, outside this row). 1,277 other files that read `low-priority.ts` were still queued. Under Squeal these files run at nice 10 and pass trivially anyway; the direct nice-0 runs above are the evidence.

## For the next worker

Nothing left in this row. A possible later row: carry lowering failures into the run's notes (`afterEachRun`'s `note`) so `squeal status` can show them, if stderr is not enough.
