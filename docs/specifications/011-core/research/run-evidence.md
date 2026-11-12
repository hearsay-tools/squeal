# Run evidence: one module for what decides whether a run's result is saved

Design brief from the architecture review of 2026-11-12 (main at `099a1b0a9`, 0.1.448; Cezar task af6c0b3f, report artifact d8b46fe2, card 1). Terms: `GLOSSARY.md` (Run evidence, Store decision, Observed read, Touched input, Keep). The decisions below are the human's, taken one at a time on 2026-11-12. Rows 011-319 and 011-320.

## Problem

Two callers save a test file's result at its key: the daemon after its own run, and `squeal code` when it keeps a file it ran (spec 020 D17.3). Both must answer one question first: may this finished run's result be saved, and under which key. The answer has two halves.

- **The facts.** A copy of the input files' state before the run. After it: which inputs changed, which were written and ended as they were, what the run read beyond its key, which environment files it loaded, whether the runtime's identity moved, whether a merge holds an input.
- **The store decision.** One pure function over those facts, `storeDecision` (`src/core/scheduler/store-decision.ts:151`).

The store decision has one owner. The facts do not.

- The daemon gathers them in four places: `startTier` copies the inputs (`tiers.ts:654`), `TierRecords.#ended` and `#prepare` read what moved and what the run read (`record.ts:214-280`), `#barrier` applies the touch rule (`record.ts:315`), and `tierEnd` shapes them for the verdict (`store-decision.ts:42`).
- `squeal code` gathers its own subset in `Expectations.add` (`src/core/code/gate/keep-expected.ts:50`), `Keeper.#keepable` and `steadyOf` (`keep.ts`), from the same small helpers (`snapshotInputs`, `changedSince`, `observedGrowth`, `environmentFiles`), and writes its own decision as a filter. It does not call `storeDecision`.

Each review blocker on the keeper was a fact the daemon already gathered:

| Review | Blocker | Half |
|---|---|---|
| `020-quality-gate/reviews/0.1.433.md` B1 | An input written and restored during the run: the daemon withholds, the keeper kept the pass | facts |
| `0.1.433.md` B2 | Two node:test projects overwrote each other's copy of the inputs | facts |
| `0.1.444.md` B2 | Inputs changed while the write waited for a busy store, and the file was still kept | write time |

Three blockers in two reviews is a small count, from the keeper's first days. It shows where the cost was, not how large it will be.

The keeper's own unit test stubs 6 of `WorktreeKeys`' 48 members (`test/code/gate/keep.test.ts`); the cases that matter run through the CLI with real git and real runners (23 tests in 6 files under `test/cli/code-gate-keep*`).

## Decisions (the human, 2026-11-12)

1. **The module owns the facts and the verdict** ("B: facts and verdict"). It copies the input state before a run, reads the run evidence after it, and gives a store decision per test file with its reason. It also answers "are this file's inputs still the bytes the run read" for a caller that writes later. The daemon and `squeal code` act on the decision in their own way: the daemon queues, withholds and re-keys; `squeal code` keeps or does not keep. The write stays with each caller. The daemon's record write (`record-tier.ts` `storeFile`) is not touched.
   - Rejected: the store decision only (it would have prevented none of the three blockers), and facts, decision and write (it changes the write every daemon result goes through; it does not make SQLite lock waits less frequent, only alike).
2. **Move first, then the stricter checks** ("B: move, then checks 2-4"). Row 011-319 moves the code and changes no behaviour. Row 011-320 makes `squeal code` apply three checks the daemon applies and it does not. The fourth difference is a product question of its own and becomes a proposed row.

## The differences between the two callers

Read in source code on 2026-11-12; not run.

| # | Evidence | Daemon | `squeal code` | After this work |
|---|---|---|---|---|
| 1 | The run read a path its key lacks, and the path was known before the run | Adds it to the file's observed reads and stores at the grown key | Does not keep | Unchanged. Proposed row of its own (below) |
| 2 | The runtime's identity moved during the run (`TierFile.runtimePolicy`) | Runs the file again | No check | 011-320: not kept |
| 3 | A merge holds a path the key names (`heldFiles`, 011 C9) | Stores nothing until the merge ends | No check (it uses `healsUnheld` for heals only) | 011-320: not kept |
| 4 | An editor's scratch file moved in a listed directory (`scratchUnstable`, row 011-117) | Discards | No check | 011-320: not kept |

Rows 2 to 4 make `squeal code` stricter: fewer kept results in rare cases, never a wrong keep. A lost keep costs one more run of that file at the next `squeal code`.

