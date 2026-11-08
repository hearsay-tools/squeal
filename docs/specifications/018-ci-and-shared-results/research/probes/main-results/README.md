# Probes for `../../main-results.md` (throwaway)

Throwaway. Written once on 2026-11-07/08 for research topic `main-results`; not maintained, not product code.

## Rules these probes keep

- Stores are read only from copies: `store.sqlite` with `-wal` and `-shm`, and the runs' `report.json` files, copied to `$TMPDIR/mr/<project>/` (2026-11-07 23:12Z). No live store, daemon socket or permit pool is opened. The researcher's own worktree (`a42d1179`) has no runs in either store.
- Git repositories (`~/projects/squeal`, `~/projects/cezar`) are read with `log`, `ls-tree`, `diff`, `merge-base`, `reflog show` only. Nothing is fetched or pushed.
- GitHub is read only: `gh api` run lists, job lists and three job logs. No workflow is started, no ref or setting is written.
- No test, build or benchmark runs. The scripts run under `nice -n 10`.

## Files

| File | What it gives | Question |
|---|---|---|
| `extract.cjs <store> <runs dir> <from> <exclude>` | one line per ended file run: tier kind, seconds, commit and dirty flag (revision row, else a surviving `results` row of the run) | 1 |
| `prize.cjs <store> <runs.jsonl> <ci.jsonl> <git dir> <main since> [extra runs]` | per file run: content at its commit equal to a main commit whose CI had finished before the run (`ci`), equal to the nearest such commit below its base (`near`), equal to a main commit that had landed (`landed`), CI age and lag | 1, 2 |
| `summary.cjs <prize.jsonl> <sar-u.csv> <switch>` | seconds by group (background, edit), period (before/after the switch), clean/dirty, above/below 16 busy vCPUs | 1, 2 |
| `ci-jobs.cjs <runs.jsonl> <jobs dir> <prefix> <step re> <job re>` | run wall, longest job, test step and job time outside it, runs that skipped the test step | 4 |
| `rekey.cjs` (same arguments as `prize.cjs`, then `<from> <to>`) | CI cost of an incremental export: files whose content changed between consecutive main commits, at their median local seconds | 5 |
| `results/*.summary.txt` | `summary.cjs` output: squeal, squeal with `cand/**` runs as extra producers, cezar | 1, 2 |
| `results/ci-jobs.txt`, `results/rekey-*.json` | `ci-jobs.cjs` and `rekey.cjs` output | 4, 5 |

## Re-running

```sh
S=$TMPDIR/mr; P=<this folder>; mkdir -p $S/cezar $S/squeal $S/jobs
for p in cezar squeal; do cp ~/projects/$p/.git/squeal/store.sqlite* $S/$p/
  rsync -a --include='*/' --include=report.json --exclude='*' ~/projects/$p/.git/squeal/runs/ $S/$p/runs/
  node $P/extract.cjs $S/$p/store.sqlite $S/$p/runs 2026-10-29T00:00:00Z a42d1179 > $S/$p.runs.jsonl; done
gh api --paginate "repos/hearsay-tools/cezarion/actions/workflows/346945062/runs?branch=main&event=push&created=>=2026-10-28&per_page=100" --jq '.workflow_runs[]|{id,head_sha,event,status,conclusion,created_at,run_started_at,updated_at,run_attempt}' > $S/ci-cezarion.jsonl
gh api --paginate "repos/hearsay-tools/squeal/actions/workflows/374500850/runs?branch=main&event=push&created=>=2026-10-28&per_page=100" --jq '...same...' > $S/ci-squeal.jsonl
# cezar merge groups: event=merge_group&created=>=2026-11-01 -> mg-cezarion.jsonl; squeal cand/**: event=push, head_branch cand/ -> cand-squeal.jsonl
# jobs: gh api repos/<repo>/actions/runs/<id>/jobs?filter=latest -> $S/jobs/<c|s><id>.json
for f in /var/log/sysstat/sa31 /var/log/sysstat/sa0[1-8]; do LC_ALL=C sadf -d -U $f -- -u | grep -v '^#'; done > $S/sar-u.csv
nice -n 10 node --max-old-space-size=12288 $P/prize.cjs $S/cezar/store.sqlite $S/cezar.runs.jsonl $S/ci-cezarion.jsonl ~/projects/cezar 2026-10-27T00:00:00Z > $S/cezar.prize.jsonl   # about 10 min
node $P/summary.cjs $S/cezar.prize.jsonl $S/sar-u.csv 2026-11-06T17:39:00Z
```

The run lists, job files, store copies and per-run outputs stayed in `$TMPDIR/mr` and were removed after the findings were written.
