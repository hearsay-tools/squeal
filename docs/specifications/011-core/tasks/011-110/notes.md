# 011-110 notes (W6 of wave 13, 2026-10-22)

The stopping reading: 011 C9 as amended 2026-10-22 (repair W3 and row 011-110), `tasks/011-32/notes.md`, `tasks/011-34/notes.md`. Base: `c30f5181a` (cand/0.1.262). Brief `tasks/wave-13.md`, W6.

## The second source

CI 39769624080 (Node 22 1/3), on `c30f5181a` with this row's first fix in, failed `test/daemon/handover-tier.test.ts:161`: two `--await-lock` daemons, with `lockWaits` 1. The hooks spawned one; `squeal start` spawned the other.

The coordinator's hypothesis holds. `finishHandoff` passed `claims()` the record that `stoppingDaemon` read before `start` sent `stop`. A successor that registers in between clears the claim and writes its record in one transaction (`#register`). Then:

- with the old daemon's record read, `liveHandoff` finds no claim for the old incarnation, and `claimHandoff` writes a new one naming it, so `start` spawns with the lock wait;
- with the record already cleared when `start` read it, `readHandoff` finds no claim, which `claims()` read as "no handoff claimed", so `start` spawns with the lock wait.

A third path of the same kind, found by reading and not by a test: `stoppingDaemon` read the record after the status. A successor that registered between the two reads gave `start` its record as the stopping daemon's; `claims()` then wrote a claim naming the successor itself.

The CI log has no timing for the failed run (the assertion came before the test's log line), so which of the paths it took is not known; the fix closes all three.

## What changed

`src/cli/start.ts`:

- `stoppingDaemon` reads the record before the status. With a status that says stopping, the record is then the stopping daemon's or none: records go old, cleared, successor, and a successor's registration ends the claim the status read.
- `claims(root, old, now)` takes the stopping daemon's start time (`ping.startedAt`, else the record's), and reads the record again with the claim in one write transaction, as a daemon registers both. A record of another start than `old` is a daemon that registered after the stopping one, which ended the handoff: no claim, no spawn with the lock wait. The stopping daemon's own record, or none, decides as before.
- `finishHandoff` then goes on as for a joined claim: with the lock free it spawns with no lock wait (`ensureDaemon` probes first, so a serving successor gets no spawn), then waits for a daemon of at least its version.

## Decisions the spec did not settle

- **A daemon of another start counts, whatever its version.** Every registration clears the claim, so any registration ends the handoff. A `start` that spawned a lock waiter beside it would add a second process: one that gives up at once (the record is at least its version, `takenOver`) or one that waits 120 s for an older daemon's lock. `start` then waits for a daemon of at least its version, as before, and past its bound says what holds the lock.
- **With no record of the stopping daemon and no ping, any record found is a later daemon's.** A stopping daemon never writes its record again. Accepted edge: `recordedDaemon` returns `null` when the store stays busy past 1 s, so a busy read while the old record is still there, with no ping, makes `start` claim nothing. The D10 order clears the record before the socket goes, so a ping that finds no socket finds no record; only a ping that failed another way meets the edge, and then the hooks' claim still spawns the successor.
- **The read is in a write transaction** (`BEGIN IMMEDIATE`), also when it only reads, so the record and the claim are one state and no registration lands between the read and the claim's write. A store busy past `STATUS_BUSY_TIMEOUT_MS` throws, and `start` spawns as before (`claims()` returns true).

Proposed C9 sentence, for the coordinator, after "with none when it joined a live one": "A `start` that finds a daemon registered after the stopping one claims nothing and spawns nothing with the lock wait: that registration ended the handoff (row 011-110: a successor that registered while `start` read the store got a second one beside it)."

## Tests

| Test | What it checks | Red on base |
| --- | --- | --- |
| `test/daemon/start-handoff.test.ts`, "with its record, a successor that registered after start read it ends the handoff: no claim, no spawn" | A stand-in 0.1.0 daemon, stopping, record kept, a hook's live claim, the lock held. Its answer to `start`'s `stop` registers the successor first (record and cleared claim in one transaction), then the successor answers the pings. `start` exits 0, writes no claim, spawns nothing. `SQUEAL_CLI` is a stub that logs each spawn's arguments. | Yes: a new claim from `0.1.0@…#old` to this version |
| same, "with its record cleared, …" | The same with the old daemon's record cleared first. | Yes: one spawn, `daemon <root> --await-lock 120000` |
| `test/daemon/handover-tier.test.ts` | The successor count is unchanged; a count above one now names each waiter's source, by its parent read from `/proc` at first sight: "this test's hooks", "squeal start" or the parent's pid and arguments. | Not a new check |

The stand-in comes from `test/cli/fake-daemon.ts`. `daemonSocket` pings before `stoppingDaemon` does (`locateDaemon`), so the stand-in answers by state, not by order: the old daemon until the successor registered, then the successor.

## For the next row

- The two new tests wait 2 s after `start` returns before they read the spawn log; a stub's Node start on this host takes well under that. A spawn that lands later than 2 s would pass the "no spawn" check, so the claim check is the one that does not depend on time (it covers the first case only).
- During this row, `start-handoff.test.ts`'s 0.1.31 test ("exits 0 once the successor serves") failed once, at its `squealEvidence` check (`daemon: false`), while Squeal started 109 test files beside it; it passed in 6 runs after. The assertion now prints `start`'s output on failure. Not explained: a 0.1.31 daemon may clear its record after it lets go of the lock, so a successor that registered reads as no daemon for a moment; no run showed it.
