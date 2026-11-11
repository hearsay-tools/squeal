# Spec 020 wave 6: wide selections (#175)

Approved by the human on 2026-11-11: "#175 rows: Build both", "Keep result: Yes". Spec D17.

Starts after wave 5 (020-15b and 020-18) is integrated; the coordinator writes the baseline here then. Two workers run in parallel:
- 020-17ab: the estimate and the order, one worker, because both edit `collect.ts` before the run;
- 020-17c: the gate keeps its results.

Every row:
- Read `docs/specifications/020-quality-gate/spec.md`, D3, D11.7 and D17 above all, and `research/wide-import.md` Q2 to Q4.
- Do not run `pnpm run build` or a full suite.
- Before you finish, read `squeal status --wait 60000 <changed paths>`, and run `pnpm run lint`, `pnpm run typecheck` and `test/keys/key-format.test.ts`.

## 020-17ab the estimate and the order

Use /worker. Shape: slice.

Outcome: D17.1 and D17.2.

Starting seam: two new pure modules, `src/core/code/gate/estimate.ts` (groups, width, durations to seconds) and `src/core/code/gate/order.ts` (loader sets and durations to an order). Durations come from the `file` check rows of the stores, read in a new `src/cli/code-gate-durations.ts`. First failing tests: `test/code/gate/estimate.test.ts` (summed durations over width, a sequential group, unknown files at the median, no store) and `test/code/gate/order.test.ts` (smallest set first, ties by path, the hub last, unknown closure last).

Owns: `estimate.ts`, `order.ts`, `code-gate-durations.ts`; hook-in edits in `collect.ts`, `report.ts` (`estimate`), `code-gate-text.ts` and `code-gate.ts`; their tests; the report field in `commands.md` (with copies).

Leave alone: `src/cli/code-gate-stored.ts` and the store write path (020-17c).

Done when the research's tests for rows 020-17a and 020-17b pass, including a collect fixture with a short budget and fixed sleeps where a leaf path completes in loader order and stays `not-finished` in path order.

## 020-17c the gate keeps its results

Use /worker. Shape: slice.

Outcome: D17.3. A second `squeal code --base` on the same bytes runs only the files the first did not complete.

Starting seam: `src/cli/code-gate-stored.ts`, which reads the stores at the daemon's key (D11.7). Add the write of each completed file through the daemon's own store write path and lock. First failing test: a CLI case where a run with a short budget completes one of two files, and a second run reads that file from the stores (`from: "store"`) and runs only the other.

Rules:
- Write only files that ran whole in this command. Never write unfinished, left-out, not-prepared or parts files.
- Use the same key, check names and record versions the daemon uses, so a daemon reading them sees the same evidence it would have made.
- A running daemon in the worktree must stay correct: use its lock, or skip the write with one note when the lock is busy.
- When no store exists, create it as the daemon does.

Owns: `code-gate-stored.ts`, a new `src/cli/code-gate-keep.ts` if the write needs its own file; the store write seam it needs (name it in your final message); their tests; the D1/D3.5 wording in `commands.md` (with copies).

Leave alone: `estimate.ts`, `order.ts`, `code-gate-durations.ts` (020-17ab).

Done when:
- the second run reads the first run's completed file and runs only the other;
- a changed byte makes it run again;
- an unfinished file is never written;
- a daemon started afterwards reads the gate's results as current, with no rerun.