**Difference 1, a question of its own.** In this repository 1,051 of about 1,700 test files (62%) have at least one observed read, median 10 (the `observed.` meta row of this clone's store, read on 2026-11-12). `squeal code` copies the observed reads a daemon recorded (`gate/stored.ts:242`), so the difference shows only when a run reads something new. In a clone where no daemon ever ran there are no recorded reads, and by the source `squeal code` then keeps no file that reads beyond its closure. That case was not run. Closing it means `squeal code` records observed reads itself: a new write from a one-shot command to a shared row (3.7 MB here), against spec 021's goal of fewer writers.

## Coordinator's calls (repo-local; the human may overturn)

- **`storeDecision` stays where it is, unchanged, in 011-319.** `test/keys/validity/compare.test.ts:155` and `reach.test.ts:64` guard `src/core/scheduler/store-decision.ts`: a stored row's meaning rests on it. The module calls it. Neither row moves the key format.
- **`squeal code` passes the facts it has.** The daemon's decision also reads ledger state (a newer run has the file, the file left the ledger). `squeal code` has no ledger: its files are held at the key they ran under. It keeps a file only on "store at the key it ran under", and every other decision is "not kept" with the decision's reason in the note it already prints.
- **011-319 keeps today's keeps exactly.** The module takes each kind of evidence from a source the caller supplies. In 011-319 `squeal code` supplies what it reads today (changed, touched, observed growth, environment files). In 011-320 it supplies the other three.
- **The daemon's environment step reads and re-keys in one call** (`rekeyEnvironments`). The module reads; the daemon applies the re-key as today. The worker reports if the two cannot be separated without a change of order under the scheduler lock.
- **The touch rule's retry stays the daemon's.** `Withholds` (one more run per key after a touch, task 007-30) is what the daemon does with a withheld decision. The module only says "withheld, and for which paths".
- **With a serving daemon, `squeal code` still gathers the evidence and decides in its own process.** Spec 021's row 021-20 part two moves only the write to the daemon (`daemon/keep-request.ts` on `cand/0.1.450`). The module keeps two callers.
- **Location.** A folder of its own under `src/core/`, named for the term, with one entry file (no barrel, row 015-110). The gate already imports the scheduler's helpers, so no import rule changes.
- **Tests: replace, don't layer.** The new test surface is one table at the module's interface: the input state before the run, what happened during it, and the run's report in; the store decision and its reason per file out; over a scratch store and a temporary tree, with no runner and no daemon. 011-319 runs the table with the daemon's sources and with `squeal code`'s sources, so each difference above is one visible row of expectations. Then:
  - deleted once the table covers their cases: the evidence cases of `test/code/gate/keep.test.ts` (with its `WorktreeKeys` stub), `test/cli/code-gate-keep-touched.test.ts`, `code-gate-keep-observed.test.ts`, and the per-lookup cases of `code-gate-keep.test.ts`;
  - stay: one CLI case per runner that a kept file is read by the next run and by a daemon (`code-gate-keep.test.ts`, `code-gate-keep-node-test.test.ts`), the busy-store tests (`keep-busy`, `code-gate-keep-busy`), `code-gate-keep-stop.test.ts`, spec 021's socket tests, and the key validity cases;
  - the daemon's scheduler tests of the same facts (`test/scheduler/barrier.test.ts`, `touched.test.ts`, `withheld-touch.test.ts`, `observed-growth.test.ts`) stay in 011-319 as the proof that the daemon's behaviour did not move. The worker lists which of them the table repeats; removing those is a later quality row.

## Not in scope

- The daemon's record write, its busy-store retry and the keeper's busy-store wait (spec 020 D17.5, spec 021 D1, D2). Review card 9 (one write path that owns the busy rule) is spec 021's.
- Difference 1 (observed reads without a daemon).
- Keying test files "as the daemon would" outside a daemon (review card 11) and the gate's assembly in the CLI.
- Any change to the store design (ADR 0002) or to a key.

## Rows (spec 011; approved by the human, 2026-11-12, "A: approve, land, start")

1. **011-319, one run evidence module, behaviour preserved.** The daemon's record step and the keeper take their evidence and their store decision from it. Done when: no file outside the module calls `snapshotInputs`, `changedSince`, `barredByTouch` or `prepareObserved` to decide a store; `store-decision.ts` is byte for byte as before; the table test covers every decision kind for both callers; the keeper's and the scheduler's existing tests pass unchanged, less the cases the table replaced, each named in the notes.
2. **011-320, `squeal code` applies the runtime, merge-hold and editor-scratch checks.** After 011-319. Spec 020 D17.3 is amended to list what bars a keep. Done when: the table's `squeal code` column equals the daemon's for these three; a kept file is never one the daemon would not have stored at the key it ran under.

Proposed, separate (board row `keep-observed-without-daemon`, not approved): "`squeal code` keeps no file with observed reads where no daemon has run" (difference 1), with the measurement above and a run of the no-daemon case first.

## Process

This is product code in `src/`. A coordinator for spec 011 runs the two rows, one worker each. Each candidate needs a passing review before main (`docs/process.md` steps 5 and 6). Order and collisions:

- 011-319 starts after spec 021's row 021-20 part two lands (`cand/0.1.450`, second repair running on 2026-11-12): it owns `keep.ts`, `keep-write.ts` and `keep-sent.ts` until then. Row 020-30 owns `test/code/gate/keep-busy.test.ts`.
- 011-319 edits `src/core/scheduler/record.ts` and `tiers.ts`, which other 011 rows share. One worker; disjoint ownership as the coordinator sets it.
- Spec 020's coordinator (31e1d860) holds row 015-126 (#167, one measurement for daemon and CI). This module is one of its parts; the coordinator of these rows tells it before dispatch.
