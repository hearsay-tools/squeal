# Probe cpu-budget (throwaway)

Throwaway. These files measured `../../cpu-budget.md` once, on 2026-11-11, and are not maintained. They read store copies, run-report copies, copies of Cezar's task databases, sar exports and agent transcripts, read-only. They open no live store and no socket, signal no process, and start no test, build or load. Store copies, transcripts output and fetched docs stayed under `$TMPDIR` and were removed after the work. The `out-*.jsonl` files hold aggregate figures only.

| File | What it is |
|---|---|
| `extract.mjs` | One line per ended run from a store copy and its `report.json` copies: as 011 `probes/load-slowdown/extract-runs.mjs`, plus the picked files (`runs.test_files`), so the replay can tell when a later revision made a queued file stale. |
| `removals.mjs` | Worktree removal times from copies of Cezar's `runs.db`, keyed by Squeal's worktree id (sha256 of the root path, first 16 hex). |
| `replay.py` | Q1 to Q3: the week as a queue under no budget, the adaptive budget of 011 `background-backoff.md` and fixed ceilings. Its docstring has the model. Env: `OWORK=1` holds other load as fixed work instead of fixed cores; `CURVE=hw` charges CPU only for the shared-hardware part of the slowdown; `REPLAY_MIN` sets the floor in cores (default 2); `CHAIN_S` the chaining gap (default 5 s; `-1` turns chaining off); `SEED`. |
| `summarize.py` | One table row per policy from a replay output. |
| `curve-math.py`, `curve-math.txt` | Q4: host throughput B/S(B) and background's own throughput g/S(b0+g) on the 011 curve. |
| `out-base.jsonl` | The main run: all policies, other load as recorded cores. |
| `out-owork.jsonl`, `out-hw.jsonl`, `out-sens.jsonl`, `out-seed2.jsonl`, `out-seed3.jsonl` | The variants: other load as fixed work, CPU charged for shared hardware only, floor and chaining off, seeds 2 and 3 of the adaptive budget. |

## How it ran

```sh
S=$TMPDIR/cpu-budget; P=<this folder>; R=<repo>/docs/specifications/011-core/research/probes
for p in squeal cezar toolkit-dev; do
  mkdir -p $S/$p; cp ~/projects/$p/.git/squeal/store.sqlite* $S/$p/
  rsync -a --include='*/' --include=report.json --exclude='*' ~/projects/$p/.git/squeal/runs/ $S/$p/runs/
  node $P/extract.mjs $p $S/$p/store.sqlite $S/$p/runs >> $S/runs2.jsonl
  node $R/load-slowdown/extract-runs.mjs $p $S/$p/store.sqlite $S/$p/runs >> $S/runs.jsonl   # for signal.py
done
for p in cezar squeal; do mkdir -p $S/cz-$p; cp ~/projects/$p/.ai/cezar/runs.db* $S/cz-$p/; done
node $P/removals.mjs $S/cz-cezar/runs.db $S/cz-squeal/runs.db > $S/removals.jsonl
for f in /var/log/sysstat/sa0[3-9] /var/log/sysstat/sa1[01]; do LC_ALL=C sadf -d -U $f -- -u | grep -v '^#'; done > $S/sar-u.csv
python3 -I $R/host-load/011-181/extract.py 2026-11-04T15:00:00Z 2026-11-11T15:10:00Z $S/agent-runs.jsonl
python3 -I $R/host-load/011-181/classify.py $S/agent-runs.jsonl $S/agent-cls.jsonl $R/host-load/011-181/overrides.json
python3 -I $R/background-backoff/signal.py $S/runs.jsonl $S/sar-u.csv 33897777 $S/eps.json
A="$S/runs2.jsonl $S/sar-u.csv $S/eps.json $S/removals.jsonl $S/agent-cls.jsonl 2026-11-04T15:00:00Z 2026-11-11T15:10:00Z 33897777"
POL="none aimd:1.25 aimd:1.15 aimd:1.4 fixed:22 fixed:20 fixed:19 fixed:18 fixed:17 fixed:16 fixed:14 fixed:12"
python3 -I $P/replay.py $A $POL > out-base.jsonl
OWORK=1 python3 -I $P/replay.py $A $POL > out-owork.jsonl
CURVE=hw python3 -I $P/replay.py $A $POL > out-hw.jsonl
python3 -I $P/summarize.py out-base.jsonl
```

Copies were taken 2026-11-11 15:20Z; the one-minute load was 25 to 29 on 24 vCPUs during the work. No timing in the findings is a measurement on this host: every figure is a replay of recorded history.

## Limits

- Other load (agents, their own tests, builds, Squeal's daemon main threads) is held as recorded cores. Held as fixed work instead (`OWORK=1`), the replay of no budget does not reproduce the recorded week (58.8% of time above 16 busy against 25.3% recorded): above about 19 busy each extra core slows other work enough to need more than one more core, so the model runs away. The truth lies between: agents wait for test results, so their demand falls when the host is slow.
- One curve, this host's. Edit tiers keep their recorded start; only their run speed changes.
- A tier's cores are fixed for its life (011 `background-backoff.md` finding 6). A budget that admits a tier with less room gives it fewer cores, and so a longer wall.
