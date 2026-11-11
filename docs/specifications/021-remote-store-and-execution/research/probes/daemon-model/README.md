# Probe daemon-model (throwaway)

Throwaway. These files measured `../../daemon-model.md` once, on 2026-11-11, and are not maintained. They read `/proc`, `squeal ps`, store copies, run-report copies and sar exports, read-only. They open no live store and no socket, signal no process, and start no test, build or load.

| File | What it is |
|---|---|
| `ps-snapshot.txt` | `squeal ps` at 14:26:55Z: 17 daemons, the flags it raised, the host's load. |
| `main-thread.sh`, `main-thread.txt` | One 3 s read of each flagged daemon's main thread: state, `wchan`, CPU. |
| `wchan-sample.sh`, `wchan.txt`, `pids.txt` | Every second for 120 s (14:27:44Z to 14:30:05Z), each daemon's main-thread state and `wchan`. `pids.txt` maps pid to worktree id. |
| `threads.py`, `threads.txt` | CPU over 30 s at 14:31:47Z per daemon: main thread, other threads, live children. |
| `budget.py`, `budget-16.json`, `budget-14.json` | Q4: what a host-wide background budget at 16 and at 14 busy vCPUs would have deferred from 2026-11-04 14:30Z to 2026-11-11 14:20Z, and its effect on edit-tier wall time. The model is in its docstring. |
| `prior-art-quotes.md` | Q3: quotes from the official docs and sources of Bazel, REAPI, Buck2, Gradle, Develocity Test Distribution, Pants, Vitest's pool API and LSP, fetched 2026-11-11. |

## How it ran

```sh
S=$TMPDIR/daemon-model; P=<this folder>; L=<repo>/docs/specifications/011-core/research/probes/load-slowdown
for p in cezar squeal; do
  mkdir -p $S/$p; cp ~/projects/$p/.git/squeal/store.sqlite* $S/$p/
  rsync -a --include='*/' --include=report.json --exclude='*' ~/projects/$p/.git/squeal/runs/ $S/$p/runs/
  node $L/extract-runs.mjs $p $S/$p/store.sqlite $S/$p/runs >> $S/runs.jsonl
done
for f in /var/log/sysstat/sa0[4-9] /var/log/sysstat/sa1[01]; do LC_ALL=C sadf -d -U $f -- -u | grep -v '^#'; done > $S/sar-u.csv
python3 -I $P/budget.py $S/runs.jsonl $S/sar-u.csv 2026-11-04T14:30:00Z 2026-11-11T14:20:00Z 16 723a6d49
squeal ps > $P/ps-snapshot.txt
sh $P/wchan-sample.sh 120 $(awk '{print $1}' $P/pids.txt) > $P/wchan.txt
python3 -I $P/threads.py 30 $(awk '{print $1}' $P/pids.txt)
```

Store copies, run reports, sar exports and the raw fetched docs stayed under `$TMPDIR` and were removed after the work.
