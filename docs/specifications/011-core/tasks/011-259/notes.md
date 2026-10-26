# 011-259 notes: a group member read during its exec is read again

Row 011-259 (`tasks/wave-55.md` W4). Worker run `5c5a5267`, 2026-10-26. Baseline: row 011-257's branch head (`c0346c72e`). Files: `src/core/daemon/escaped.ts`, the new `test/daemon/escaped-exec-read.test.ts`, and one optional parameter in `test/daemon/low-priority-helpers.ts`.

## What changed

`#scanOrphans` read each new member of the daemon's group once and kept the mark it read for the member's life. A read of `/proc/<pid>/environ` that spans the member's `exec` reads 0 bytes (probe in `tasks/011-257/notes.md`), so a member scanned in its fork-to-exec window was kept unmarked and never lowered.

Now:

- A member read with no mark while younger than 100 ms is kept with the flag `again` (`Orphan` in `escaped.ts`). Its age is judged before the read, on the same rule as `#children`: started at `uptime() - TICKS_PER_SECOND / 10` or later.
- Each look between scans (`#orphans`, the `else` of the unchanged scan condition) reads the flagged members again (`#readAgain`). A member that shows its mark is lowered at that look. A member that is 100 ms old at a read with no mark drops its flag and stays unmarked, as before.
- A flagged member that exited or was replaced (its pid and start no longer match, `statOf`) drops its flag with no read.
- A scan that finds a flagged member reads it again too. A member without the flag keeps its mark, as before.
- The scan conditions (a reap since the last scan, or `lost`, and `ORPHANS_EVERY_MS` since it) and the intervals do not change.

## Why option A was not taken

The brief asked what triggers the next scan after an empty read when no further reap comes. Nothing does: `#orphans` scans only when the daemon's reap count (`cminflt`) changed or `lowerWhile` reported a lost descendant, and 1 s passed. The scan that read the member empty stores the current count. So "keep no mark, the next scan reads it again" alone would not lower that member during the run.

Two options went to the coordinator (request `ed6bdc0c`; reply: B approved):

- A: a new scan trigger. A scan that keeps no mark for a young member sets `#reaped` to `NaN`, as `lost` does, so the next look 1 s later scans `/proc` again. Not taken: one extra full `/proc` scan per event; the member runs at normal priority for about 1 s more; and the S1 wait (the second look at least 1 s after the shell's reap) can end before that rescan's result is applied, so S1 could still fail when the race occurs.
- B (taken): no new scan trigger. Only the flagged members are read again, at each look (every 100 ms), normally none. The member is lowered at the next look.

## The S1 race of row 011-257 is now covered

The likely cause of CI 40389788561's S1 failure (`low-priority.test.ts`, "lowers a carrier its parent left in the daemon's group before a look found it") was this race: the scan right after a sleeper's shell is reaped reads the `sleep 30 &` child during its exec, and keeps it unmarked. The child is then a few milliseconds old, so it is flagged; the next look, about 100 ms later, reads it again and lowers it. S1 waits until the second look that started at least 1 s after the reap, so the lowering comes well inside that wait.

Limit: the flag needs the read to start before the member is 100 ms old. A member whose `exec` comes more than 100 ms after its fork, read across that `exec`, is still kept unmarked. `#children` has the same limit.

## The seam

`EscapedChildren` takes an optional third constructor parameter, `source: MarkSource` (`{ environ(pid), uptime() }`, exported; default `PROC`: `/proc/<pid>/environ` and `uptimeTicks`). Only the group member's read (`#readOrphan`, through `#markOf(pid, source)`) and age (`#scanOrphans`, `#readAgain`) use it. `#children`, `#workersGone`, `#find` and `mark()` read `/proc` and `uptimeTicks` as before (`#markOf`'s second parameter defaults to `PROC`). Type changes: the new exported `MarkSource`, the new constructor parameter, the private `Orphan`. All additive.

`leaderGroup` in `low-priority-helpers.ts` passes an optional `MarkSource` to the daemon's constructor; with none, it behaves as before.

## The tests

`test/daemon/escaped-exec-read.test.ts`, Linux only. The source's reader returns `""` for the chosen reads of the group's `fast` sleeper and reads `/proc` otherwise. Its clock reads every age as the sleeper's start plus a set number of ticks, so host timing decides neither the empty read nor the age.

1. A young member whose first read is empty is lowered at the next look, through `lowerWhile`: at the third look's start, 2 reads, the second look returned it, and it is at `nice` 10. The pid in the looks' result is the check that holds under Squeal, where the test process and its sleeper already run at `nice` 10.
2. A member 1 s old at its first read with no mark is read once: through a second look and through a later scan (after another reap and 1.1 s).
3. A young member whose reads stay empty is read at each look until it is 100 ms old, then no more (3 reads over 4 looks), and stays unmarked.
4. A flagged member killed before the next look is not read again (1 read).

Before the fix, all four failed (Squeal, revision 2): the constructor ignored the source.

## Checks (2026-10-26, this host, 24 CPUs)

- Squeal, revision 4: the 4 new cases pass (`FAIL -> PASS`).
- Direct run of the new file at `nice` 0 (`env -u PLUGIN_ROOT -u PLUGIN_DATA npx vitest run test/daemon/escaped-exec-read.test.ts`): 4 of 4 pass in 4.08 s, 1-minute load 7.90 before and 7.35 after.
- `npm run lint`: clean after `biome format` on the two new or changed files. `npm run typecheck`: clean.
- `low-priority.test.ts`, the other `escaped*` tests and `test/keys/key-format.test.ts`: see the final report; they waited in Squeal's catch-up queue when these notes were written.

## For the next worker

- `escaped.ts` has 590 lines (534 before this row), well over the styleguide's 300. The group scan (`#orphans`, `#scanOrphans`, `#readAgain`, `#readOrphan`, `Orphan`, `MarkSource`, `strangersOf`, `lineOf`) is a separate concern from the stops (`#stop`, `#find`, `#workersGone`) and could move to its own module. Not done here: outside this row's seam.
- Another candidate fix from row 011-257, "never keep a 0-byte read at all", was not needed: the age rule covers the race, and a process can exec with an empty environment.
