# Probe manual-mode (throwaway)

Throwaway. These scripts measured `../../manual-mode.md` once, on 2026-11-07, and are not maintained. They read store copies, run-report copies, sar exports and agent transcripts, read-only. They never open a live store or a daemon socket, and they start no test, build or load. Every output stays in scratch space (`$S` below), out of the repository. They reuse `../load-slowdown/` (`load.py`, `extract-runs.mjs`) and `../background-backoff/` (`curve.py`, `signal.py`).

| File | What it does |
|---|---|
| `signal60.py RUNS SAR EXCLUDE OUT` | The measured 60 s signal minute by minute (median ratio of the file records that ended in the minute, at least 5), its persistence, and the switch rules run on it as recorded (no feedback). Writes `sig60.json` for `manual.py`. |
| `manual.py RUNS SAR EXCLUDE EPS SIG60 SEED OUT-PERIODS [POLICY...]` | Q1–Q3: a replay on 60 s steps of `today`, the stepped budget (`aimd2:1.25`) and manual mode (`manual:ON:N:OFF:K:RAMP[:hold]`). Its docstring has the model. Env: `START`, `NOISE` (`replay`/`draw`), `AUTO_CAP`, `REPLAY_MIN`, `SLOT_EVERY`. Writes each policy's manual periods. |
| `sessions.py SINCE UNTIL EXCLUDE OUT` | Q1/Q4: per agent session in squeal, cezar and toolkit-dev worktrees, the times of prompts, Stop hooks, code edits, `squeal status --wait`/`squeal run` asks (paths only) and SQUEAL hook messages with `FAIL` lines (file names only). |
| `q4.py SESSIONS PERIODS POLICY...` | Q1: message pairs per session-day. Q4: edited files in manual periods by what reaches them first (ask, Stop, resume), and how much later failures would be found. |

## How it ran

```sh
S=<scratch>; P=<this folder>; L=$P/../load-slowdown; B=$P/../background-backoff
squeal stop --until-start   # in this session's own worktree
for p in squeal cezar toolkit-dev; do
  mkdir -p $S/$p; cp ~/projects/$p/.git/squeal/store.sqlite* $S/$p/
  nice -n 10 rsync -a --include='*/' --include=report.json --exclude='*' ~/projects/$p/.git/squeal/runs/ $S/$p/runs/
  nice -n 10 node --disable-warning=ExperimentalWarning $L/extract-runs.mjs $p $S/$p/store.sqlite $S/$p/runs >> $S/runs.jsonl
done
for f in /var/log/sysstat/sa[0-9][0-9]; do LC_ALL=C sadf -d -U $f -- -u | grep -v '^#'; done > $S/sar-u.csv
awk -F';' -v c=$(date -u -d 2026-11-07T08:20:00Z +%s) '$3<=c' $S/sar-u.csv > $S/sar-u-pre.csv
python3 -I $L/exposure.py $S/runs.jsonl $S/sar-u-pre.csv 3440e6d5 16          # the copies against load-slowdown
python3 -I $B/signal.py $S/runs.jsonl $S/sar-u-pre.csv 3440e6d5 $S/eps.json
python3 -I $B/replay.py $S/runs.jsonl $S/sar-u-pre.csv 3440e6d5 $S/eps.json 16 1   # today and aimd2 as before
export START=2026-10-31T20:00:00Z
python3 -I $P/signal60.py $S/runs.jsonl $S/sar-u-pre.csv 3440e6d5 $S/sig60.json
python3 -I $P/manual.py $S/runs.jsonl $S/sar-u-pre.csv 3440e6d5 $S/eps.json $S/sig60.json 1 $S/periods-s1.json   # the grid
# seeds 2 and 3; NOISE=draw; AUTO_CAP=16; REPLAY_MIN=1; SLOT_EVERY=2, each with the finalists as POLICY arguments
python3 -I $P/sessions.py 2026-10-29T23:00:00Z 2026-11-07T08:20:00Z 3440e6d5 $S/sessions.jsonl
python3 -I $P/q4.py $S/sessions.jsonl $S/periods-s1.json manual:1.25:2:1.15:2:1:hold manual:1.25:5:1.1:2:1:hold ...
```

## Limits

- `manual.py` inherits `replay.py`'s limits: other load and foreground cores stay as recorded, nothing waiting is dropped when a later revision makes it stale, and the slowdown curve is this host's.
- In manual mode, edit tiers run when the agent asks or at Stop. The replay keeps their cores where they ran.
- The noise replays the measured minute residual where a minute has 5 records (56% of minutes); the rest are drawn as `replay.py` draws them.
- `sessions.py` sees edits made with edit tools and `apply_patch` only. Codex agents edit through the shell often, so the edit counts are lower bounds, and 200 of 237 failure messages follow no edit it sees (`q4.py` estimates those, `est`).
- The stores hold almost no runs from 2026-10-30 10:47Z to 2026-10-31 14:11Z, so switch counts start at 2026-10-31 20:00Z.
