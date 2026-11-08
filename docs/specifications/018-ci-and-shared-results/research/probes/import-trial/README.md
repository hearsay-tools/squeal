# import-trial probes (throwaway)

Throwaway material for `research/import-trial.md`. These are not product code or tests. Do not run them against a live store.

- `run-42482427002-excerpt.txt`: the Squeal step of cezarion run 42482427002, with ANSI codes and command echo removed.
- `revision-paths.mjs`: reads a **copy** of a Squeal store (`storecopy/store.sqlite`) read-only. It lists every path in `revisions.changes` that `bed82fdb` does not track (`tracked.txt` = `git ls-files`), with counts per worktree. Run it from the directory that holds both files: `node revision-paths.mjs`. Then `git check-ignore --stdin` split the output into ignored and not ignored paths.
- `step0.sh`: the commands of the Step 0 reproduction, as run by hand in a fresh clone under `$TMPDIR`.
