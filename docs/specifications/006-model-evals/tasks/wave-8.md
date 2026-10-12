# 006 wave 8: the release check, the adoption scoreboard, the long tasks as an alarm check

The human (2026-10-12, "simplify") decided:
- The release check is the atomic tier's per-model flags against the previous release, plus alarms.
- Adoption is a scoreboard against 90%, and it gates nothing.
- The long tasks are an alarm check only.

Read `../spec.md` goal 8, D6, D7 and D10 (all amended that day), and `../status.md`'s last entry.

## 006-47 the reports follow the simplification

Use /worker. Shape: slice. Code and tests only: never run `evals/bin/run-baseline.mjs`, `run-cell.mjs`, `judge-calibrate.mjs` or any regrade, nor `claude` or `codex`. Never run `npm run build` in a worker worktree.

**`evals/lib/atomic-trend.mjs`**
- Replace the "Under 90% over the last 30 sessions" list (around line 163) with an **adoption scoreboard**: per model, each measure at its scenario's newest revision over its last `WINDOW` sessions, the count with its Wilson range and whether it meets 90%. Keep `WINDOW`.
- Claude cells from runs whose id sorts before `20261012T115741Z` used the old root. Mark those runs "(old root)" in the per-model table headers for Claude models. Leave their cells out of flags and the scoreboard. Codex cells stay in. One named constant, with the D10 reference.

**`evals/lib/trend.mjs`**
- Drop the 25-point ⚑ drop flags, `dropped()` and the "Flags" wording.
- Keep the false pass, forbidden edit and false fail listings as the alarm section. Keep the tables as context.

**Results**
- Regenerate `evals/results/ATOMIC.md` with `node evals/bin/atomic-trend.mjs`.
- Regenerate `evals/results/TREND.md` with `node evals/bin/trend.mjs`. Check its bin name in `evals/bin/` first.
- Both read committed files only and call no model.

**Owns:** `evals/lib/{atomic-trend,trend}.mjs`, `evals/bin/{atomic-trend,trend}.mjs` if a bin needs a change, `test/evals/{atomic-trend,trend}.test.ts`, `evals/results/{ATOMIC,TREND}.md`.

**Done when:**
- Tests cover the scoreboard's meets and misses at 90%.
- A test shows an old-root Claude run marked and left out of flags and the scoreboard, while a Codex cell of the same run stays in.
- A test shows TREND.md raising no drop flag and still listing a false pass and a forbidden edit.
- `npm run lint`, `npm run typecheck` and `npx vitest run test/evals` pass.
