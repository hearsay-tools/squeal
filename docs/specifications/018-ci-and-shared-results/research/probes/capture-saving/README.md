# Probes for row 018-25 (capture's real saving)

Throwaway. These scripts and outputs back `../../capture-saving.md` and are not product code. Nothing here is imported by Squeal or its tests. They read transcripts and store copies only, start no agent CLI and no daemon, and run no test.

Run on 2026-11-10, Node v24.22.1, Squeal source at `19b8f2660`. Load average 2.6 to 3.9 on 24 vCPUs; no timing was measured.

- `extract.mjs --from 2026-11-03 --to 2026-11-10 --json <out> --skip <session id>`: copied from `../local-capture/manual-runs.mjs` (same classifier), plus the worktree each command ran in (its own `cwd`, or a leading `cd <worktree>`), start and end in ms, and an edit timeline per worktree: Claude Code `Edit`/`Write`/`MultiEdit`/`NotebookEdit`, Codex `FileChange` items, and shell commands that write (see `writes()`). A git rewrite, an install or a path-less formatter run is a `global` event (paths unknown). The JSON holds command text, so it stays in `$TMPDIR` and is not committed.
- `join.mjs <runs.json> <stores dir> 2026-11-04 2026-11-10 --pairs <out>`: the join. Environment `GLOBAL=strict|ignore` (count `global` events as a change to every closure, or ignore them) and `DELTA_MS` (time from an edit to the daemon revision that holds it). Output: `out-join-<GLOBAL>-<DELTA_MS>.txt`, four variants.
- `never.mjs <variant>`: why the daemon never ran a manual run's content (`out-never.txt`).
- `bound.mjs <variant>`: upper bound for a saving in another worktree (`out-bound.txt`).
- `daemon-seconds.mjs <stores dir> 2026-11-04 2026-11-10`: the daemon's own file-seconds in the window and its gaps (`out-daemon-seconds.txt`).

Stores: `/home/agent/projects/{squeal,cezar}/.git/squeal/store.sqlite` with `-wal` and `-shm`, copied with `cp` to `$TMPDIR` on 2026-11-10 09:31Z, `PRAGMA quick_check` ok on both copies, opened read-only, deleted after use.
