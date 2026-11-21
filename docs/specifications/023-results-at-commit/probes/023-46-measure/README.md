# Row 023-46 measurement: commit daemon start, before and after

Summary and method: `../../tasks/023-46-notes.md`, "Measured".

- `measure.sh <tip> <reps>`: the driver. `SCRATCH` holds `before/` (the base commit's `src`, `package.json` and `tsconfig.json`, with the after tree's `node_modules` linked) and the subject clone; `AFTER` is the source tree with the change; `REPO` is the repository to clone. It runs before and after alternately, from source through tsx.
- `mk-tree.ts`: makes and installs the commit worktree with `ensureCommitWorktree`.
- `walked.cjs`: after each run, the commit worktree's keyed files, a digest of its `test_file_keys` and the walk rows written since the commit daemon's spawn.
- `reps.jsonl`: one line per run: spawn to serving, spawn to the named file's result, the run's exit, the 1-minute load at the spawn, the store counts.
- `profiled-run.log`: the driver log of the profiled "after" run (`--cpu-prof` on the commit daemon and its runner host); the profiles are not kept.
