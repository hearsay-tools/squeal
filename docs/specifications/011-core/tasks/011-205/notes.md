# 011-205 notes (wave 39 W1)

What the slice changed, and the seam map for 011-207, 011-211's text and 011-215, which wait for it.

## Seam map

- `src/core/delivery/header.ts`: `fullCounts` is the full form's counts (the four validities, the inherited sentence, the test files without checks). `fullLine` (registration, Stop, status) and `newsLine` (every other delivery) both read it. `headerLines(header, command, form, told)` takes `told: Pick<Delta, "slowTierChanged" | "countsOwed">`, so a new once-per-consumer line adds one field to that `Pick` and one to `Delta`. `formatDelta` passes the whole delta.
- `src/core/delivery/counts-owed.ts`: the per-consumer record, modelled on `slow-told.ts`, in the `meta` row `counts-owed:<worktree>` (`WORKTREE_META_ROWS.countsOwed`). `oweCounts` at `register` (owed when the header has `testFilesListed === false`, forgotten otherwise, so a registration again after the listing spends it), `payCounts` in `deliver` beside `slowTierChanged`, `forgetCounts` in `expiry.ts`'s `forget`. `payCounts` returns `{}` or `{ countsOwed }`, which `deliver` spreads, so `deliver`'s transaction gains no branch (complexity 44, already over 20).
- Policy at delivery: `payCounts` reads `readPolicy(root).baseline.onStart` only when it pays, once per consumer.

## Decisions (coordinator reply to request 9929bb3b)

1. The counts ride on the consumer's next delivery, as the slow-tier line does: tool boundary, Stop, idle wake or a deny's peek. The listing alone makes no delivery.
2. News wording (b): with no check pending, stale or unknown and test files without checks, `Revision N: test files without checks: 1 pending, 245 unknown.` `no check pending, stale or unknown` only when both are zero.
3. Counts wording (a): that one delivery's header line is the full form's counts, without the changed paths and the checkpoint. Under `baseline.onStart: "lookup-only"` with unknown files, the without-checks sentence ends `; the baseline is lookup-only, so it queued none of them.` A Stop that comes first carries the same clause in its full header and spends the once.
4. `test/e2e/agree.ts` (regex only) and line 15 of each plugin's `references/reports.md` changed by agreement.

## Parsers

- `evals/lib/squeal-text.mjs`: `NEWS` also matches the files-only line and gives it an empty counts clause; the `Test files without checks:` read is case-insensitive. The gate (`test/evals/evidence-squeal.test.ts`) round-trips the owed form as a fifth formatter, plain and in hook JSON.
- `test/e2e/agree.ts`: `NEWS` group 5 is `undefined` for the files-only line, read as zero counts.

## Not done

- The spec text for C5 (both changes) and `status.md`: the coordinator's.
- Bundles: not rebuilt (`plugins/*/dist` drift is expected until a build).
