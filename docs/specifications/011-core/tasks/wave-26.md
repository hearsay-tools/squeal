# Wave 26 of spec 011

Three rows on disjoint files, briefed by coordinator 04a258b0 on 2026-10-23, dispatched from main once 0.1.279 (wave 25) lands. W1 and W2 come from the human's decisions of 2026-10-23 after `research/main-daemon.md` and the retention question; W3 is focused checks R2 (`tasks/011-135/design.md`), which waited for 011-153's tier selection.

## W1: 011-159, `lookup-only` becomes the default, and it confirms a held inherited failure by a run

Use /worker. Shape: slice.

Outcome: with no `baseline` key a new worktree's start queues no miss, and a file whose result at its key is another worktree's held failure is still run once, so a known failure shows.

Read board row 011-159; 001 D11 and 011 C4 step 3 as amended 2026-10-23; 001 D6 (task 001-170, held failures); `research/main-daemon.md` 5; `research/missed-sharing.md`.

Seams: the default in `src/core/types/policy.ts:268`; the start in `src/core/scheduler/bootstrap.ts` (`queueMisses: false`, `lookupOnly`, `holds`); the lookup on each pass and tier selection (C4 step 3) through `Ledger.settle` in `src/core/scheduler/ledger.ts`; `heldFailure` in `src/core/state/inherited.ts`. A lead: under `lookup-only`, queue a miss whose key holds a held foreign fail, at start and when a later lookup finds one.

The default moves under every test whose fixture has no `baseline` key and expects the start to run its files. Count them first (a test that starts a daemon on a fixture without config and waits for files to be current). Where a test means the start baseline, give its fixture `"baseline": { "onStart": "lookup-then-run-missing" }` through the shared fixture helper rather than rewriting its assertions; send me the count and the helper you choose as a request before you edit more than 20 test files. Check `evals/` fixture repositories and `test/e2e/` (excluded from Vitest; read, do not run) for the same reliance and list it in your notes.

Owns `src/core/types/policy.ts` (the default), `src/core/scheduler/{bootstrap,ledger}.ts`, `src/core/state/inherited.ts`, `src/core/daemon/policy.ts`, the skill references that name the default (`plugins/*/skills/squeal/references/{policy,commands}.md`), test fixtures and helpers, their tests, `tasks/011-159/`. Not yours: `src/core/store/prune.ts` (W2), `src/core/scheduler/{tiers,queue,record}.ts`, `src/core/daemon/{composite-runner,runner-set,node-test-runners,pytest-runners}.ts`, `src/runners/` (W3), the board, spec text, bundles, version. No `npm run build`.

Done when the row's done-when holds; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output in your summary.

## W2: 011-160, a removed worktree's results are kept for the 7 days other keys get

Use /worker. Shape: slice (measure, then change).

Outcome: the hourly prune no longer drops a removed worktree's results at once; they follow the 7-day cutoff, so a later worktree at the same content inherits them.

Read board row 011-160; 001 D8 (Pruning) as amended 2026-10-23; `research/stored-nothing.md` finding 1; `research/missed-sharing.md` cause C1.

Seam: `src/core/store/prune.ts` (`PRUNABLE`: `worktree_id NOT IN (SELECT id FROM worktrees)`; the `runs` delete and its logs; `worktrees.remove`). First, on copies of the squeal and cezar stores (copy with `-wal` and `-shm`; never open a live store), measure how much the store and `runs/` logs would grow over 72 h with the rule in place; write it in `tasks/011-160/notes.md` and send it to me as progress before you change the prune.

Owns `src/core/store/prune.ts`, `src/core/store/repos/` where the prune needs it, their tests, `tasks/011-160/`. Not yours: `src/core/scheduler/` (W1, W3), the board, spec text, bundles, version. No `npm run build`.

Done when the row's done-when holds with a test over a real store; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output in your summary.

## W3: 011-145, focused checks R2: the scheduler runs a focused tier and stores nothing

Use /worker. Shape: slice.

Outcome: a focused entry of a fast test file runs ahead of its lane's other work, only for its texts, and leaves no stored result, state, duration, closure or observed path.

Read board row 011-145, including its inputs from 011-144 and review 0.1.278; `tasks/011-135/design.md` section 8 R2; `tasks/011-144/notes.md` ("What R2 needs"); `reviews/0.1.278.md` N1 and its inputs; 011 C4 (the 2026-10-23 focused paragraph), C5, C14, C15.

Seams: forward `RunnerAdapter.focuses` through `src/core/daemon/{composite-runner,runner-set,node-test-runners,pytest-runners}.ts`; the focused class in the queue and tier selection (`src/core/scheduler/{queue,tiers}.ts`; 011-153's catch-up wait is in `tiers.ts` now); the record path that must store nothing (`src/core/scheduler/record.ts`, `TierRecords`); the pytest adapter's own observed writes (`src/runners/pytest/adapter.ts:318`, `:321`), which bypassing the record path does not stop; the `focused:<worktree>` meta row (C5).

Owns those files, `src/runners/pytest/adapter.ts`, their tests, `tasks/011-145/`. Not yours: `src/core/scheduler/{bootstrap,ledger}.ts` (W1: ask before you need either), `src/core/store/prune.ts` (W2), `src/cli/` and `src/core/status/` (R3, 011-146), the board, spec text, bundles, version. No `npm run build`.

Done when the row's done-when holds with real runner processes; the 011-144 and 011-153 tests pass; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output in your summary.

## W4: 011-163, a departure drain ends when its slow files wait

Use /worker. Shape: slice. Added 2026-10-23 after the human's drain decision; dispatched from main `7cd9c3bf9` beside W1 to W3.

Outcome: a draining daemon runs its fast work to the end, then exits once its slow files have had no run for 60 s, and leaves them queued for the next daemon.

Read board row 011-163; 011 C9 (the drain, as amended 2026-10-23) and 004 D2; `research/drains.md` sections 1 and 5; `tasks/011-84/design.md` section 1.

Seams: the departure check and `drainable` in `src/core/daemon/lifecycle.ts`; the drain's slow lane and its `waiting for slot` state in `src/core/scheduler/slow-tier.ts`; `slowPending`, `owedWork` and `pauseBacklog` in `src/core/scheduler/scheduler.ts`. A lead: the scheduler tells the departure check since when the drain's slow lane has had no run; the check exits when no fast drain work is left and that time is 60 s old.

Owns `lifecycle.ts`, `slow-tier.ts`, the drain methods of `scheduler.ts` (the three above and one new reader; W3 adds its `focus` method in the same file, so keep to those methods), their tests, `tasks/011-163/`. Not yours: `bootstrap.ts`, `ledger.ts` (W1), `prune.ts` (W2), `queue.ts`, `tiers.ts`, `record.ts`, `daemon.ts` and the runner wrappers (W3); ask before you need any. Not the board, spec text, bundles or version. No `npm run build`.

Done when the row's done-when holds with real daemons; the 011-93 drain tests pass; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output in your summary.
