# Row 020-59: the gate saves each test file's result as soon as it finishes

Worker 91b8acef, 2026-11-14. Brief: `tasks/wave-22.md`, section 020-59. Issues #201, #202, #216.

## What changed

- **Background writes** (`keep-queue.ts`, `keep-pass.ts`, `keep.ts`). `Keeper.ran` decides a run's files as before, queues them, and starts a write pass that the run does not wait for. A pass that a busy store refuses, or that fails, hands every file it did not write back to the queue head and tells nothing. The next pass starts after a pause of 0.25, 0.5, 1, then 2 s. An early write waits at most 20 ms (`EARLY_SLICE_MS`) for the SQLite lock, because the wait blocks the gate's own process. `flush`, after the report, stops the passes, waits only for the pass that is writing (it gives up at its next busy refusal), and writes what is still queued with today's 30 s bound and today's lines.
- **Chunked runs** (`lanes.ts`, `chunks.ts`, `collect.ts`). A runner whose stored estimate covers at least two chunks of 300 s runs its files as consecutive `adapter.run` calls (`chunksFor`). The keeper hears each chunk when it ends. A runner with no stored duration, or a shorter estimate, runs in one run, as before (the parent's condition 1).
- **One lookup, several runs** (`keep-expected.ts`). `Expectations.take` takes only the run's own files of a lookup. The other files of the lookup stay expected for the chunk (or the rerun) that runs them, with the lookup's snapshot and its run of keys. The run of keys ends when the lookup has no file left, or at `close`.
- **The wait line** (`keep-write.ts`). When files were kept while the runs went on, the busy line names them: `waiting up to 30 s to keep 2 completed test files (4 kept while the runs went on): ...`. Otherwise it reads as before.
- **Seams for tests**: `CollectOptions.chunkFiles`, `GateIo.chunkFiles` (additive; neither crosses to a `--json` relaunch's child, as `hostLoad` does not).

## Decisions

1. **Granularity** (asked, request 09c2aecd; the parent chose A). A file's results, record and reads reach the gate only in the run's report, at the run's end. Per-file streaming would need adapter and type changes outside this row (option B, refused). So the gate runs a runner's files in chunks (option A). The first chunk size, `max(8, 4 × width)` files (commit 3f5306379), failed the parent's 10 % condition (Measurement below: 2.0 times one run). Asked again (request 2a75819e); the parent chose C2: chunk by estimated time. `chunksFor` counts each file at its stored seconds (a file with none at the median of the stored ones) over the widest `tierWidth` of the run's files (Vitest at CPUs − 1, as `plan.ts` reads it for the estimate; node:test at `runner.tierSize`). It splits only when that work is at least twice `CHUNK_SECONDS` (300 s); a chunk closes once it holds 300 s, and a shorter last chunk joins the one before. With no stored duration it never splits. 300 s is a policy, not a machine number: the work a killed long gate may lose, at about 2 % run overhead (6.4 s per run measured). The estimate's load scaling (row 020-57) does not enter: stored seconds only. `vitestWidth` is copied from `plan.ts` (not in this row's files).
2. **The keep window** (progress message; the parent agreed, 2026-11-14). A file is decided over the window from its lookup to the end of the chunk that completed it, as the daemon's tier barrier decides a tier, and as row 020-55 decides a rerun over lookup to rerun end. It is then written at once. An input edit after that chunk ended (in a later chunk, or after the report) does not remove the file: its run read bytes that hash to its key, so the stored result is true at that key. A gate on the edited bytes computes another key and runs the file. Removing the row would need a delete path in the store and gain no truth.
3. **Which bars are judged when.** Every bar of D17.3 is judged at the chunk's end, from that chunk's report: completed, a record, inputs unchanged and not touched, no read first seen or beyond the key, environment files, runtime identity, listed directories, and the serving daemon's revisions. The merge hold is read again at every write try, as before. The 020-55 rerun rule stays: a retried file is not decided by its chunk; its lookup stays held for the rerun. No bar needs the whole gate's end.
4. **How the early write stays as safe as today's.** Each pass opens with the input check of today's `flush` (once per queued run: `checked`). From the first try a busy store refused, or a daemon never received, every later write in every pass reads its file's inputs first (`InputCheck`, shared by the keeper). A file that moved after a busy refusal in a pass during the run is dropped without a line, as the opening check drops one; a file that moved after a lost daemon try is told as before (`InputCheck.lost`).
5. **Lines.** Nothing is told before the report: the early passes' lines are held and told at `flush`, first the decision reasons, then the held lines, then the last pass's lines, then the write-time reasons (grown key, merge hold), as today's order.
6. **Logs** (#197). When two or more chunks of one runner offer a log (a failed or unfinished file), lanes join their folders into `runs/<index>` before the log keeper copies it: `.log` files of one name are appended in chunk order, any other file of one name is the later chunk's, as a rerun's copy is today. With one offering chunk its folder goes as it is.
7. **The 020-54 rerun.** Each chunk reads the load at its own end when a file in it failed ("once per run"). The rerun runs once per runner after its last chunk, with the overloaded files of every chunk, in chunk order (the parent asked for one clear rerun step there, for row 020-60).
8. **Shared file.** The two new CLI tests run real node:test, so `test/version-sensitive.txt` lists them (its own commit, entry only).

## Proposed spec text

D17.3, append:

> Amended 2026-11-14 (row 020-59, #201, #216; the human, 2026-11-14: "Lost results: Save as it finishes"): the keeper decides and writes each run's completed files when that run ends, while the other runs go on. A runner whose estimate is long runs its selected files in chunks, one run after another, so each chunk is written while the next runs. The estimate here is the files' stored seconds, a file with none at the median of the stored ones, over the widest width the files run at (Vitest's own default, one per CPU but one; node:test's `runner.tierSize`). A runner is split only when that is at least twice 300 s; each chunk then holds at least 300 s, a shorter last part joining the chunk before. With no stored duration, or a shorter estimate, the runner runs in one run, as before. 300 s is a policy: the work a killed long gate may lose. A run costs about 6.4 s whatever its file count (`tasks/wave-22-020-59/notes.md`), so a chunk that long costs about 2 percent. Every bar above is judged over the window from the file's lookup to the end of the chunk that completed it, as the daemon's tier barrier judges a tier; a retried file's window still ends at its rerun's end. An input that changes after that window does not undo the keep: the run read bytes that give its key, so the result is true at that key, and a gate on the changed bytes has another key and runs the file. A gate killed or stopped after a chunk was written keeps that chunk's files, and the next gate on the same bytes reads them from the stores.

D17.5, replace "The keeper writes after the report is printed, so a busy store never delays the verdict." with:

> The keeper writes each chunk's files as the chunk ends (D17.3), in the background: the run never waits for a write. A write while the runs go on waits at most 20 ms for the lock; a busy store, or any failure, hands the files back, to be tried again after a pause that grows to 2 s, and nothing is told. Once the report is out, the keeper stops those tries and writes what is still queued, waiting for a busy store up to the 30 s bound counted from the first write it refused, with the lines below. When some files were kept while the runs went on, the wait's line counts them, for example `the store is busy (held by pid 4242 (node -e ...)); waiting up to 30 s to keep 2 completed test files (4 kept while the runs went on): test/e.test.mjs, test/f.test.mjs`. On exhaustion only the files still queued are not kept.

D3.4, in the row 020-54 paragraph, after "The gate reads the load once per run, when the run ends, and only when a file in it failed.", add:

> A chunk (D17.3) is a run. The files that failed under load in any chunk of a runner run once more in one rerun, after that runner's last chunk.

D3.5, in the row 020-40 paragraph, add:

> When two or more chunks (D17.3) of one runner kind offer a log, their folders join in chunk order before the copy: a `.log` file of one name is appended to, any other file of one name is the later chunk's.

D7: no report change. `runs[].durationMs` sums the chunks' runs, which run one after another.

## Done-when mapped to tests

| Done-when | Test |
|---|---|
| Store held by another process past the bound: files completed before the hold are kept, only the tail is not | `test/cli/code-gate-keep-early.test.ts` "keeps the files completed before a hold past the bound…" (three chunks of two; the hold starts before chunk 3; the next gate reads chunks 1–2 from the stores); unit: `test/code/gate/keep-early.test.ts` "keeps the files written before a hold, and only the tail waits the bound" |
| A run killed mid-way keeps its written files; the next gate reads them `from: store` | `test/cli/code-gate-keep-kill.test.ts` (spawned CLI; stored durations of an earlier key split it into the 8 quick files and the hanging file; SIGKILL to the process group while chunk 2 hangs; the next gate reads the 8 files of chunk 1 from the stores); unit: `keep-early.test.ts` "writes a run's file before `flush`, so a gate killed after it keeps it" |
| A file whose input changes before the run ends is not kept | `code-gate-keep-early.test.ts` "does not keep a file whose input changed during its chunk"; `keep-early.test.ts` "does not write a file whose input moved after a busy store refused it"; `code-gate-keep-busy.test.ts` B2 case (input moved during the busy wait). Decision 2: `code-gate-keep-early.test.ts` "keeps a file its chunk wrote though its input changes during a later chunk", `code-gate-keep-busy.test.ts` "never keeps a result at bytes its run did not read…" |
| The report comes first; the command returns within the bound after it | `code-gate-keep-early.test.ts` first case: order `report, wait, return`, report-to-return under 10 s with the bound skipped; `code-gate-keep-busy.test.ts` cases keep `["report", "wait"]` |
| Parent C2: a short gate runs in one run; a long estimated gate splits into chunks of at least the bound; a run killed after a chunk keeps that chunk | `test/code/gate/chunks.test.ts` (no durations, under twice the bound, chunks of at least 300 s, width, median for unknown); `lanes-chunks.test.ts` "splits a long stored estimate into chunks, and runs a short one in one run"; `code-gate-keep-kill.test.ts` (seeded stored durations split the real gate) |
| Parent condition 4: D18 order, budget, notStarted, early stop, logs, rerun as before | `test/code/gate/lanes-chunks.test.ts` (chunks in order and told one by one; one chunk = one run; first chunks of all runners start at once; one rerun after the last chunk; no chunk after the deadline, its files `notStarted`, `timedOut`; early-stop files go to no chunk; joined and single logs); `lanes-retry.test.ts` unchanged and passing |

## Checks run

- `pnpm run typecheck`: pass. `pnpm run lint`: pass (3431 files).
- Squeal affected verdicts, `squeal status --wait`:
  - `test/code/gate/{keep,keep-busy,keep-early,keep-daemon,keep-daemon-lost,keep-daemon-wire,keep-rerun,keep-grown,keep-grown-daemon,stored}.test.ts`, `test/run-evidence/keeper.test.ts`: no known failures.
  - `test/code/gate/{lanes,lanes-retry,lanes-chunks}.test.ts`: no known failures.
  - `test/cli/code-gate-keep{,-busy,-early,-kill,-node-test,-stop}.test.ts`, `test/version-sensitive.test.ts`: no known failures.
  - After the change to the time rule: `test/code/gate/{chunks,lanes-chunks,lanes-retry,collect-lanes,collect-budget}.test.ts`, `test/cli/code-gate-keep-{kill,early}.test.ts`: no known failures at revision 47.
  - `test/code/gate/{collect,collect-lanes,collect-retry,collect-early,collect-budget,collect-kept-log,collect-stored}.test.ts`, `test/cli/code-gate{,-log,-retry,-stored,-relaunch}.test.ts`: no known failures.
- Not run: `pnpm run build` (the wave forbids it in a worker tree), a full suite (CI's).

## Measurement (the parent's condition 2)

Probe `probe/chunks.probe.ts`, run 2026-11-14 17:19Z as a job (exit 0), raw lines in `probe/evidence-2026-11-14.jsonl`. 240 Vitest files that each sleep 30–1230 ms (no CPU work), each loading its own changed module, a fresh repository per gate, 24 CPUs. The default chunk size here is max(8, 4 × 23) = 92 files, so 3 chunks.

| Gate | One-minute load before → after | Report at | Return at | Adapter runs (ms) |
|---|---|---:|---:|---|
| One run | 17.94 → 22.15 | 12.3 s | 12.7 s | 9728 |
| Default chunks (3) | 22.15 → 39.66 | 25.4 s | 25.6 s | 6724, 8985, 6792 |

Then the load passed 24 (39.66) and the probe skipped the other 7 gates, as designed. One pair only, and the load rose during the chunked gate, so the size is not confirmed. But the gap is large: the chunked gate took **2.0 times** the one-run gate (+12.8 s, about +100 %), about 6.4 s for each chunk after the first. A Vitest run of 92 files took 6.7–9.0 s against 9.7 s for all 240, so most of a run's time does not depend on its file count (per-run work in the Vitest adapter: invalidation, the uncovered-files pass, the coverage take; not measured apart here). This is over the parent's 10 % limit. Asked the parent (request 2a75819e): the parent chose C2, chunks by estimated time of at least 300 s each (Decision 1). At 6.4 s per run, a 300 s chunk costs about 2 %; that figure rests on this one pair. Not measured: the time rule itself on a long real gate, and the per-run cost apart from load.

## For the next worker

- Row 020-60 replays its rerun step onto `runLanes`: the rerun files are built in one place (`reruns` in `runLanes`), from every chunk's `overloaded`.
- `chunks.ts` copies `vitestWidth` from `plan.ts`.
- The early passes hold the worktree's daemon lock only while a pass writes, as `flush` held it.
