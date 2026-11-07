# Probe wait-timeouts (throwaway)

Throwaway. These scripts measured `../../wait-timeouts.md` once, on 2026-11-07, and are not maintained. They read agent transcripts, store copies and a sar export, read-only. They never open a live store or a daemon socket, and they start no test, build or load. Every output stays in scratch space (`$S` below), out of the repository. `waits.jsonl` holds Squeal's printed output of each wait (file names and verdict lines).

| File | What it does |
|---|---|
| `extract-waits.py SINCE UNTIL OUT` | One line per `squeal status --wait` command: session, cwd, times, wall, limit, named paths, exit code and full output. |
| `classify.py WAITS SAR EXCLUDE OUT` | Q1: load band per wait; timed out = the output has "the deadline passed after"; per named file state and the primary class. Prints the tables. |
| `class-rates.py CLS` | Q1/Q4: timed-out waits per 100 waits per class and band, for all waits, waits that name test files only, and waits that name a source file. |
| `ahead.py WAITS CLS` | Q2/Q3: size and start of the tier ahead or in flight, and the stated reason a tier does not yield. |
| `timeline.mjs CLS SCRATCH OUT [all]` | Q3/Q4: from store run rows, the split of each wait's first 60 s (or its wall, with `all`) into own run / other runs / no run, the runs around it, and when the named files' run ended. |
| `summarize-timeline.py TL` | Q3: the split per band and class, and which classes hold the "no run" and "other runs" seconds. |
| `sample.py TL SEED` | Q3: the stratified sample table (seed 11 in the findings). |
| `edit-events.py SINCE UNTIL OUT` | Q4: agents' edit tool calls with time and worktree root (Claude Edit/Write/MultiEdit/NotebookEdit; Codex apply_patch files). |
| `edit-rate.py WAITS CLS EDITS` | Q4: timed-out share per band inside edit-rate strata, and the standardised shares. |
| `band-split.py TL_ALL` | Q4: mean seconds per named wait in each state per band, and the excess over 0–6 busy. |
| `savings.py CLS TL DAYS` | Q5: hours per day per class (whole, in its blocking state, above the 0–12 rate). |
| `cezar-baseline.py TL_ALL` | cezar named waits before and after cezar's change to lookup-only baselines (2026-11-06 17:39Z): timed-out share and seconds behind a restart baseline's run. |
| `chains.py WAITS CLS DAYS` | Q5: follow-up waits after a timeout, and the total and excess hours of named waits. |

`classify.py` and the other Python scripts import `../load-slowdown/load.py` (sar loader, bands, quantiles).

## How it ran

```sh
S=<scratch>; P=<this folder>
squeal stop --until-start   # in this session's own worktree
for p in cezar squeal toolkit-dev saas-bp-management-dashboard mvp-unveiled-july26; do
  c=$(git -C ~/projects/$p rev-parse --path-format=absolute --git-common-dir); mkdir -p $S/$p
  cp $c/squeal/store.sqlite* $S/$p/
done
for f in /var/log/sysstat/sa[0-9][0-9]; do LC_ALL=C sadf -d -U $f -- -u | grep -v '^#'; done > $S/sar-u.csv
awk -F';' -v c=$(date -u -d 2026-11-07T08:20:00Z +%s) '$3<=c' $S/sar-u.csv > $S/sar-u-pre.csv
python3 -I $P/extract-waits.py 2026-10-29T23:00:00Z 2026-11-07T08:20:00Z $S/waits.jsonl
python3 -I $P/classify.py $S/waits.jsonl $S/sar-u-pre.csv 33e995c3 $S/cls.jsonl
python3 -I $P/class-rates.py $S/cls.jsonl
python3 -I $P/ahead.py $S/waits.jsonl $S/cls.jsonl
node --disable-warning=ExperimentalWarning $P/timeline.mjs $S/cls.jsonl $S $S/tl.jsonl
node --disable-warning=ExperimentalWarning $P/timeline.mjs $S/cls.jsonl $S $S/tl-all.jsonl all
python3 -I $P/summarize-timeline.py $S/tl.jsonl
python3 -I $P/sample.py $S/tl.jsonl 11
python3 -I $P/edit-events.py 2026-10-29T22:00:00Z 2026-11-07T08:20:00Z $S/edits.jsonl
python3 -I $P/edit-rate.py $S/waits.jsonl $S/cls.jsonl $S/edits.jsonl
python3 -I $P/band-split.py $S/tl-all.jsonl
python3 -I $P/savings.py $S/cls.jsonl $S/tl.jsonl 8.39
python3 -I $P/cezar-baseline.py $S/tl-all.jsonl
python3 -I $P/chains.py $S/waits.jsonl $S/cls.jsonl 8.39
```

## Limits

- Only the first deadline sentence of a command is classified. A command that loops several waits counts once.
- The store prunes revision rows, so timelines use run rows only. A run row has no cancel flag and no tier kind.
- The store does not record pool refusals, so a permit wait is seen only as a free worktree that runs nothing.
- The Codex edit count misses edits made through the shell, so `edits5` is a lower bound. The revision rate from headers needs an earlier wait in the same worktree (n 770).
- The wall clock times in Squeal's output are Europe/Warsaw (UTC+1 in the whole window). `ahead.py` converts them with that offset.
