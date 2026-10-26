# 011-248 notes: what the idle-exit bound measures

Row 011-248 (wave 55 W3, brief `tasks/wave-55.md`). Worker run `08e33466`, 2026-10-26. Test only: `test/daemon/departure.test.ts`, "within 3 s of the last SessionEnd when idle, with one note", and the type of `readNoteRecords` in `test/daemon/helpers.ts`.

## The span the case times now

- **Before.** From `performance.now()` before the SessionEnd hook to the daemon's `exit` event: the hook's own time, the grace, the presence poll and the whole shutdown (`#shutdown` in `src/core/daemon/daemon.ts`: runner close, scratch removal, store close, socket close, lock release, process exit). Bound `> 2,500` and, unless `LOADED`, `< 3,500`. cand/0.1.343 CI 40324976045 attempt 1, Node 22 shard 1: 3,535 ms, `LOADED` false. The log has only the total, so how it split is unknown.
- **Now.** From the departure stamp (`lastDeparture`, the time the daemon's grace counts from, `src/core/delivery/expiry.ts`) to the stop note's `at` (the shutdown's first write, before anything it awaits). The daemon decides with `at - lastPresentAt >= graceMs`, and `lastPresentAt` is at least the stamp, on the same `Date.now()` clock, so the span is at least 3,000 ms exactly: the lower bound went from `> 2,500` to `>= 3,000`. The upper bound stays `< 3,500` unless `LOADED`: the grace, one 250 ms presence poll, and 250 ms slack for the idle daemon's timer.
- **The shutdown's own time** is not bounded in this case. A failure message names it (`the shutdown then took N ms`), so a later CI failure tells the decision from the shutdown. The 30 s `exitWithin` still catches a shutdown that hangs, and the case "with a tier running" (`:179`, `:172` before this row) bounds a shutdown after a tier: tier done to exit `< 3,000` unless `LOADED`.

## Runs (host: 24 cores; load is the 1-minute average before and after each run)

Direct runs, `env -u PLUGIN_ROOT -u PLUGIN_DATA npx vitest run test/daemon/departure.test.ts`, with a temporary log line (not committed):

| Run | Load | Grace span (new) | Shutdown | Hook | Old metric | Result |
| --- | --- | --- | --- | --- | --- | --- |
| whole file, 6 cases | 4.58 → 5.59 | not printed | | | | 6 passed |
| case alone | 5.32 → 5.78 | 3,214 ms | 58 ms | | | pass |
| case alone | 6.53 | 3,104 ms | 87 ms | 3 ms | 3,192 ms | pass |
| case alone | 6.62 | 3,096 ms | 57 ms | 3 ms | 3,155 ms | pass |
| case alone | 6.57 → 7.03 | 3,101 ms | 52 ms | 3 ms | 3,155 ms | pass |
| break: exit 1 s past the grace | 6.30 → 6.12 | 4,099 ms | 46 ms | 2 ms | 4,146 ms | fail: `expected 4099 to be less than 3500` |
| break: exit 1 s before the grace | 5.79 → 5.48 | 2,094 ms | 52 ms | 2 ms | 2,147 ms | fail: `expected 2094 to be greater than or equal to 3000` |

Both breaks changed `if (gone < graceMs) return;` in `src/core/daemon/lifecycle.ts` (`graceMs + 1_000`, `graceMs - 1_000`), so the note text stays "3 s" and only the timing can catch them. Each was reverted in the same command (`git checkout src/core/daemon/lifecycle.ts`). The daemon tests compile `src` on every run (`buildCli`), so the break was in the daemon under test.

## Should `LOADED` read a CI runner?

No change. `LOADED` is the whole machine's 1-minute load above 8, not per core: a 4-vCPU GitHub runner reads loaded only past twice its cores, and the failing run read `LOADED` false. After this row the timed span is the daemon's own grace and poll in an idle process, which the runner's speed reaches only through a late 250 ms timer; the hook and the shutdown, where a busy runner spends its time, are outside it. So the bound should keep running on CI, where it guards the human's 3 s rule. Turning `LOADED` on for CI would drop that check from every CI run. `LOADED` is shared by `hold`, `lifecycle`, `serving` and `step-down` tests too; a per-core reading would change them and is outside this row.

## For the next worker

- The case at `:179` has the old shape: it times tier done to the daemon's exit, so it holds the fixture Vitest's reporting, the results' store and the whole shutdown. It passed in the failing CI run (7,445 ms for the case). If it fails on a runner by tens of milliseconds, the stop note cannot serve there: the grace ends while the tier still runs, so the note comes before `doneAt`.
- The "SIGKILLed harness" case (`:207`) also counts to the exit, but with a 9,000 ms bound against about 8,000 ms of heartbeat and grace.
