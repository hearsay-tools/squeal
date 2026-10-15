# 007 wave 6: quality scan

## 007-46 quality scan over spec 007

Use /quality.

- **Outcome:** `docs/specifications/007-pytest-runner/quality/2026-10.md`, committed alone: what spec 007's landed work left dead, duplicated or misplaced.
- **Read:** `docs/vision.md`, `docs/styleguide.md`, spec 007's `spec.md`, `status.md` and `lessons.md`.
- **Stretch:** spec 007's product commits on `origin/main` from `3bb9340c` to `b71f8ed9` (0.1.195), mainly `src/runners/pytest/`, `src/runners/composite*`, `src/core/delivery/attribution.ts`, `src/core/keys/`, `src/setup/` and their tests (`git log 3bb9340c^..b71f8ed9 --grep=007 --stat`). Other specs' commits in that range are out of scope, except where 007 duplicates them.
- **Look for:** pytest helpers that duplicate node:test's or Vitest's; one rule stated in the adapter and in core; modules past about 300 lines under `src/runners/pytest/`; tests that restate each other across the 007 repair rounds (wave 2.5 to 5.875); `status.md` amendments the code no longer matches.
- **Shape:** survey. You change no code and never edit the board, the spec or the status file. No `npm run build`, and no full suite; read code instead.
- **Done when:** each finding is a drop candidate, a board row in the board's column shape, or a one-sentence slice, with file and line. The first line of your final message is the findings path.
