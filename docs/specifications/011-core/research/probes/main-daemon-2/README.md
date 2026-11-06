# Probes for 011-300: a main-checkout daemon, with today's numbers

Throwaway. Written for `research/main-daemon-2.md`, 2026-11-05/06. Nothing here is product code, and nothing here is maintained.

## Rules these probes keep

- A store is read only from a copy: `store.sqlite` with its `-wal` and `-shm`, copied with `cp` under `$TMPDIR/md2/stores/<repo>/`. No live store, daemon socket or permit pool is opened. Run logs (`report.json`) are read in place, read only. The git repositories are read with `rev-list`, `ls-tree` and the `origin/main` reflog file only.
- No daemon starts and no test runs: everything is a simulation over the store copy and git.
- `md2.mjs` imports 011-157's `../main-daemon/sig.mjs` for the content signature.

## Files

| File | What it gives | Question |
|---|---|---|
| `fileruns.cjs <store> <from> <to>` | one JSON line per (run, file) that started in the window: recorded seconds, ended, commit, dirty, worktree, main checkout or not, checkpoint kind (`first`, `restart`, `run-all`, `none`) | all |
| `rate.cjs <store> <fileruns>` | recorded s per wall minute of `run-all` checkpoints and of baselines that ran at least 1,000 s | 1 |
| `md2.mjs` | the simulation: main commits and landing times (reflog), per-commit re-key table, stored signatures, policies (every commit, every Nth, after Q quiet minutes) at each rate; spared worktree runs by kind and dirty flag; main runs no worktree needed; first-baseline waiting and start verdict. `MD_ENV=1` adds Vitest configs and the root lockfile to the signature | 1, 2, 3 |
| `runall.sh` | the four `md2.mjs` runs (cezar and squeal, env and no env) | 1, 2, 3 |
| `report.cjs <out prefix>` | the tables quoted in the findings | 1 to 4 |

## Results

`results/report-{cezar,squeal}-{env,noenv}.txt` (tables), `*-percommit.jsonl` (per main commit: files and seconds re-keyed, stored at landing), `*-sim.json` (per policy and rate), `cezar-env-wait-90.jsonl` and `cezar-env-start-90.jsonl` (per first baseline), `squeal-env-start-90.jsonl`, `rate-cezar.txt`, and the run logs. The file-run lists (`fr-*.jsonl`, 50 MB) are not kept; `fileruns.cjs` rebuilds them from a store copy within the 7-day retention.

## Re-running

```sh
P=<this folder>; mkdir -p $TMPDIR/md2/stores/cezar $TMPDIR/md2/stores/squeal $TMPDIR/md2/out && cd $TMPDIR/md2
cp ~/projects/cezar/.git/squeal/store.sqlite* stores/cezar/; cp ~/projects/squeal/.git/squeal/store.sqlite* stores/squeal/
for r in cezar squeal; do nice -n 10 node $P/fileruns.cjs stores/$r/store.sqlite 2026-11-02T16:50:00Z 2026-11-05T16:50:00Z > out/fr-$r.jsonl; done  # about 30 s each
node $P/rate.cjs stores/cezar/store.sqlite out/fr-cezar.jsonl
$P/runall.sh                                     # about 3 to 4 min per run, 4 runs, up to 8 GB heap
for t in cezar-env cezar-noenv squeal-env squeal-noenv; do node $P/report.cjs out/$t; done
```

The window's runs leave the stores after 7 days (`store.retentionDays`), so a re-run after 2026-11-09 gives other numbers. Clean up: `rm -rf $TMPDIR/md2`. Done on 2026-11-06.
