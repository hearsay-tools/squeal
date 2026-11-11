# Probes for topic store-contention (021-03): throwaway

These scripts are throwaway evidence for `../../store-contention.md`. No product code imports them. Delete them when spec 021 closes.

Nothing here opens a live store. Store copies were made on 2026-11-11 at 14:22Z to 14:23Z with `cp store.sqlite store.sqlite-wal $TMPDIR/stores/<project>/` from `~/projects/{squeal,cezar}/.git/squeal/`. `lock-watch.mjs` watches live stores only through `/proc/locks` and a plain read of the `-shm` header. The fixture runs set `HOME` and every XDG directory under `$TMPDIR/sc-repro`, and remove it at the end. Every timing script exits when the one-minute load is at or above the CPU count.

| Script | What it shows |
|---|---|
| `lock-watch.mjs <seconds> <interval ms> <db>...` | Who holds each database's WAL write lock (POSIX lock on byte 120 of the `-shm` file), how long, and how many WAL frames the hold added. One JSON line per hold. Back-to-back transactions of one process within one poll merge into one hold. |
| `repro.mjs <squeal.mjs> <worktrees ≤ 6> <phase s> [standin]` | A fixture clone with N worktrees, a real daemon in each, edits, and the CLI writers of the open issues (`hold`, `stop --until-start` plus `start`, `status`, `retry`); phase B adds a process that holds `BEGIN IMMEDIATE` 1.5 s in every 3 s. Prints every CLI failure, the daemons' busy notes, and the holders `lock-watch.mjs` saw. |
| `starve.mjs <holders> <hold ms> <gap ms> <timeouts> <tries>` | On a scratch database: how often a one-shot `BEGIN IMMEDIATE` with a given busy timeout gets the lock while other processes take it again and again. |
| `store-stats.mjs <copy>` | Rows and bytes per table (`dbstat`) and which tables have a worktree column. |
| `busy-notes.mjs <copy>` | The busy-store and lock notes the daemons persisted (newest 20 per worktree). |
| `inventory.md` | Q1: every lock failure on record, with citations. Collated by a sub-agent, spot-checked. |
| `writers.md` | Q2: every writer, busy timeout, long transaction and table, with source lines at `0fa197e09`. Collated by a sub-agent, spot-checked. |
| `docs-facts.md` | Quotes from SQLite (3.53.4 and the `begin-concurrent` branch), libSQL, Turso, PostgreSQL, LMDB and `node:sqlite`, with URLs, commits and the retrieval date. Gathered by a sub-agent. |

Outputs in `out/`: `store-stats.txt`, `busy-notes-{squeal,cezar}.txt`, `lockwatch-live.txt` (summary of the 25-minute live watch and the 3 ms watch; raw holds in `lockwatch-live.jsonl.gz` and `lockwatch-fine.jsonl.gz`), `repro-6.jsonl` (the six-worktree run), `repro-holds-standin.jsonl` and `repro-holds-a.jsonl` (holds in the six-worktree run and in a two-worktree trial), `starve.jsonl`.

Commands used, from the repository root (Node v24.22.1):

```sh
node probes/store-contention/store-stats.mjs $TMPDIR/stores/<project>/store.sqlite
node probes/store-contention/busy-notes.mjs $TMPDIR/stores/<project>/store.sqlite
nice -n10 node probes/store-contention/lock-watch.mjs 1500 20 ~/projects/cezar/.git/squeal/store.sqlite ~/projects/squeal/.git/squeal/store.sqlite ~/projects/cezar/.git/squeal/code.sqlite
nice -n10 node probes/store-contention/lock-watch.mjs 60 3 ~/projects/cezar/.git/squeal/store.sqlite
node probes/store-contention/repro.mjs plugins/claude-code/dist/cli/squeal.mjs 6 60 standin
node probes/store-contention/starve.mjs <holders> <hold> <gap> 1000,2000,10000 20
```

(`probes/` here stands for `docs/specifications/021-remote-store-and-execution/research/probes/`.)
