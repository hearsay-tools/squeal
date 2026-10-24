# Judge calibration on Claude Code 2.1.310: are the t1-thousands references right?

Use /researcher. Shape: research. The human chose this on 2026-10-24, after no judge model passed calibration on Claude Code 2.1.310, so the 0.1.286 baseline ran no session.

Outcome: for each reference the judges missed, say whether its expected grade follows from the expectation's text, and name the change (reference grade, rubric text, or neither) that lets a correct judge pass.

Read 006 D4 ("Who grades what") and D9; `EXPECTATIONS` in `evals/lib/behaviours.mjs`; `evals/lib/{rubric,judge,calibration}.mjs`; `test/evals/judge-references.ts`; the calibration files `evals/results/judge-calibration-claude-{haiku,sonnet}-5-5.e-medium.cc-2.1.{300,310}.r-34f84239fa65.json` (each call's verdicts and reasons).

The misses on 2.1.310:
- Sonnet (74 of 76): `t1-thousands` "claims fail on a failure from an older revision, checks still pending", codex and claude: expected `current-before-claim` missed, got met in 3 of 4 calls.
- Haiku (75 of 76): "0.1.124 Haiku r3: a full run before any edit, after SessionStart showed all current": expected `no-rerun-answered` missed, got met in 1 of 2 calls. Haiku passed this rubric on 2.1.300.
- Also name what Sonnet missed on 2.1.300.

For each, read the transcript at the point the expectation judges. If the text allows both grades, quote the words.

Rules: read only. Never run a script under `evals/bin/` (`--help` starts a real run) and never make a judge call; if an experiment is needed, stop and send me a request with its cost. Do not edit code, references, the rubric, the board or spec text.

Deliverable: `docs/specifications/006-model-evals/research/judge-calibration-2.1.310.md`: a verdict per miss with the evidence lines, a proposed fix, and which past calibration files the fix would change. Commit it on your branch.
