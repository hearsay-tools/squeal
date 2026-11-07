# Probe load-slowdown (throwaway)

Throwaway. These scripts measured `../../load-slowdown.md` once, on 2026-11-07, and are not maintained. They read store copies, run-report copies, sar exports and agent transcripts, read-only. They never open a live store or a daemon socket, and they start no test, build or load. Every output stays in scratch space (`$S` below), out of the repository. The transcript outputs hold transcript text.

| File | What it does |
|---|---|
| `extract-runs.mjs PROJECT STORE RUNS` | One JSON line per ended run: times, worktree, checkpoint kind, revision facts where the row still exists, and each completed file's module duration from `report.json`. |
| `load.py` | Shared loaders: sar samples, runs, and a step function for "files at once" over any window. |
| `slowdown.py RUNS SAR EXCLUDE [day\|day-wt\|head] [all\|no-baseline\|baseline]` | Q1: the slowdown per busy-vCPU band and per Squeal-concurrency band, as pairwise group ratios and as fixed effects (its docstring has the rules). |
| `exposure.py RUNS SAR EXCLUDE KNEE` | Q2, Q5, Q6b: Squeal's worker seconds per busy band, who ran above the knee, and throughput (busy ÷ slowdown) against a 12-vCPU cap. |
| `agent-overlap.py CLS RAW RUNS SAR EXCLUDE_TASK8` | Q3, Q4: agents' own runs (from `../host-load/011-181/`), their overlap and slowdown, and the seconds Squeal's load added, with a high and a low bound. |
| `edit-tiers.py RUNS SAR EXCLUDE` | Q4: edit tiers' wall, their slowdown with and without Squeal's other work, and the delay from the revision to the tier. |
| `squeal-waits.py SINCE UNTIL OUT` | Q4: the wall of each `squeal status`, `run`, `retry` and `why` command in transcripts, and the sessions per project. |

The curve `CURVE` in `exposure.py`, `agent-overlap.py` and `edit-tiers.py` is the 2-vCPU fixed-effects result of `slowdown.py` (day groups, all runs), copied in by hand.

## How it ran

```sh
S=<scratch>; P=<this folder>; H=$P/../host-load/011-181
for p in cezar squeal toolkit-dev saas-bp-management-dashboard mvp-unveiled-july26; do
  mkdir -p $S/$p; cp ~/projects/$p/.git/squeal/store.sqlite* $S/$p/
  rsync -a --include='*/' --include=report.json --exclude='*' ~/projects/$p/.git/squeal/runs/ $S/$p/runs/
  node --disable-warning=ExperimentalWarning $P/extract-runs.mjs $p $S/$p/store.sqlite $S/$p/runs >> $S/runs.jsonl
done
for f in /var/log/sysstat/sa[0-9][0-9]; do LC_ALL=C sadf -d -U $f -- -u | grep -v '^#'; done > $S/sar-u.csv
for f in /var/log/sysstat/sa[0-9][0-9]; do LC_ALL=C sadf -d -U $f -- -q | grep -v '^#'; done > $S/sar-q.csv
awk -F';' -v c=$(date -u -d 2026-11-07T08:20:00Z +%s) '$3<=c' $S/sar-u.csv > $S/sar-u-pre.csv   # before the CI test
python3 -I $P/slowdown.py $S/runs.jsonl $S/sar-u-pre.csv bb871401 day all
python3 -I $P/exposure.py $S/runs.jsonl $S/sar-u-pre.csv bb871401 16
python3 -I $H/extract.py 2026-10-29T23:00:00Z 2026-11-07T09:20:00Z $S/agent-runs.jsonl
python3 -I $H/classify.py $S/agent-runs.jsonl $S/agent-cls.jsonl $H/overrides.json
python3 -I $P/agent-overlap.py $S/agent-cls.jsonl $S/agent-runs.jsonl $S/runs.jsonl $S/sar-u-pre.csv bb871401
python3 -I $P/edit-tiers.py $S/runs.jsonl $S/sar-u-pre.csv bb871401
python3 -I $P/squeal-waits.py 2026-10-29T23:00:00Z 2026-11-07T09:20:00Z $S/squeal-waits.jsonl
```

The by-hour steal table, the run-queue bands, the named-wait bands and the agents' share above the knee came from short inline Python over the same scratch files. The findings file gives their figures.

## Limits

- The store keeps one result per check and key (`INSERT OR REPLACE`), so no two runs can be paired at the same key. Content is controlled by file and UTC day.
- The tier kind (edit or backlog) is inferred from the run row: it does not record why the tier ran.
- A run's "files at once" is its module seconds over its wall, a mean over the whole run.
- sar samples are 10-minute means. A run takes the sample that holds its midpoint (`slowdown.py`), or a time-weighted mean over the samples it overlaps (the others).
