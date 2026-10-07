# Wave 8 briefs

One scan, `--backend claude --model opus --effort high`, never Fable.

## 001-52 quality scan of spec 001

Use /quality.

Outcome: one findings file listing what spec 001 can drop, unify or move, as rows the coordinator pastes into the board unchanged.

Stretch: `935e251..main`, every wave of 001, waves 7 to 7.7 included (targeted invalidation in `src/runners/vitest/stale.ts`, `dynamic.ts`, `graph.ts`; runner-environment failures in `broken.ts`; the daemon's working and temp directories in `src/core/daemon/scratch.ts`, `paths.ts`, `runner.ts`). `reviews/wave-7.7.md` B1 (the temp directory name) is open and awaits the human; do not file it again.

Read: `docs/vision.md`, `docs/styleguide.md`, spec 001 with `status.md`, the reviews under `reviews/`, `lessons.md` defects.

Look especially at: modules past about 300 lines (several tests passed it in waves 7 to 7.7); `notes` contracts added twice (`InvalidateResult.notes`, `RunReport.notes`); path, temp and private-directory helpers spread across `paths.ts`, `scratch.ts` and `src/core/fs`; spec amendments in `status.md` that the code no longer matches.

Own: `docs/specifications/001-core-loop/quality/2026-10.md`, committed alone. Nothing else.

Done when: the file is committed and each finding is a drop candidate, a board row, or a one-sentence slice, with file and line.
