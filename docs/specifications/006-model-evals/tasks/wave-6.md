# 006 wave 6: the atomic tier

The human, 2026-10-12: amend and build, 10 repetitions. Read `../spec.md` D10 (new) and D7, and the last five entries of `../status.md`. The two rows below run in parallel; their only contract is that `ATOMIC.md` reads `cells[].atomic.measures` generically (any key, boolean or null). Both may add exports to `evals/lib/index.mjs` and `index.d.mts`, additively.

## 006-35 the seven scenarios, fixed measures, load-aware settle

Use /worker. Shape: slice.

- `evals/atomic/`: add `a3-harmless`, `a4-pending`, `a5-uncovered`, `a6-daemon-down` and `a7-stale` as D10's table describes, and set `repetitions: 10`. Reuse the existing knobs (`daemon`, `staleEdit`).
- `a2-slow`'s measures as D10 states: `slow-through-squeal` scores, covering the slow test by any run is context, and add `no-rerun-answered`.
- `a4-pending` sends turn 2 without settling and records whether checks were pending then; its measures are null when nothing was pending.
- The settle wait (`evals/lib/atomic.mjs`): a load-deferred slow tier counts as not started. Find the status field in `src/`. The bound is `slow.maxDeferMs` plus the tier's last duration.
- `evals/bin/atomic-regrade.mjs`: recompute the measures of a committed `.atomic.json` from its retained records, and regrade both committed atomic files.

**Owns:** `evals/atomic/**`, `evals/lib/atomic.mjs`, `evals/bin/run-cell.mjs`, `evals/bin/atomic-regrade.mjs`, and `test/evals/atomic-*.test.ts` except `atomic-trend*`.

**Done when:**
- every reference edit breaks exactly the tests its scenario names;
- each measure has synthetic timelines where the right moves meet it and each known mistake misses exactly it;
- the regrade leaves `a1-break` unchanged, and `a2-slow` through Squeal matches the coordinator's hand count (status, 2026-10-12);
- the baseline fingerprint and the rubric revision `a3ad55888db7` are unchanged;
- lint, typecheck and `test/evals` pass.

## 006-36 ATOMIC.md and the per-model flags

Use /worker. Shape: slice.

- `evals/lib/atomic-trend.mjs` and `evals/bin/atomic-trend.mjs` write `evals/results/ATOMIC.md` from every `.atomic.json`. For each model, scenario and measure, it shows each run's count with its 95% range, newest last.
- A scenario revision is its recorded prompt hash, knobs and `breaks`; runs compare only within one revision.
- It applies D10's flags (previous release, one-sided Fisher p < 0.01) and alarms, and lists measures under 90% over the last 30 sessions.
- `run-baseline --atomic` regenerates `ATOMIC.md` at the end.

**Owns:** `evals/lib/atomic-trend.mjs`, `evals/bin/atomic-trend.mjs`, `evals/bin/run-baseline.mjs`, `evals/results/ATOMIC.md`, `test/evals/atomic-trend*.test.ts`.

**Done when:**
- synthetic files show that 10 of 10 → 4 of 10 flags and → 5 of 10 does not;
- the same release never flags against itself;
- a changed prompt hash breaks the comparison;
- a false pass is an alarm;
- `ATOMIC.md` from the two committed files shows no flag;
- lint, typecheck and `test/evals` pass.

**Rules for both:** no subject sessions or model calls; tests use fakes. Never run or import `run-baseline.mjs`. Never run `npm run build`. Leave `docs/**`, the judge, `evals/results/TREND.md` and the long tasks alone.
