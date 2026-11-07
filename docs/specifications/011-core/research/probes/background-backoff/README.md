# Probe background-backoff (throwaway)

Throwaway. These scripts measured `../../background-backoff.md` once, on 2026-11-07, and are not maintained. They read store copies, run-report copies, sar exports and `/proc` and `/sys` files, read-only. They never open a live store or a daemon socket, and they start no test, build or load. Every output stays in scratch space (`$S` below), out of the repository. They reuse `../load-slowdown/load.py` and `../load-slowdown/extract-runs.mjs`.

| File | What it does |
|---|---|
| `curve.py` | The load-slowdown curve `S(busy)`, as `../load-slowdown/exposure.py` holds it. |
| `signal.py RUNS SAR EXCLUDE OUT-EPS [DAYS Q MIN]` | Shape 1 from history: each file record's ratio to the Q-quantile of its own earlier durations, per run, per 10-minute sample and in 60 s windows, by busy band; writes each sample's signal and residual for `replay.py`. |
| `replay.py RUNS SAR EXCLUDE EPS [KNEE SEED SAR-Q]` | Q2: a fluid replay of background back-off policies over the sar samples (today, a core gate without the floor, the slowdown controller, load per CPU). `REPLAY_MIN` sets the starvation floor in cores (default 2). Its docstring has the model. |
| `psi-sample.py OUT STEP N` | A passive sampler: busy and nice cores from `/proc/stat`, the run queue, load, and CPU pressure for the host and the user's slice, every STEP seconds. |
| `psi-analyze.py PSI` | The sampler's lines by busy band. |

## How it ran

```sh
S=<scratch>; P=<this folder>; L=$P/../load-slowdown
for p in squeal cezar toolkit-dev; do
  mkdir -p $S/$p; cp ~/projects/$p/.git/squeal/store.sqlite* $S/$p/
  rsync -a --include='*/' --include=report.json --exclude='*' ~/projects/$p/.git/squeal/runs/ $S/$p/runs/
  nice -n 10 node --disable-warning=ExperimentalWarning $L/extract-runs.mjs $p $S/$p/store.sqlite $S/$p/runs >> $S/runs.jsonl
done
for f in /var/log/sysstat/sa[0-9][0-9]; do LC_ALL=C sadf -d -U $f -- -u | grep -v '^#'; done > $S/sar-u.csv
for f in /var/log/sysstat/sa[0-9][0-9]; do LC_ALL=C sadf -d -U $f -- -q | grep -v '^#'; done > $S/sar-q.csv
awk -F';' -v c=$(date -u -d 2026-11-07T08:20:00Z +%s) '$3<=c' $S/sar-u.csv > $S/sar-u-pre.csv
python3 -I $L/exposure.py $S/runs.jsonl $S/sar-u-pre.csv 78bca3c1 16           # the copies against load-slowdown
python3 -I $P/signal.py $S/runs.jsonl $S/sar-u-pre.csv 78bca3c1 $S/eps.json      # and with 3 0.25 5, 7 0.5 5, 7 0.1 10, 1 0.25 3
python3 -I $P/replay.py $S/runs.jsonl $S/sar-u-pre.csv 78bca3c1 $S/eps.json 16 1 $S/sar-q.csv   # and seeds 2, 3; REPLAY_MIN=1, 4
nohup nice -n 19 python3 -I $P/psi-sample.py $S/psi.jsonl 10 600 &
python3 -I $P/psi-analyze.py $S/psi.jsonl
timeout 60 docker run --rm --network none --cpus 2 --entrypoint sh postgres:16.1-alpine -c \
  'cat /proc/pressure/cpu /sys/fs/cgroup/cpu.pressure /sys/fs/cgroup/cpu.max /proc/loadavg; nproc'
```

The load per CPU by busy band (sar -q) and the tier and file durations by kind came from short inline Python over the same scratch files; the findings file gives their figures.

## Limits

- `replay.py` holds all other load as recorded and drops no background work that a later revision would make stale. It uses this host's slowdown curve, so its figures belong to this host. The signal and its threshold do not.
- The 60 s noise in `replay.py` is the 10-minute residuals widened by a log-normal factor (σ 0.12), not the 60 s residuals themselves. Checked by drawing 20,000 readings per band: at θ 1.25 it flags 18.7 / 19.6 / 28.9 / 65.3 / 97.5% of readings in the bands 0–6 / 6–12 / 12–16 / 16–20 / 20–24, against 14.6 / 17.4 / 25.4 / 61.1 / 95.7% measured in 60 s windows (`signal.py`). It is a little noisier than measured, so the replay's deferral is, if anything, too high.
- `%nice` stands for Squeal's test CPU; other niced processes count as Squeal's.
- The live sampler's busy bands depend on what the host did in that hour: few samples fell above 18 busy.
