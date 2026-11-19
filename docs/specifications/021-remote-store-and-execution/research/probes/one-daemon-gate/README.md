# Probes for topic one-daemon-gate (row 021-17): throwaway

Throwaway evidence for `../../one-daemon-gate.md`. No product code imports them. Delete them when spec 021 closes.

Nothing here opens a live store, a socket, or signals a process. Live daemons are read only through `/proc/locks`, `/proc/<pid>/task/<pid>/{stat,wchan}`, `squeal ps` and their log files. Raw outputs had `$HOME` replaced by `~`.

| File | What it does |
|---|---|
| `wchan-watch.mjs <seconds>` | Every second, every live daemon's main-thread state and `wchan` (process title `squeal <project> daemon @<worktree>`, found again every 5 s). One process, no forks. |
| `summarize-locks.mjs <from> <seconds> <lockwatch.jsonl> [commonDir...]` | Share of the window each store's write lock was held, by holder class, holds ≥1/2/5 s, per 5 minutes; with commonDirs, split into logged prune holds and the rest. Input from `../store-contention/lock-watch.mjs`. |
| `summarize-wchan.mjs <wchan.txt> [lockwatch.jsonl [commonDir...]]` | Running, busy wait (`hrtimer_nanosleep`), idle; which store another process held at each busy-wait sample; the prune split. |
| `long-writes.mjs` | Reads D3's long-write log lines and marks prune holds. |
| `logs-summary.mjs <since> <until> <commonDir>...` | Long writes per store, day and operation; busy notes; "database is locked" lines. |
| `log-windows.mjs <since> <until> <commonDir>...` | Share of each 25-minute window held by logged long holds, with and without prune holds. |
| `explain-prune.mts` | Query plans of the code-store prune's searches on an empty in-memory database with the code store's schema (`node_modules/.bin/tsx`, from the repository root). |

Outputs in `out/`: `window-1.txt` (summaries), `lockwatch-1.jsonl.gz`, `wchan-1.txt.gz`, `ps-window-1.txt` (`squeal ps` every 5 minutes), `logs-summary.json`, `log-windows.txt`, `explain-prune.txt`.

Commands, from the repository root (Node v26.13.0), `P=docs/specifications/021-remote-store-and-execution/research/probes`, `D="~/projects/cezar/.git/squeal ~/projects/squeal/.git/squeal"`:

```sh
nice -n10 node $P/store-contention/lock-watch.mjs 1500 20 ~/projects/cezar/.git/squeal/{store,code,lint}.sqlite ~/projects/squeal/.git/squeal/{store,code}.sqlite > lockwatch-1.jsonl
nice -n10 node $P/one-daemon-gate/wchan-watch.mjs 1360 > wchan-1.txt
node $P/one-daemon-gate/summarize-locks.mjs 2026-11-19T08:03:03Z 1500 lockwatch-1.jsonl $D
node $P/one-daemon-gate/summarize-wchan.mjs wchan-1.txt lockwatch-1.jsonl $D
node $P/one-daemon-gate/logs-summary.mjs 2026-11-14T16:00:00Z 2026-11-19T08:00:00Z $D
node $P/one-daemon-gate/log-windows.mjs 2026-11-16T00:00:00Z 2026-11-19T08:00:00Z $D
node_modules/.bin/tsx $P/one-daemon-gate/explain-prune.mts
```

Window 1 used whole-second samples; window 2 samples at millisecond times, matched with holds within 20 ms.
