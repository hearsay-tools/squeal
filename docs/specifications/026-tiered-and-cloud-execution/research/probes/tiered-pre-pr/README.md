# tiered-pre-pr probes (throwaway)

Throwaway scripts for spec 026's research topic `tiered-pre-pr`. Nothing here is product code or a test. Delete freely.

- `make-fixture.sh`: builds a fixture repository under `$TMPDIR` (12 Vitest files, oxlint, complexity threshold 3, `shared.ref`, `runner.hostIdleMinutes` 1). Variants `manual`, `stop`, `edit` set the moment of the one Vitest group.
- `run.sh`: starts the fixture's daemon with `HOME` and `XDG_RUNTIME_DIR` under `$TMPDIR`, edits files, times the hooks and lists every process the daemon started (`procs.sh`) after each step. Stops the daemon at the end. Output: `run-manual.log`, `run-edit.log`.
- `code-base.sh`: runs `squeal code --base main` (no daemon) in the fixture after a branch edit, for the `manual` and `stop` variants. Output: `code-base.log`. The `[exit 0]` lines there are the exit status of `sed` in the pipe, not of `squeal`.
- `q.mjs`: one read-only SQL query against a store copy.
- `churn.mjs`: splits local test time in a window into final, intermediate-key and repeated runs per worktree. Output: `churn-out.txt`.
- `delta.mjs`: compares consecutive CI imports' file keys in a store copy (cezar). Output: `delta-cezar.txt`.
- `closure-delta.mjs`: counts the test files a git range re-keys from stored closure lists, and a lower bound of a narrow run. Output: `closure-delta-squeal.txt`.

Store copies were made with `VACUUM INTO` from read-only connections into `$TMPDIR` and deleted after use. The `runs/<id>/report.json` files were read in place, read-only. Every fixture, store copy and daemon was removed or stopped before commit.
