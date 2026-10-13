# 006 wave 12: the reworded slow-tier line on Haiku

The human (2026-10-13): `stop.requireSlowSuite` stays off, and the 001 coordinator rewords its off-line. 001-317 shipped that in 0.1.145 (`8ac219c8`): "Not covered by Stop's wait" became "Squeal runs them when the agent pauses". In 006-38, Haiku's `slow-through-squeal` was 7/10 with the old line and 10/10 with the setting's line, unconfirmed at 10 sessions an arm.

## 006-52 Haiku on the reworded line (coordinator)

`evals/variants/old-slow-line.json` puts the old line back into the 0.1.145 bundles, and nothing else. The patch matches 16 times, once per bundle. One run compares the shipped arm (new line) with the old line on Haiku `a2-slow`, 30 sessions an arm:

```sh
node evals/bin/run-baseline.mjs --atomic --commit 8ac219c8 --variant old-slow-line --models claude-haiku-5-5 --tasks a2-slow --repetitions 30
node evals/bin/atomic-compare.mjs evals/results/<date>-0.1.145.<run>.old-slow-line.atomic-variant.json
```

At 30 an arm, 70% against 100% gives two-sided p ≈ 0.002, and 80% against 100% gives p ≈ 0.02.

The risk to watch (raised with 001): a headless session gets no idle wake. The all-current line might then read as "stop and claim", and `slow-through-squeal` or `claim-true` would fall in the shipped arm.

Done when the results and the comparison are committed, `lessons.md` reports them, and the 001 coordinator is told. If the new line does worse, 001 goes back to the old line or adds the command.
