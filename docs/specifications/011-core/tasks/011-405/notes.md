# 011-405: a hung beside file is reported (review 0.1.567 N1)

Worker 3a122b8e, wave 123 W2, 2026-11-19. Shape: repair.

## Change

- `src/core/scheduler/overrun.ts`: `overrunAt` served two purposes. Now:
  - `reportedOverrunAt(context, tier)`: when a tier's files are reported as overrunning. Same rule as before (factor 10, floor 60 s, stepped start, not slow, not a group lane, not cancelled, runner cancels), but a tier beside another is included.
  - `overrunAt(context, tier)`: `null` for `tier.beside === true`, else `reportedOverrunAt`. Its callers (`overruns`, `overrunLanes`, `nextOverrun`, `besideDone` in `beside.ts`) are unchanged, so the lane still opens at most two instances.
  - `Overruns.started` and `Overruns.check` (the published `yields` row) use `reportedOverrunAt`. `tierOverrun` adds `beside: true` for a beside tier.
- `yields.ts` and `yield-waits.ts`: no change needed. `Overruns` lives in `overrun.ts`.
- The late line (`delivery/late.ts` via `firstOverrunning`) reads every published overrun, so it names a hung beside file with no change. Its text ("has run far past its usual time and may be hung") makes no claim about the lane.

## Type change (additive)

- `TierOverrun.beside?: true` and `FileOverrun.beside?: true` (`src/core/types/standing.ts`). Absent for the first tier and from an older daemon.
- `yield-row.ts` `isOverrun` accepts `beside` absent or `true`; any other value drops the entry, as other malformed fields do.
- `overrun-facts.ts` copies `beside` into `FileOverrun`, so the named wait's JSON (`fileEntry(...).overrun`) carries it.

## Decisions the brief did not settle

1. Text for a beside tier's file. The first tier's line says "the lane runs its next tiers beside it". That is false for a beside tier, whose lane opens no third instance. A beside tier's file now says: "...so it may be hung; it runs beside another tier, so the lane's next tiers wait for one of the two to end, and its run's deadline is HH:MM:SS". To tell the two apart the published overrun needs the `beside` flag above.
2. The first tier's line keeps "the lane runs its next tiers beside it" also when its beside tier hangs too. At that moment the lane's next tiers in fact wait. I left this unchanged: the 011-399 tests pin that text, and the brief says they pass unchanged. A later row can reword it if the coordinator wants the first tier's line to know its beside tier hangs.
3. No test for the late line with a beside file: it shares `firstOverrunning` with the first tier's case (`test/delivery/late-hung.test.ts`), which reads all published overruns.

## Proposed spec amendment text (coordinator lands it)

011 C4 step 5, after the 011-399 overrun sentence:

> A tier that runs beside an overrunning one (the lane's second instance) is reported as overrunning by the same rule once its own unfinished files pass the threshold (row 011-405). Its lane opens no third instance: the lane's next tiers wait until one of the two tiers ends. Nothing about either tier's results changes.

011 C6, overrun facts:

> The `yields` row publishes an overrun for each tier in flight past its threshold, also for a tier beside another; that one carries `beside: true` (additive key, absent from an older daemon). Status and the named wait's line for a file of such a tier say "it runs beside another tier, so the lane's next tiers wait for one of the two to end" instead of "the lane runs its next tiers beside it"; the named wait's JSON `overrun` carries `beside: true`. The late line names such a file as may be hung, as it does the first tier's.

## Tests

- New: `test/scheduler/overrun-beside-hung.test.ts`. `hungTier(5, 12)`, both tiers held. After one floor: one beside tier, one published overrun. After a second floor: two published overruns (H and mates; the beside tier's four files with `beside: true` and a deadline), still exactly the two runs since the edit, neither ended nor cancelled, no held file current; status line text, `standing.overrun.beside` and the JSON entry for a beside file; H keeps its own wording.
- Red check: with `overrun.ts` at HEAD (b2620ba8b) the test fails ("expected [ … ] to have a length of 2 but got 1"); with the change it passes.

## Checks run (2026-11-19)

- `pnpm run lint`: pass (after `biome format` on the new test). `pnpm run typecheck`: pass.
- No `test/e2e/**` file references the changed paths (grep of `test/e2e` for overrun, tier-text, yield-row, overrun-facts: none).
- Direct, `timeout 900 pnpm exec vitest run` on `test/scheduler/overrun-*.test.ts`, `tier-yields-*.test.ts`, `decide-yields.test.ts`, `yield-remainder-text.test.ts`, `beside*.test.ts`, `test/status/yield-lines.test.ts`, `test/delivery/late-hung.test.ts`: 24 files, 121 tests passed. The 011-399 tests pass unchanged.
- `squeal status --wait 540000 <changed paths>` (revision 6, three waits, host 17 to 22 of 24 cores busy): no verdict before the deadline. 13,779 affected checks passed (1,408 test files loaded); 586 test files still queued for CPU and 14 never run (lookup-only baseline); those are unknown, not passed. Known failures 2, both expected drift: `test/harness/opencode/package.test.ts` and `test/harness/pi/package.test.ts` "has the bundles exactly as `npm run build:plugin` produces them" (`cli/squeal.mjs differs from the build`). The brief forbids `pnpm run build` in a worker worktree; the coordinator's candidate build closes it.
