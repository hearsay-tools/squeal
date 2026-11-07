# Probe unread-work (throwaway)

Throwaway. These scripts measured `../../unread-work.md` once, on 2026-11-07, and are not maintained. They read copies of Squeal stores, run reports, Cezar task databases, and agent transcripts and sar exports, all read-only. They never open a live store or a daemon socket, and they start no test, build or load. Every output stays in scratch space (`$S` below), out of the repository. Transcript outputs hold paths, times and FAIL file names only.

| File | What it does |
|---|---|
| `extract.mjs PROJECT STORE RUNS` | One JSON line per worktree row and per ended run. Beside `../load-slowdown/extract-runs.mjs`'s fields, each completed file carries its surviving result row for that run: max `last_used_at`, `recorded_at`, the count of fails, and how many other worktrees hold its key now (`test_file_keys`). |
| `removals.mjs RUNSDB...` | From Cezar's `runs.db` copies: each task's worktree path, finish time, destroy request time and phase, and whether the path exists now. |
| `sessions.py SINCE UNTIL EXCLUDE OUT` | `../manual-mode/sessions.py` with two changes. FAIL lines use today's hook format (`FAIL  [project] path`), and Pi sessions (`~/.pi/agent/sessions`) are read. |
| `classify.py RUNS SESSIONS REMOVALS SAR EXCLUDE OUT` | One line per record (a file's seconds in a run): kind, worktree root by sha256 of the path, no-session flags, the next session event, the next run of the same file, the removal, read in its worktree or by another, and the busy vCPUs. Its docstring has the rules. Env: `START`, `END`, `GAP_MIN`. |
| `summarize.py REC` | Class shares per project and kind, with and without the strict reader (Stop, waits and FAIL messages only). |
| `explicit.py REC SESSIONS` | Finding 4: each record's first explicit reader (named ask, FAIL message, another worktree, bare wait, silence, nobody), first failures per class. |
| `details.py REC` | Classes 1 to 3: shares, who read it later and when, removal within N hours, the same file run again within N minutes, first failures. |
| `after-last.py REC SESSIONS` | Class 1: minutes from the root's last session event to the run's start. |
| `curve.py REC SESSIONS` | Finding 5: hold background work while no session event for X minutes. |
| `turn.py REC SESSIONS` | Finding 5: hold background work while every session's last event is its Stop. Env: `AFTER_MIN`, `IDLE_MIN` (Pi). |

## How it ran

```sh
S=<scratch>; P=<this folder>
squeal stop --until-start   # in this session's own worktree
for p in squeal cezar toolkit-dev; do
  c=$(git -C ~/projects/$p rev-parse --path-format=absolute --git-common-dir); mkdir -p $S/$p
  cp $c/squeal/store.sqlite* $S/$p/
  nice -n 10 rsync -a --include='*/' --include=report.json --exclude='*' $c/squeal/runs/ $S/$p/runs/
  nice -n 10 node --disable-warning=ExperimentalWarning $P/extract.mjs $p $S/$p/store.sqlite $S/$p/runs >> $S/runs.jsonl
done
mkdir -p $S/cz-squeal $S/cz-cezar
cp ~/projects/squeal/.ai/cezar/runs.db* $S/cz-squeal/; cp ~/projects/cezar/.ai/cezar/runs.db* $S/cz-cezar/
node --disable-warning=ExperimentalWarning $P/removals.mjs $S/cz-squeal/runs.db $S/cz-cezar/runs.db > $S/removals.jsonl
for f in /var/log/sysstat/sa[0-9][0-9]; do LC_ALL=C sadf -d -U $f -- -u | grep -v '^#'; done > $S/sar-u.csv
python3 -I $P/sessions.py 2026-10-29T23:00:00Z 2026-11-07T22:40:00Z a1d21d26 $S/sessions.jsonl
python3 -I $P/classify.py $S/runs.jsonl $S/sessions.jsonl $S/removals.jsonl $S/sar-u.csv a1d21d26 $S/rec.jsonl
python3 -I $P/summarize.py $S/rec.jsonl
python3 -I $P/explicit.py $S/rec.jsonl $S/sessions.jsonl
python3 -I $P/details.py $S/rec.jsonl
python3 -I $P/after-last.py $S/rec.jsonl $S/sessions.jsonl
python3 -I $P/curve.py $S/rec.jsonl $S/sessions.jsonl
for m in 0 3 10 30; do AFTER_MIN=$m python3 -I $P/turn.py $S/rec.jsonl $S/sessions.jsonl; done
```

The window (`START` 2026-10-31T20:00Z, `END` 2026-11-07T08:20Z) is `classify.py`'s default. sar rows after `END` are present but unused, because every record starts before it.

## Limits

- The store keeps no reader. Every "read" is a proxy (the findings file, Method). A later session event counts as a read of every current result in its worktree.
- The other-worktree reader is a lower bound. It sees only surviving result rows, and only keys held now or uses after the producer's last activity.
- Removal times come from Cezar's destroy requests. Task rows deleted since have no time. Their worktrees are gone, and their records fall in "no later event".
- Tier kind (edit or backlog) is inferred as in `load-slowdown.md`.
- Session presence comes from transcript events, not from daemon registrations, which the store deletes.
