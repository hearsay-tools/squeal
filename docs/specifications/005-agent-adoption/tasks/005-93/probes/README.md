# 005-93 probes (throwaway)

Throwaway scripts for `../design.md`. They open Squeal stores read-only (`node:sqlite`, `readOnly: true`) and read Claude Code transcripts under `~/.claude/projects/`; they write nothing outside stdout. `results.txt` is their output on 2026-11-16. The JSON lines they wrote stayed in the task's scratch directory and are not kept.

- `edit-tiers.mjs` + `first-tier.mjs`: per edit revision, the first run planned at that revision (at most 4 files), its stored durations, start and end; candidate bounds.
- `edits.mjs` + `analyse.mjs` + `settles.mjs`: per edit revision, every test file whose stored closure holds a changed path, when each first ran after the edit; candidate bounds and the moments all had run.
- `settled-per-worktree.mjs`: settled lines delivered to the same worktrees.
- `same-call.mjs`: an edit tool's result time against the revision that recorded the file and the next delivered PostToolBatch message.
- `messages.mjs`: PostToolBatch message kinds over 4 days.

Do not run them under load; each read took under 20 s here.
