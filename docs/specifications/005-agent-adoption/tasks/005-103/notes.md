# 005-102 and 005-103 notes: a start that registers first, and a cheaper registration

Worker d998d356, 2026-11-17. Wave 20, W1 (`../wave-20.md`). Coordinator 4d2ecbfc.

## Part 1 (005-102): a failed registration still starts the daemon

`registerThenEnsure(first, register)` (`src/harness/shared/session.ts`) runs the registration, then `first.ensure()`, also when the registration throws. The registration's error is the one thrown; an ensure that fails after it is dropped. `first` `null` (a live daemon) starts nothing. Used by every path that calls `registerFirst`:

| Path | File |
|---|---|
| Claude Code and Codex SessionStart, subagent starts | `src/harness/shared/session.ts` (`startSession`) |
| Claude Code, Codex and OpenCode prompt that registers | `src/harness/shared/prompt.ts` (`submitPrompt`) |
| OpenCode register | `src/harness/opencode/bridge.ts` (`register`) |
| Pi session start | `src/harness/pi/session.ts` (`startSession`) |
| Pi run start | `src/harness/pi/run.ts` (`startRun`) |

The helper sits in `session.ts`, not `ensure.ts`, because `ensure.ts` was outside the row's files. Moving it next to `registerFirst` is a free follow-up.

Not covered: `registerFirst` itself can throw (its stop read writes when a stop mark is cleared); then nothing is ensured, as before 0.1.541, where the same read came first in `ensure`.

The hook's exit and output when the registration throws are as before 0.1.541: Claude Code's hook is silent with exit 0, Codex's silent, and OpenCode's bridge and Pi's starts throw the error to their callers. Test: `test/harness/register-fails.test.ts`, a busy store (another thread holds the write lock past the 1 s busy timeout). All six cases fail with the fix reverted (0 daemon starts).

## Part 2 (005-103)

### The view seed

`registerNow` reads the states with `statesToSeed` (`src/core/store/view-seed.ts`), the same statement as `knownStates.list` with each row's `check_id` kept beside the state, and seeds the view with `seedView`: one `INSERT OR REPLACE ... SELECT FROM json_each(?)` of `[check id, outcome, fingerprint]` per state.

Why a module of its own and not repository methods: every repository is in the key-format validity bundle (`test/keys/validity/entries/global.ts` reaches `createStore`), and the alarm (`test/keys/key-format.test.ts`) named the new repository lines as changed lines no case runs. The seed decides nothing a check stores; only delivery imports `view-seed.ts`, so it stays out of the bundle. `states.ts` only exports `SELECT_STATES` and `toKnownState`, which leaves its emitted lines as they were. No store type changed.

Why not `INSERT ... SELECT FROM known_states` (the findings' form): under a serving daemon (spec 021 D15) the hook's writes reach the store as a batch the daemon writes after the hook's read, held until the hook's output is written (row 011-288). The daemon's own state commits do not wait for that batch. An `INSERT ... SELECT` from `known_states` would read the store at the batch's write, so a state committed between the read and the write would be seeded as told and never delivered. `test/harness/view-seed-served.test.ts` holds the batch, commits a failure, and checks that the next boundary tells it; it fails for the `known_states` form. The coordinator chose the `json_each` form (request c7b7e309).

Sizes: the JSON parameter is 0.69 MB at 32,000 states and 4.48 MB at 200,000 (1 in 100 failing with a 200-character fingerprint); the D15 write line 0.76 and 4.89 MB, against `MAX_WRITE_LINE_BYTES` 32 MiB and SQLite's 1 GB string limit. No chunking.

`toView` (`src/core/delivery/delta.ts`) now has no caller in `src/`; the equality test uses it as the reference. Its removal is for the file's owner.

### The indexes

Both are additive indexes made at open with no `user_version` raise (011 C7; the coordinator's answer to request 01bc907a), only by an opener that may create the file. A hook opens with `create: false` and makes none.

- Main store: `STORE_INDEXES.runs_open` (`src/core/store/schema.ts`), `(worktree_id, started_at) WHERE end_state IS NULL`, made by `makeIndexes` in `src/core/store/open.ts`. The planner picks it for `runs.inFlight` with no change to the read. Its build took 16 ms on the 005-101 cezar copy (35,718 runs; findings section 2).
- Code store: `CODE_INDEXES.counts_keys` (`src/core/code/store/schema.ts`), key-only on `counts`. `files.uncounted` names it with `INDEXED BY` only when the file has it, since the planner keeps the wide primary key otherwise. Its build time on a large store was not measured: it reads every `counts` row once (22,166 rows of about 7.9 KB in the cezar copy, about 175 MB).

A done mark for counting was not chosen: the daemon would write a second record of a fact the code store already holds, in `src/core/daemon/**` and the scheduler, which this row does not own.

## Measurements

The findings' probe (`read-less.mjs`) needs the 005-101 store copies; they no longer exist, so the registration's SQL time on real stores before and after is not measured. On a synthetic in-memory store of 32,000 states (`seed-forms.mjs` in the worker's scratch directory, median of 9): the view write as before 184 ms; one `json_each` statement 42 ms; `INSERT ... SELECT FROM known_states` 14 ms; `json_each` joined to `checks` by identity 94 ms.

## Key-format alarm

After the history rewrite of 2026-11-17 no `squeal--v*` tag is an ancestor of this branch, so `test/keys/key-format.test.ts` and `test/keys/validity/{adapters,pytest}.test.ts` fail to load here. Run by hand: `compare-refs.ts 1c2cbfa957 HEAD` (the old 0.1.541 release commit) and `compareTrees` from `47bd57f1c` to `HEAD`. In both, every case's keys and outputs are equal, and no component has uncovered changed lines. The prune cases' wording differs: the store's size after a prune, which grows by the new index's pages. Four lines run in no case and fail nothing: the catch block of `makeIndexes` (`src/core/store/open.ts`). Rerun `test/keys/key-format.test.ts` once the commits are on the new history.
