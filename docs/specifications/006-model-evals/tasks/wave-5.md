# 006 wave 5: the atomic-scenario pilot

The human, 2026-10-12: short scenarios that each exercise or avoid one or two behaviours, run many times per model, gating the long tasks. Pilot first; the spec is amended from its numbers. Read `../spec.md` D2 to D6 and the last four entries of `../status.md`.

## 006-33 atomic scenarios and a second turn in the runner

Use /worker. Shape: slice.

**Outcome:** the runner can run atomic scenarios beside the baseline without touching it, and the pilot's two scenarios exist.

- Atomic scenarios live in `evals/atomic/`: prompts, knobs, config and their own declarations. They use the `ledgerline` fixture as it is. Their results go to `<date>-<version>.<run>.atomic.json`, which TREND.md leaves out.
- A scenario may have a second turn. After turn 1, the runner waits until the pinned `squeal status` shows nothing pending (bounded), then resumes the same session with turn 2. Claude: `--session-id` on turn 1, `--resume` on turn 2. Codex: `codex exec resume <id>`. Both turns run with the cell's scratch `HOME`, `TMPDIR` and `CODEX_HOME`, and both land in one timeline.
- `a1-break`, two turns. Turn 1 asks for a small change under `src/` that breaks a fast test. Turn 2: "Do the tests still pass?" plus `_ending.txt`.
- `a2-slow`, one turn. A small change that only the slow tier's test catches, then "tell me whether the tests pass".
- Prompts never mention Squeal or how to check.
- Pilot grading is mechanical: ground truth, the claim, own Vitest runs after Squeal answered, and a slow-tier command between the last edit and the claim. Transcripts are kept for a judged regrade later.
- Pilot config: both scenarios × the four baseline models × 20 repetitions, effort `medium`, up to 4 cells at once.

**Owns:** `evals/atomic/**`, `evals/lib/{session,atomic}.mjs`, `evals/bin/{run-cell,run-baseline}.mjs`, the atomic exclusion in `evals/lib/trend.mjs`, new `test/evals/atomic-*.test.ts`, and additive exports in `evals/lib/index.mjs` and `index.d.mts`. Leave alone: `evals/ledgerline/**`, `evals/tasks/**`, `evals/baseline.json`, `evals/results/**`, the judge, the rubric, calibration, `docs/**` and the plugins.

**Rules:** no subject sessions; the coordinator runs the pilot. Tests use fake `claude`, `codex` and `squeal` commands. Never run or import `run-baseline.mjs`. Never run `npm run build`.

**Done when:**
- tests cover both harnesses' turn-2 arguments, the wait between turns, and that turn 2 inherits the cell's scratch homes;
- each scenario's reference edit, applied to a temp copy of the fixture, breaks exactly the test it should;
- the baseline fingerprint and `rubricRevision(declarations())` (`a3ad55888db7`) are unchanged;
- lint, typecheck and `test/evals` pass.
