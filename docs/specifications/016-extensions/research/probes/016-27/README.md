# 016-27 probes: D4 and 016-23 in real use

Throwaway evidence for row 016-27 (`../../../lessons.md`). This is not product code.

Every script opens a store with `node:sqlite` and `readOnly: true`. The scripts start no daemon and no agent session, open no socket, and write nothing. `classify.mjs` and `mixed-names.sh` also run `git ls-files` and `git check-ignore`, which only read, in other worktrees. Run them from this worktree's root with Node 24.

| Script | Question | What it prints |
| --- | --- | --- |
| `schema.mjs`, `meta.mjs`, `sql.mjs` | all | The schema, meta rows by key pattern, and one SQL statement's rows |
| `incarnations.mjs` | all | Each daemon incarnation (`<version>@<startedAt>`) named in meta, and each registered daemon |
| `marks.mjs` | 1 | Per project: test files with stored direct marks, and marked paths per file (p50, max) |
| `edits.mjs` | 2 | Per revision whose changes hold a marked path: each marked file's first run after it |
| `edit-work.ts` | 2 | The same, split into the edit window (the 120 s catch-up quiet) and later; run with `npx tsx` |
| `repeat-hashes.mjs` | 2 | Whether a revision returned a path to content that the worktree already had |
| `listings.mjs` | 3 to 5 | Every listed directory (`dir/`) in the observed maps, with its readers |
| `classify.mjs` | 3 to 5 | Per worktree and listed directory: `watched`, `mixed`, `absent`, `empty` or `unwatched`, from Squeal's view (`file_hashes` less the git-ignored extra files) |
| `repeats.mjs` | 3 | Same-revision repeat runs of named files (how a first-seen confirmation shows), and the base rate |
| `inherited.mjs` | 4 | Inherited states of readers of a non-watched listing, against the origin worktree's directory |
| `mixed-names.sh`, `mixed-summary.mjs` | 5 | Ignored names in mixed directories across all worktrees, and the distinct name sets |
| `mixed-inherited.mjs` | 5 | Inherited states across worktrees whose mixed-directory ignored names differ |

A first version of `classify.mjs` asked git alone what the watcher sees. It reported 12 fixture `node_modules` directories as unwatched with names. They are tracked symlinks, and Squeal's stat cache holds the files below them as seen files. The committed version reads the stat cache, as `WorktreeKeys.#listedFiles` does.
