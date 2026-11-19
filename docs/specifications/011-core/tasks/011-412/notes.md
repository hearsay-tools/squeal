# 011-412: a named wait's batch stays outside the CPU ceiling

Worker 8463f634, wave 124 W2, 2026-11-19. Shape: repair. Commit `00ecc7924` (code and tests); this file in the next commit.

## The change

- `src/core/scheduler/capacity.ts` `poolKind(open, picked?, batch = false)`: a third, optional argument. `batch` true returns `"checkpoint"` before any other rule. Every other caller and result is unchanged.
- `src/core/scheduler/tier-pass.ts` `candidateOf`: the grant ask passes `batch` (`shape.batch !== null`), so a batch tier's `acquire` takes the slot-based gate.
- `src/core/scheduler/tier-pick.ts` `shapeOf`: the offer before the pick passes `batch !== null`, so the batch is budgeted at the grant it will get. Without this the offer is the ceiling's (1 at 20 busy of 24), the pick trims to it, and the grant ask comes too late.

Backlog tiers, the backlog's turn after a batch tier, baselines and catch-up still pass `batch` false and keep the ceiling. A tier beside a batch's tier is an edit's and asks nothing, as before. The fallback of 011-308 (a batch refused or narrowed below an edit's tier runs as an edit's) stays; it now fires only when the slots, not the ceiling, are short.

## Decisions the spec did not settle

1. **No new pool kind.** `PoolTierKind` stays `"backlog" | "checkpoint"`. The pool's gate only asks `kind === "backlog"` (ceiling, floor, `#backgroundHeld`, refusal log). A named batch wants exactly the checkpoint's behaviour, so `poolKind` returns `"checkpoint"`. No change in `src/core/capacity/**`, no type change. If a later row needs to tell a batch lease from a checkpoint lease in marks or `squeal ps`, a third kind `"named"` in `capacity/pool.ts` is the additive step.
2. **Effects that follow from the kind, accepted as spec-conform:** a batch lease no longer counts in the mark's `background` field, so it does not block another daemon's floor permit; a ceiling refusal line is never logged for a batch; the batch's grant is still bounded by the slots and the fair share (`hostSlots`), as a checkpoint's is.
3. **Type change:** only the added optional parameter of `poolKind`. Additive.

## Tests

- `test/scheduler/batch-ceiling.test.ts` (new): the real scheduler with the Vitest harness, host read at 20 busy, `cpus: 24` (ceiling 18), 4 slots. An environment change's backlog tiers run on the floor's 1 permit. Then an edit's tier is held while the environment changes again, the other four files are promoted by a named wait, and the edit's tier is released: the batch tier runs with `workers: 4`. Discrimination: with the fix disabled (`if (batch && false)`), the batch tier ran with `workers: undefined` (fell back to an edit's tier, ungranted): `AssertionError: expected undefined to be 4`.
- `test/scheduler/host-gate.test.ts`: one more unit case, `poolKind(..., true)` is `"checkpoint"` with or without an open checkpoint.

## Proposed spec amendment (the coordinator lands it)

011 C4 step 5, the batch paragraph: replace "It takes the backlog's grant and waits for a permit (C10)." with "It takes a checkpoint's grant, outside the background ceiling (021 D18), and waits for a permit (C10) (amended 2026-11-19, the human, card of coordinator 4abb5168 "Outside, as spec", row 011-412)."

011 C10 Capacity, the edit-tier bullet: replace "A batch's tier (C4 step 5, rows 011-265 and 011-268) is a backlog tier here: it takes a grant and waits for a permit." with "A batch's tier (C4 step 5, rows 011-265 and 011-268) takes a grant and waits for a permit as a checkpoint's tier does: the slots and the fair share bound it, the background ceiling (021 D18) does not (row 011-412)."

011 C10 "A named wait's batch": replace "its tier asks the pool as a backlog tier." with "its tier asks the pool as a checkpoint's tier, outside the background ceiling (amended 2026-11-19, row 011-412; before, as a backlog tier, which put it under the ceiling since 021-18, `reviews/0.1.570-r2.md`)." The fallback sentence stays.

011 C15 "A batch on a busy host": add after the first sentence's parenthesis: "The pool's refusal here is the slots', not the background ceiling's: a batch is a named wait's work, outside the ceiling (021 D18, row 011-412)."

021 D18 Rule: no wording change needed; it already says "Edit tiers, named waits, checkpoints and agents' own runs stay outside it". Optionally add "(a named wait's batch tier takes a checkpoint's grant, row 011-412)" after "named waits".

## Checks run

- `pnpm run lint`: `Checked 3800 files in 3s. No fixes applied.`
- `pnpm run typecheck`: clean (no output).
- Direct, `timeout 900 pnpm exec vitest run --maxWorkers=2 test/scheduler/batch-*.test.ts test/scheduler/host-gate.test.ts test/scheduler/backlog-slots.test.ts test/scheduler/promoted-tier*.test.ts test/scheduler/local-permits.test.ts test/scheduler/edit-beside-backlog.test.ts test/capacity/`: 21 files, 110 tests passed.
- `test/e2e/**`: no file names `scheduler/capacity`, `tier-pass` or `tier-pick`; nothing to run there.
- `squeal status --wait 60000 <changed paths>`: see the last section of this file.

## squeal status --wait evidence

Revision 7 (both commits), 2026-11-19 22:30–22:39 UTC, host load average 64 to 110 on 24 CPUs (other coordinators' work, not made on purpose). `capacity.ts` selects 1195 test files, near the whole suite, so no verdict arrived within the wait: after 9 waits of 60 s, 25 current and passing (among them `test/scheduler/batch-ceiling.test.ts`, `host-gate.test.ts`, `local-permits.test.ts`, `test/capacity/pool-failure.test.ts`, `test/runner-host/remote/lane-admission.test.ts`), 1170 pending.

Known failures 3, each with "no pass at these inputs on record", recorded at load 3.5 to 4.1 per CPU:
- `test/cli/status-at-run-killed.test.ts` (a killed `status --at --run` leaves no process)
- `test/cli/status-paths-paused.test.ts` (exits within about 1 s of a paused daemon)
- `test/runner-host/idle-host.test.ts` (an idle runner host closes)

All three are timing checks with no named wait's batch; the change touches only the pool kind a batch tier asks with. I did not rerun them at this load. Not proven unrelated: the coordinator should read them again on the candidate (`squeal retry <file> --reason load`, or CI).
