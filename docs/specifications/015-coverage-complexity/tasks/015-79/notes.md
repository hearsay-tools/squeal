# 015-79 notes: keep a record while the code store is busy

Worker d2a02b9d, 2026-10-27, from `tasks/wave-21.md` W2. Shape: repair. Baseline `3a144d8c2` (015-85 integrated). Research: `research/missing-coverage-record.md`. Spec: D8, "A busy record store".

## Answer

A write that meets a busy code store no longer loses its record. The writer keeps the mapped record and its key and retries, paced, for at most two minutes by the clock. Every completed test file that gets no record is counted by cause and told in one saved note that status lists.

## Commits

- `d64c7782a` test: red-first regressions (`writer-busy.test.ts`, one case in `writer-stored.test.ts`).
- `31b520b24` fix: `writer.ts`, new `drops.ts`, `index.ts` exports, the note callback in `daemon.ts`.

## Seam map (as built)

- `src/core/code/coverage/writer.ts`
  - `keep(job, key, record)`: opens the store, then `putParts` under `withBusySliceSync(BUSY_SLICE_MS, …)`. `isBusy` → `stall`. Any other error → `drop` (`store-open` before the store opened, `store-error` after). `onStored` runs only after `putParts` returned.
  - `stall(job)`: sets `busySince` at the first wait. Past `busyMs` (default `BUSY_BUDGET_MS`, 120 s) → `drop(job, "busy")`. Otherwise the job joins `stalled`; one timer (`retry`) moves all of `stalled` to the front of the queue after `busyBackoffMs(retries++)`. `retries` goes back to 0 after a stored record.
  - `place(job, record)`: one paced unit. It looks up the key only while `job.key` is unset, and only that look counts a result wait (`job.attempt`). With a key: if `stalled` is not empty, the job joins it without a try; otherwise `keep`.
  - `later(job)`: result waits as before; timers are in `held` (timer → job), so close can count their jobs.
  - `close()`: clears the `held` timers and the `retry` timer, counts every waiting, stalled and queued job as `closed`, closes the store, then sends one note with the rest of the counts.
- `src/core/code/coverage/drops.ts` (new, agreed with the coordinator, request 721ff0ea): `Drops` counts by cause and makes the note. `DROPPED_TOPIC = "coverage:no-record"`.
- `src/core/daemon/daemon.ts`: one option, `note: (text, topic) => this.#note(text, undefined, undefined, topic)`. No other daemon change.

## Drop causes

| Cause | When | Log line (stderr) |
| --- | --- | --- |
| `no-result` | The result waits ran out, or the result lookup threw | `coverage: no result of run <id> for <path>` (as before), or `coverage: <path>: <error>` |
| `map-error` | The payload did not map | `coverage: <path>: <error>` (as before) |
| `store-open` | `openCodeStore` gave a failure or threw a non-busy error | `coverage: <path>: the code store did not open: {...}` (was without the path) |
| `store-error` | `putParts` threw a non-busy error | `coverage: <path>: <error>` |
| `busy` | The busy budget ran out | `coverage: <path>: the code store stayed locked for <n> s` |
| `closed` | The writer closed first | none |

## The note

One topic, `coverage:no-record`, so status lists only the latest and the store keeps at most 3 (`NOTES_PER_TOPIC`). It goes at the first drop, at each doubling of the total (1, 2, 4, 8 …), and once at close if the total moved. A daemon that drops N files writes about log2(N) + 2 notes. Example:

`coverage: 3 completed test files got no record since this daemon started: 2 busy (the code store stayed locked past the retry budget), 1 no-result (its run's result was not found at its key); the last: a.test.js: the code store stayed locked for 120 s`

The last file's detail is cut at 200 characters.

## Decisions the spec did not settle

1. **The key is kept, not looked up again.** The first lookup found the result of this run at this key. A record belongs to the key, so a retry stores there even if the worktree's current key moved meanwhile. Prune deletes it with its result, as for any record.
2. **Stored time is the time of the write that succeeded.** `putParts` gets `now()` at each try; the store keeps `max(at, previous + 1)`. Provider version is `COVERAGE_PROVIDER_VERSION`, as before.
3. **The budget is per job,** from the job's first wait, whether it tried or joined.
4. **Jobs behind a busy store do not try.** Only the first job tries each round; the others join, so one round costs one slice on the main thread, not one slice per job.
5. **A busy open is retried too.** An open that throws `isBusy` (for example while it makes the 015-85 table under a held lock) stalls the job. The open does not take the slice: it waits the connection's own busy timeout (1 s). This happens only at the first open of a store that lacks a table.
6. **A result lookup that throws counts as `no-result`.** It reads the main store, not the code store. Before, it was logged with the map errors.
7. **Payloads given after close** are counted as `closed`, but no note follows, because close already sent the last one. The daemon closes the writer after the run loop, so this is not expected.

## Type changes (additive)

- `CoverageWriterOptions.busyMs?: number` and `CoverageWriterOptions.note?: (text: string, topic: string) => void`.
- `CoverageWriter.dropped(): Readonly<Partial<Record<DropCause, number>>>`.
- Exports from `coverage/index.ts`: `BUSY_BUDGET_MS`, `DROPPED_TOPIC`, `type DropCause`.

## Cost

While another connection holds the lock, each try holds the main thread for at most `BUSY_SLICE_MS` (250 ms). The shared pace then gives the same time back, and the backoff (0, 100, 250 ms) overlaps it. So a try comes about every 500 ms and takes about half of the main thread, the pace's limit, for at most two minutes after the last new job. Before, each lost record cost 1 s of busy wait plus 1 s of pace. Not measured on a production store.

## Tests

`test/code/coverage/writer-busy.test.ts` (new):
- A second process holds `BEGIN IMMEDIATE` on the code store for 1.5 s (past a busy slice and past the store's 1 s busy timeout), then commits. Three records are stored, each at or after the release, each key looked up once, `onStored` 3 times, no drop, no note, no log. A turn probe shows no turn reached 1 s. Red on the baseline: `a.test.js` had no record.
- The lock is never freed and `busyMs` is 750 ms: one `busy` drop, its log line, one note, no `onStored`, no record. `BUSY_BUDGET_MS` is 120,000.
- `no-result`, `map-error` (bad JSON) and `store-open` (`user_version` 99) are each counted and noted apart.
- Five `no-result` drops: notes at 1, 2 and 4, then 5 at close; a second close sends nothing; one topic.
- Close while two records wait for the store (fake `setTimeout`/`clearTimeout`): a pending `idle()` settles, no timer is left, `busy()` is false; after the lock is freed nothing is stored and `onStored` is not called; `{ closed: 2 }` and one note.

`test/code/coverage/writer-stored.test.ts`: a trigger makes the store refuse the write. `onStored` is not called, `{ "store-error": 1 }`, the log names the error, no record.

## Checks run

- `npx vitest run test/code/coverage/writer-busy.test.ts` on the baseline writer: 5 failed. The lock case failed on its record (`a.test.js: expected false to be true`); the others on `dropped` missing. Run directly to see the red reason.
- `npx vitest run test/code/coverage/` after the fix: 16 files, 51 passed, 2 skipped. Run directly for fast feedback before Squeal's verdict.
- `npm run lint`: clean (2,387 files). `npm run typecheck`: clean.
- Squeal at the final revision: see the worker's final message.

## Open after this row

- The instant drops (research F4) still have no named cause. The note's counts by cause can now name it after a day of dogfood.
- What holds the code store lock for 19 to 72 s (research F3) is still inferred. `busy` drops beside prune times can decide it.
- The bundles (`plugins/*/dist`) drift from the build. They are not this row's files.
