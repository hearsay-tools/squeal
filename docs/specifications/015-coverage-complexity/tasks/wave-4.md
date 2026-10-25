# 015 wave 4: coverage leaves the daemon's main thread to the change feed

Briefed by coordinator 52e58f23 on 2026-10-25, from 011-197's findings (`docs/specifications/011-core/tasks/011-197/findings.md`, recommendation 2). Coverage is off in this repository until this row lands. 011's wave 35 (rows 011-198 and 011-199) fixes `run --all` and the change feed beside it.

## W1: 015-42

Use /worker. Shape: repair. Starts from main after 0.1.302. Outcome: with coverage on, an edit becomes a revision about as fast as with coverage off, while records are written and judged.
- Read 011-197's findings (Evidence, Recommendation 2, Not determined), `spec.md` D8 to D10, and the notes of 015-11, 015-12 and R6.
- **Writer.** The payload read, `JSON.parse` and `map` leave the main thread (`src/core/code/coverage/writer.ts`, `map.ts`). Lead: a `worker_threads` worker that returns the record.
- **Step.** Keep the loader map (`readLoaders`) until keys or results change, and count its read inside `STEP_BUDGET_MS` (`crap/step.ts`, `crap/loaders.ts`).
- **Pacing.** After a coverage step or writer job that took `d` ms on the main thread, the next one waits `setTimeout(d)`, not `setImmediate` (`code/pass/index.ts` `soon()` and the `more` chain, `writer.ts`).
- **The 01:09 to 01:27 load.** Find what kept the loop busy after the writer drained, with a `monitorEventLoopDelay` probe in a test, and fix it here.
- **Owns.** `src/core/code/coverage/**`, `src/core/code/crap/**`, `src/core/code/pass/index.ts`, and their tests. Leave `src/core/watcher/**` and `src/core/scheduler/**` alone (011's wave 35). Ask me before you edit `src/core/daemon/**`.
- **Done when.**
  - The findings' test, red first: a reconciliation pass over about 2,000 tracked files finishes within 3× its unloaded time while the writer stores payloads that take 200 ms or more each. Skip it when `LOADED`.
  - The loader map is read once while keys and results stay, and again after either changes.
  - A step's successor waits at least the step's own time (fake timers).
  - While a large payload is stored, the main thread's longest turn stays under 100 ms. Skip it when `LOADED`.
  - Records stay byte-identical. Ask me before you change one or `COVERAGE_PROVIDER_VERSION`.
  - `tasks/015-42/notes.md` gives the times before and after.
  - Lint, typecheck and `squeal run --all --wait` pass; paste the output. Do not build bundles or raise the version.

## 015-43: review of candidate 0.1.305 (015-42)

Use /reviewer. Candidate `cand/0.1.305`, pinned to the SHA named in the spawn. The range is `origin/main..<SHA>` at 0.1.302: 015-42's four commits (W1 above) and one build commit (bundles with the new `cli/coverage-map.mjs`, version 0.1.305; 0.1.303 and 0.1.304 are held by 016 and 011). Write `docs/specifications/015-coverage-complexity/reviews/0.1.305.md` and commit it on your branch.

Read `docs/specifications/011-core/tasks/011-197/findings.md`, `spec.md` D8 to D10 with their 2026-10-25 amendments, `status.md` (2026-10-25) and `tasks/015-42/notes.md`.

Check, with proof where you can:
1. **The main thread.** The bundled daemon finds `cli/coverage-map.mjs` and maps there. No coverage turn on the main thread runs long: payload maps, the first cold loader read, the sources sent to the worker. Pacing holds for `soon()`, the `more` chain, wakes, revisions and writer jobs.
2. **Correctness.** Records are byte-identical between the worker, the main-thread path and 0.1.302. The cache drops what results, records, a revision or a wake change, so no judgement reads a stale loader map, condition or signature. A failed worker loses no record. A worker that stops on an empty queue restarts on the next run.
3. **Coverage off** is unchanged: no worker, no extra pass.

Run the independent full suite under the host lock: `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`, and paste the result. Name each failing file and whether it changed in the range. Label every finding as proven, plausible or unverified. Only a proven break blocks. Verdict: PASS or FAIL.

## R8: repair of review 0.1.305 (015-42), started before the review file

Use /worker. Shape: repair. Resumes worker c9034b32 on its branch `cez/c9034b32` (at dad93c7ff). Started from the reviewer's progress messages while its locked suite waits for the host lock; `reviews/0.1.305.md` adds its proofs, and any further blocker in it joins this repair.
- **B1, a stale decoded record.** A step decodes a hit record within its budget. A newer no-hit record is then stored at the same result key, and `invalidate` (as `onStored` calls it) keeps the decoded old one. The next step stores `uncovered` pass against a no-hit record, and the unchanged summary signature keeps it after the chain ends. A record at a key is not fixed: a later run at the same key replaces it. Drop or check a decoded record when its key's record is stored again (lead: `crap/cache.ts` `invalidate`/`settle`, keyed by the stored record's identity).
- **B2, a lost record.** The candidate's `map-worker.js` exits on its `sources` message after the payload was deleted, and the job's record is lost (records `[false, true]` for two jobs). A failed worker must lose no record: each job the worker held is mapped again on the main thread, or retried (`coverage/writer.ts`, `mapper.ts`).
- **Also, if cheap:** the cold loader read is one turn of 1.0 to 1.2 s (your residue). Slice it across steps.
- **Owns** as W1. **Done when:** each blocker's sequence is a test, red first; one commit per blocker, named `fix(R8): … (review 0.1.305 Bn)`; lint, typecheck and `squeal run --all --wait`; paste. No bundles, no version.

