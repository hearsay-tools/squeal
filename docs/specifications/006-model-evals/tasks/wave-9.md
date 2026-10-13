# 006 wave 9: atomic variant arms, for 006-38

The human (2026-10-13) wants 006-38 before 006 ships. On 0.1.131, run `a2-slow` as shipped (`stop.requireSlowSuite` off, the default) and with it on (`evals/variants/stop-slow.json`), side by side. The atomic runner refuses `--variant` today.

## 006-48 the atomic runner runs a variant arm

Use /worker. Shape: slice. Read `../spec.md` D8 and D10.

Code and tests only:
- Never run `run-baseline.mjs`, `run-cell.mjs`, `judge-calibrate.mjs` or any regrade.
- No `claude` or `codex` session.
- No `npm run build`.

**`evals/bin/run-baseline.mjs`**
- Allow `--atomic --variant <name>`. Drop the refusal (around line 76). The plan already loops over `arms`.
- Such a run writes `kind: "atomic-variant"` and `variantConditions` to `<date>-<version>.<run>.<name>.atomic-variant.json`. `ATOMIC.md` and `TREND.md` leave it out, as they leave out long-task variants. Check both tables' file and `kind` filters, and add a test.

**New `evals/lib/atomic-compare.mjs` and `evals/bin/atomic-compare.mjs <file>`**
- Per model, scenario and measure: each arm's count with its Wilson range, and a two-sided Fisher p.
- Reuse `atomic-trend.mjs`'s Wilson and Fisher helpers; export them if needed, never copy them.
- Prints markdown. The coordinator commits the output beside the results.

**Owns:** `evals/bin/run-baseline.mjs`, `evals/bin/atomic-compare.mjs`, `evals/lib/atomic-compare.mjs`, `evals/lib/results.mjs`, the helpers' exports in `evals/lib/atomic-trend.mjs`, `evals/lib/index.{mjs,d.mts}`, `test/evals/atomic-compare.test.ts`, `evals/README.md`.

**Done when:**
- A test shows a two-arm atomic results file compared per model and measure, with the right p.
- A test shows both tables ignoring an `atomic-variant` file.
- `npm run lint`, `npm run typecheck` and `npx vitest run test/evals` pass.

The coordinator then runs 006-38 itself, after the 001 coordinator frees the eval slot:

```sh
node evals/bin/run-baseline.mjs --atomic --commit 9c762e65 --variant stop-slow --tasks a2-slow
```

That is 4 models × 10 repetitions × 2 arms = 80 sessions.
