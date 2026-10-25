# 011-213 notes: a load retry runs once after the load gate stays closed 600 s

Worker 384f3924, 2026-10-25. Row 011-213 (gh-92), digest `triage/2026-10-25-digest.md` group B, `research/issue-92.md`. The coordinator accepted the four decisions below on 2026-10-25 (request 623c2f9b).

## Seam map

- `src/core/retry/gate.ts` (new): `LOAD_RETRY_WAIT_MS` (600000), `gateClosedSince(records)`, the earliest `gateClosedAt` among requests, and `markGateClosed(store, pending, testFile, key, at)`. It stamps `at` on each pending request at the key that has no time yet, in one transaction, and returns the earliest time. It writes nothing when the caller's read already shows a time on every request there.
- `src/core/retry/records.ts`: `RetryRecord.gateClosedAt?: EpochMs`, additive. `writeRetries` is exported for `gate.ts`; the trimming is unchanged (row 011-224's).
- `src/core/scheduler/retries.ts`: `takeRetries` is split into `dropWithdrawn`, `dueOf` and `queueDue` (complexity 32 to 9). In `queueDue`, a `load` request that meets a closed gate is stamped; once `at - since >= LOAD_RETRY_WAIT_MS` it is claimed and queued forced at the file's normal D5 priority, as an open gate's request is, and `context.note` records `loadRetryNoteText`. It runs at every look: the start, `requestRetries`, each `interval` pass (`scheduler.ts:323, 376, 636`). So the bound is met within one 30 s pass.
- `src/core/retry/text.ts`: one source for the five texts. `waitsText` takes an optional `GateWait` (`since`, `now`). `loadRetryWhenText` is the `squeal retry` reply. `loadRetryNoteText` is the daemon note.
- Status: `PendingRetry.gateClosedAt` (`src/core/types/status.ts`, additive) is set in `src/core/retry/pending.ts`. `retryText` in `src/core/status/outstanding-text.ts` passes the earliest time among the group's files and status's `now` to `waitsText`. `squeal status --json` carries the field in `pendingRetries.retries`.

## Decisions the spec did not settle

- Workers: no change. The run is one file, forced at its normal priority; C10's backlog gate already counts the host's busy cores.
- The bound is a constant, not `slow.maxDeferMs`: the digest proposes 600 s as that key's value, not a link to it.
- The wait counts from the first look that met the gate closed, not from `askedAt`. A request asked while no daemon is at its key would otherwise run at once under load when a daemon arrives (pinned by `load-retry-bound.test.ts`, the second case).
- A later session's request at the key gets its own time; the earliest at the key governs, since one run ends them all.
- The time is not reset when the gate opens while the request is not due (its file blocked or running). The wait is "at most 600 s from the first closed look", not 600 s of a closed gate without a break.
- A stamp also lands on a request another live daemon has claimed. It is harmless: that daemon already queued the run, and the gate is the host's.

## Compatibility with released Squeal

- A released reader parses the row: `isRecord` checks only the fields it knows, and keeps the object as it is.
- A released writer keeps the field. Every writer of the row spreads the record it read (`{ ...r, claim }`, `{ ...r, claim: null }`, `{ ...r, end }`) or appends to the records it read (`askRetry`, `askNoResultRun`, `askNamedRun`), and `keptRetries` only drops whole records. `test/retry/gate.test.ts` pins this for the current writers, whose code is the same as 0.1.325's. So the wait time is not lost. A released daemon does not read it, so it waits for the gate as before, without a bound.

## Tests

- `test/scheduler/load-retry-bound.test.ts`, real Vitest over the retry fixture, at load 2.00 per CPU: held past the bound, it runs, passes and ends `passed`, with the note once; held under the bound (599 s), it waits; the wait counts from the first look, not the request; a failed bounded run ends `failed` and the FAIL stays `current`, with no second run; a gate that opens before the bound runs it with no note.
- `test/retry/gate.test.ts`: the stamp, the earliest time, no write when every request has one, ended requests left alone, and the field kept by claim, release and end.
- `test/status/pending-retries.test.ts`: the three status texts, through `formatStatus`.
- `test/cli/retry.test.ts`: the reply.

## Left for others

- Spec text: C5's "waiting as long as that takes" and the gate sentence ("for `load` at the first look ... at which the one-minute load average is below the CPU count") need the amendment (coordinator).
- A slow file's load retry meets the slow lane's load guard (004 D3) after the bound: it can wait up to what is left of `slow.maxDeferMs` for that slow pass more, then runs with the slow note. Skipping the guard for it would change 004 D3's selection: a skipped guard picks the slow lane's first candidate, which need not be the retry's file. Not changed.
- `test/evals/retry-claim.test.ts` keeps the old status wording in a reference session; it is a graded literal, not formatter output, and no evals parser reads the wait text.
- The three plugins' `commands.md` have no load retry text, so they did not change.
- Bundles are not rebuilt (the bundle tests fail on drift).