## 015-43 round 2: re-review of candidate 0.1.305

Use /reviewer. Resumes reviewer 4a7491eb. Candidate `cand/0.1.305` at the SHA named in the message, on main at 0.1.302 (docs only moved); round 1 is `reviews/0.1.305.md` (FAIL on 1347d8452, B1 and B2; kept as `review/0.1.305-round1`). Write `reviews/0.1.305-r2.md` and commit it on your branch. The candidate is 015-42 again, plus repair R8 (`fix(R8)` commits, brief `tasks/wave-4.md` R8) and a new build commit.
- Check B1 and B2 against R8 with your own probes: hit to no-hit and no-hit to hit; an injected exit after the read with the real bundled worker.
- S1 and S2 are row 015-45, not this round. D10's wording now says each job waits its own time.
- What passed round 1: re-read only where R8 touches it (`crap/cache.ts`, `coverage/map-worker.ts`, `mapper.ts`, `writer.ts`). Confirm the candidate's CI is green.

Run the independent full suite under the host lock: `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`, and paste the result; name each failing file and whether it changed in the range. Label every finding as proven, plausible or unverified. Only a proven break blocks. Verdict: PASS or FAIL.

## R9: repair of review 0.1.305-r2 B1, invalidation at the notification (015-42)

Use /worker. Shape: repair. Resumes worker c9034b32 on its branch `cez/c9034b32` (at e3440b6fa). The human authorized this third round on 2026-10-25; it is the last one.
- Read B1 in `reviews/0.1.305-r2.md`. Its probe and its table are the test.
- **The rule.** The record-stored notification is the one owner of "a decoded record is valid". It revokes the cached records synchronously on each notification, also one that arrives while a `soon` timer is already set. The 100 ms coalescing delays only the work, never the revocation. Every writer goes through that one entry point. Lead: `CodePass.soon()` in `src/core/code/pass/index.ts` (round 2 cites `:308`, `:313`, the paced continuation at `:201`) and `StepCache.invalidate()` in `crap/cache.ts`.
- **Owns** as W1. Leave 015-44 (a same-key record after a completed judgement) and 015-45 (one shared `Pace`, the cold loader slice) alone.
- **Done when.** A test through `createCodePass` and `soon()`, where the paced continuation is due before the coalescing timer, in both directions (hit to no-hit, no-hit to hit), red first, then green. A second notification during a pending timer is covered. Record reads and decodes stay inside `STEP_BUDGET_MS`. One commit, `fix(R9): … (review 0.1.305-r2 B1)`. Lint, typecheck and `squeal run --all --wait`; paste. No bundles, no version.

## 015-43 round 3: re-review of candidate 0.1.305 (the last round)

Use /reviewer. Resumes reviewer 4a7491eb. Candidate `cand/0.1.305` at the SHA named in the message. Round 2 is `reviews/0.1.305-r2.md` (FAIL on 044da86f0, B1; kept as `review/0.1.305-round2`). Write `reviews/0.1.305-r3.md` and commit it on your branch. The candidate is round 2's, plus repair R9 (`fix(R9)`, brief `tasks/wave-4.md` R9) and a new build commit.
- Check B1 with your round-2 probe through the real `createCodePass` and `soon()`, in both directions, and with a second notification while a `soon` timer is pending.
- Re-read only R9's delta and the bundle build. Confirm the candidate's CI is green.

Run the independent full suite under the host lock: `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`, and paste the result; name each failing file and whether it changed in the range. Label every finding as proven, plausible or unverified. Only a proven break blocks. Verdict: PASS or FAIL.
