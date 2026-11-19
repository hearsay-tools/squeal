# Probes for row 011-408 (issue #250)

Throwaway. They measure one `squeal status` call on a copy of a store. Findings: `../../issue-250-profile.md`.

Isolation: every script works under a scratch folder `$S` (the task's `t/<id8>`), and the store scripts refuse a path outside it. No daemon runs. `run.sh` clears the environment and sets `HOME`, `XDG_*` and `TMPDIR` to scratch, so the CLI's socket path is in scratch too. `prepare-store.mjs` sets every worktree's `daemon_socket` to `NULL`, so no real socket is dialled.

| File | What it does |
| --- | --- |
| `prepare-store.mjs` | On the copy: moves one worktree's rows to the id of the scratch clone's path, clears every socket. |
| `run.sh` | One isolated `status` call under `/usr/bin/time -v` and `timeout 180`; appends wall, user, sys, max RSS and load to `$S/out/runs.log`. |
| `analyze-profile.mjs` | Self time per function, and inclusive time of named frames, of a `.cpuprofile`. |
| `profile-tree.mjs` | The merged call tree under one function. |
| `phases.mjs` | Inclusive ms of each named status phase, one row per profile. |
| `count-rows.mjs` | A `--import` preload that counts SQLite calls and rows by phase. Its stack captures add CPU: never time a run with it. |
| `trim-imports.mjs` | On the copy: parks all but the newest N imports in side tables, or restores them. |
| `late-daemon.mjs` | A late daemon without a daemon: a fresh heartbeat and socket path on the copy's row, and a scratch listener that never answers. |
| `runs.log` | Every timed run of this study, in order. |

Setup used (2026-11-19):

```sh
S=<scratch>
cp ~/projects/cezar/.git/squeal/store.sqlite $S/orig/       # no -wal, no process held it; mtime unchanged after
git clone --no-hardlinks --no-checkout ~/projects/cezar $S/cezar && git -C $S/cezar checkout -b probe origin/cez/09efb45b
git -C $S/cezar remote remove origin
cp $S/orig/store.sqlite $S/cezar/.git/squeal/
node prepare-store.mjs $S/cezar/.git/squeal/store.sqlite a41de0395ad10bfe $S/cezar
for v in 566:squeal--v0.1.566 567:squeal--v0.1.567 main:origin/main; do
  mkdir -p $S/bin/${v%%:*}; git archive ${v#*:} plugins/claude-code/dist | tar -x -C $S/bin/${v%%:*}; done
F="packages/cezar/src/core/runner-skill-trigger-omp-parity.test.ts packages/cezar/src/core/runner-skill-trigger-pi-parity.test.ts"
S=$S ./run.sh main named-1 -- --json $F
S=$S ./run.sh main prof-1 --cpu-prof --cpu-prof-dir=$S/prof/main --cpu-prof-interval=500 -- --json $F
```
