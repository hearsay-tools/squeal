# Probes for 011-161: what departure drains do since 011-93

Throwaway. Written for `research/drains.md`, 2026-10-23. Nothing here is product code, and nothing here is maintained.

## Rules these probes keep

- Every store number is read from copies: `store.sqlite` with `-wal` and `-shm` of the cezar, squeal and toolkit-dev stores, copied back to back. Cezarion's `runs.db` (with `-wal` and `-shm`) of the cezar and squeal repositories is read from copies too. Run reports (`runs/<id>/report.json`) are read from a snapshot copied right after the store copy.
- No probe opens a live store, a daemon socket or the slow-permit pool, starts a daemon, a test or a Squeal command, or signals a process. `squeal ps` was not used. `sample.py` reads `/proc` and stats worktree roots; that is its only contact with the live system.
- Every script runs with `nice -n 10` (and `ionice -c3` for the copies), `PLUGIN_ROOT` and `PLUGIN_DATA` unset, in `/tmp/dr161`. Nothing started between 06:45Z and 07:30Z.
- `drains-011-84.py` is 011-84's `drains.py`, copied unchanged from `tasks/011-84/probes/` and read before it ran. It ran on the copies only, through a directory of symlinks named like a common dir.

## Files

| File | Measures | Question |
| --- | --- | --- |
| `drains-011-84.py <common-dir>...` | 011-84's script, unchanged: drains from notes, runs, results read later | 1 (cross-check) |
| `drains.py <store-copy> <repo-root> <runs.db-copy or -> <reports-dir> <since-iso> <copied-at-ms>` | one JSON line per drain since a time: what it drained for, how it ended, its runs (slow or fast), wall and recorded seconds, minutes with no run, slot notes, results (stored, read later, at a key another live worktree holds), the worktree's removal time from cezarion | 1, 3, 4 |
| `removals.py <runs.db-copy> <store-copy> <since-iso>` | per cezarion task finished since a time: minutes from its finish to its worktree's removal, and the runs and results the store keeps of it after the finish | 3, 4 |
| `sample.py <scratch> <samples> <interval-s> <copy-every> <repo>...` | `/proc` per Squeal daemon and its descendants (PSS, RSS, CPU ticks), the load, and every `copy-every` samples a store copy reduced to JSON (worktrees, consumers, notes, slow-lane rows, runs) | 2 |
| `memory.py <scratch> [idle-min]` | joins each sample to the newest copy before it: draining, live or other per daemon; MiB, test-process MiB, CPU-s per minute, the load | 2, 5 |
| `options.py <drains.jsonl> <wait-pss-mib> <wait-cpu-s-per-min> [gap-s]` | replays (a) exit when the drain must wait, (b) a 15-minute bound, (c) no drains, (d) as today over the drains | 5 |
| `results/*` | the outputs `drains.md` quotes | all |

## Re-running

```sh
S=/tmp/dr161; P=<this folder>; mkdir -p $S/c0 $S/live; cd $S/c0
unset PLUGIN_ROOT PLUGIN_DATA
for r in squeal cezar toolkit-dev; do mkdir -p $r; nice -n 10 ionice -c3 cp ~/projects/$r/.git/squeal/store.sqlite{,-wal,-shm} $r/; done
for r in cezar squeal; do mkdir -p cz-$r; nice -n 10 cp ~/projects/$r/.ai/cezar/runs.db{,-wal,-shm} cz-$r/; done
for r in cezar squeal toolkit-dev; do mkdir -p reports-$r; (cd ~/projects/$r/.git/squeal/runs && find . -maxdepth 2 -name report.json -newermt '2026-10-22 04:00Z' | while read f; do mkdir -p $S/c0/reports-$r/$(dirname $f); cp $f $S/c0/reports-$r/$f; done); done
COPIED=<epoch ms of the store copy>
# question 1 cross-check: 011-84's script over symlinked common dirs
for r in squeal cezar toolkit-dev; do mkdir -p common-$r/squeal; for f in store.sqlite{,-wal,-shm}; do ln -sf $S/c0/$r/$f common-$r/squeal/$f; done; done
nice -n 10 python3 -I $P/drains-011-84.py $S/c0/common-cezar $S/c0/common-squeal $S/c0/common-toolkit-dev
# questions 1, 3, 4
nice -n 10 python3 -I $P/drains.py cezar/store.sqlite ~/projects/cezar cz-cezar/runs.db reports-cezar 2026-10-22T04:38:09Z $COPIED > drains-cezar.jsonl
nice -n 10 python3 -I $P/drains.py squeal/store.sqlite ~/projects/squeal cz-squeal/runs.db reports-squeal 2026-10-22T04:38:09Z $COPIED
nice -n 10 python3 -I $P/drains.py toolkit-dev/store.sqlite ~/projects/toolkit-dev - reports-toolkit-dev 2026-10-22T04:38:09Z $COPIED
for r in cezar squeal; do nice -n 10 python3 -I $P/removals.py cz-$r/runs.db $r/store.sqlite 2026-10-22T04:38:09Z > removals-$r.jsonl; done
# question 2: 45 samples a minute apart, a store copy every 5
nice -n 10 ionice -c3 python3 -I $P/sample.py $S/live 45 60 5 ~/projects/cezar ~/projects/squeal ~/projects/toolkit-dev
nice -n 10 python3 -I $P/memory.py $S/live
# repeat the copies and drains.py into $S/c1 after the sampler; merge both, the later copy winning per (worktree, start)
python3 -I -c 'import json,sys; m={}
for f in sys.argv[1:]:
    for l in open(f):
        d=json.loads(l)
        if "totals" not in d: m[(d["wt"], d["start"])] = d
[print(json.dumps(d)) for d in sorted(m.values(), key=lambda d: d["start"])]' $S/c0/drains-cezar.jsonl $S/c1/drains-cezar.jsonl > $S/merged-cezar.jsonl
# question 5, with the waiting drain's mean PSS (350 MiB) and CPU (0.64 CPU-s a minute) from memory.py; gaps 60, 30, 120 s
for g in 60 30 120; do nice -n 10 python3 -I $P/options.py $S/merged-cezar.jsonl 350 0.64 $g; done
```

To re-read the committed samples: `mkdir -p x/stores && gunzip -c results/samples-1935Z-2020Z.jsonl.gz > x/samples.jsonl`; the reduced store copies (26 MB, notes included) were not committed, so `memory.py` needs a fresh run of `sample.py`.

Done on 2026-10-23: c0 at 19:32:47Z, sampler 19:35:52Z to 20:19:51Z, c1 at 20:20:21Z. No process was started besides these scripts and `cp`.

The 2026-10-22T04:38:09Z start is the `squeal--v0.1.253` tag's commit time. Clean up: `rm -rf /tmp/dr161` (done after the commit).
