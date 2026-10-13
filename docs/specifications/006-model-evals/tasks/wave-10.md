# 006 wave 10: the quality scan after shipping

006 shipped on 2026-10-13 (`../status.md`, `../lessons.md`). One scan over the whole spec, as the coordinator skill asks after a spec ships.

## 006-49 quality pass over spec 006

Use /quality. Shape: survey.

Read `docs/vision.md`, `docs/styleguide.md`, `../spec.md` and `../status.md`.

**Stretch:** `c26cbb78` (006-01, the prototype moved into `evals/`) to `origin/main`, limited to `evals/`, `test/evals/` and `docs/specifications/006-model-evals/`. There is no earlier file under `../quality/`.

**Leads, offered, not required:**
- Code that served a decision the human later reversed: the long tasks' drop flag, the under-90% list and pooled behaviours (D6, D7, D10, amended 2026-10-12).
- Helpers that exist twice across `evals/lib/*.mjs` and `evals/bin/*.mjs`.
- Modules past about 300 lines (`run-cell.mjs`, `grade.mjs`, `shell.mjs`, `judge.mjs`, `run-baseline.mjs`).
- One-off bins such as `import-005-07.mjs`.
- `evals/README.md` against the code.

**Rules:**
- Never run `evals/bin/run-baseline.mjs`, `run-cell.mjs`, `judge-calibrate.mjs`, `atomic-regrade.mjs` or `regrade.mjs`.
- Start no `claude` or `codex` session.
- No `npm run build`.
- Read the committed results files only as data.

**Owns:** `docs/specifications/006-model-evals/quality/2026-10.md`, alone.

**Done when:** that file is committed with each finding as a drop candidate, a board row in the board's column shape, or a one-sentence slice, each naming file and line.
