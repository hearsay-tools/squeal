# 011-203: why the step-down cancel carried the 001-159 note in the `edit` case

Wave 37 W1, worker c68447bc, from main 7fbbfd54f (0.1.307). Shape: repair.

## Answer

The test compared the whole cancel message. On main CI 40175055145 (attempt 1, Node 22 shard 3/3) the Vitest tier's failure was the cancel and, on the next line, the adapter's 001-159 note:

```
run cancelled: the daemon stepped down for newer hooks
vitest adapter: the run may have executed bytes no check key names, since test/held.test.ts was written during this run and ended as it was (task 001-159)
```

The test now compares each cancelled run's first line with `cancelled("step-down")` (12abad0dd). The adapter appends any withhold reason after the failure (`dropFiles`, `src/runners/vitest/moved.ts:159`), so the cancel is always the first line. A mutation of the expectation to `cancelled("stop")` fails both cases.

The note is wrong for this fixture. The fixture appends to `test/held.test.ts` once, before the revision that starts the edit's tier. Nothing writes the file during the run. The cause is in the daemon: a pass can store a stat taken before a write beside the hash of the bytes after it. Row 011-204 fixes that.

## The touch path

- The note comes only from a touch the adapter heard during its call: `invalidate` hears `kind: "touch"` paths (`src/runners/vitest/adapter.ts:390`), and at the run's end `withoutTouched` withholds the files that may have read them (`adapter.ts:575-636`).
- A touch reaches the runner only from `touchedUnchanged` (`src/core/scheduler/stability.ts:60`), through `reconcileBatch` (`src/core/scheduler/batch.ts:48`) and `fetchRunnerPart` (`src/core/scheduler/refinement.ts:111`): the path's stat moved since the stat cache hashed it, and its bytes hash as before.
- One write can give that only when the cache holds a stat older than the bytes it hashed.

## The pairing

`diffCandidates` (`src/core/revision/reconcile.ts:92-99`) takes each candidate's stat from its caller (the watcher's `lstat`, or a reconciliation pass's), and hashes the file when the stat moved or the entry is racy. It stores the candidate's stat with the hash and never stats again after the read. When a write lands between the stat and the read, the cache holds the old stat with the new bytes. The write's own batch then sees a moved stat over unchanged bytes: a touch.

`seedStatCache` (`src/core/hash/hasher.ts:80-90`) already guards against this. It stats before and after, and trusts the index's hash only when the two stats agree, "so a write during the read falls back to hashing the bytes".

The fixture's entries are likely racy at the edit. The daemon seeds them within 2 s of the fixture's creation (`RACY_WINDOW_MS`, `src/core/hash/stat-cache.ts:18`), and nothing hashes them again before the edit. A racy entry is hashed even on an unchanged stat, so a pass that stats the file just before the append and reads it just after stores the pairing.

## Probe

`probe/stat-pairing.ts` runs `src`'s `createFsHasher`, `StatCache`, `diffCandidates` and `touchedUnchanged` on a real file in a temporary directory. No daemon, nothing outside the temporary directory. Run: `node_modules/.bin/tsx <path>/stat-pairing.ts <worktree>`. Result on 0.1.307:

```
{"statBeforeWrite":false,"racyAtWrite":true,"firstPass":{"changes":["test/held.test.ts"],"touched":[]},"writesOwnBatch":{"changes":[],"touched":[]}}
{"statBeforeWrite":true,"racyAtWrite":true,"firstPass":{"changes":["test/held.test.ts"],"touched":[]},"writesOwnBatch":{"changes":[],"touched":["test/held.test.ts"]}}
```

With the stat taken after the append, the write's own batch has no touch. With the stat taken before it and the hash after it, the first pass reports the change and the write's own batch reports a touch.

## Local runs

`probe/loop-runs.txt`: `env -u PLUGIN_ROOT -u PLUGIN_DATA npx vitest run test/daemon/step-down-lanes.test.ts`, 20 runs in a row, 2026-10-25 09:11Z to 09:14Z, beside other workers' load (one-minute load 17.6 to 27.3 on 24 CPUs). All 20 passed, both cases.

`probe/loop-evidence.ndjson`: a temporary, uncommitted diagnostic in the `edit` case logged runs 8 to 20. Each line has the append's time and stat, the stat cache's entry after the run, the revisions with their triggers, each run's directory time and failure, and the notes. In all 13 runs there was one revision, trigger `watch`, naming both held files, about 160 ms after the append, and no note. The local runs never took the pairing.

## Not proven

Which pass took the stat before the write on the CI runner. A watch batch stats its paths after the event, so it cannot pair a stat from before the write unless an earlier hint named the file. The 30 s idle pass is unlikely there: the file's two cases took 7.5 s together. The probe shows the mechanism, not the CI path.

## Effect outside the test

An edit whose stat a pass took just before the write runs its file twice: the touch withholds it as `unknown`, and it is queued again. The 001-159 note then names a write that was not made during the run. Row 011-204: after the hash, `diffCandidates` stats again, and stores the hash with the candidate's stat only when the two agree.

## Row 011-204: the fix and its cost

`diffCandidates` now stats each path it read once more, after the read, and stores the hash with that stat. When it is not the candidate's stat, the entry is also marked racy, so the next pass hashes it again. A file gone by that stat is absent. The bytes are read before the stored stat is taken, so a write after the read moves the stored `mtime` to at or after `hashedAt`: the next batch or pass hashes the racy entry and reports the change, not a touch.

The first fix (bf1a6cb47) left the entry as cached when the two stats differed. `test/scheduler/linked-start.test.ts` ("records a file added while the feed starts") then failed 10 of 10 runs: its backend writes `src/added.ts` again, with the same bytes, at each `watch()` call. That write fell between the pass's stat and its read (stats 147 ms apart, same size and inode), and the watcher heard nothing of it, so the change waited for the next interval pass. 88765973f stores the stat taken after the read instead (the coordinator's decision).

`test/revision/stat-pairing.test.ts` holds two cases. The probe's pairing (a racy entry, a stat before an append, the hash after it, then the append's own batch) fails on 0.1.307 with `touched: ["test/held.test.ts"]` and passes with the fix. A write after the read (stat, read, write, stat), under a clock far past every `mtime`, is a change at the next pass and not a touch; it fails on 0.1.307, on bf1a6cb47, and on a mutant that does not mark a moved stat racy. The probe on the fix:

```
{"statBeforeWrite":false,"racyAtWrite":true,"firstPass":{"changes":["test/held.test.ts"],"touched":[]},"writesOwnBatch":{"changes":[],"touched":[]}}
{"statBeforeWrite":true,"racyAtWrite":true,"firstPass":{"changes":["test/held.test.ts"],"touched":[]},"writesOwnBatch":{"changes":[],"touched":[]}}
```

Cost: one `lstat` per path the pass hashes. A path whose stat is unchanged and whose entry is not racy is not hashed and gets no extra stat. `probe/stat-cost.ts` on this repository's 7,750 tracked files, 2026-10-25 09:28Z, one-minute load 23 on 24 CPUs: hashing all of them took 575 ms (median of 5), stat-ing all of them 116 ms, and one stat 40 µs (median of 2,000). So an edit's batch that hashes a few files pays well under 1 ms more, and a pass that hashes every tracked file (after a checkout) about 20% more than its reads.
