# Probes for 011-157: the main checkout as the baseline for new worktrees

Throwaway. Written for `research/main-daemon.md`, 2026-10-23. Nothing here is product code, and nothing here is maintained.

## Rules these probes keep

- Store copies only: `store.sqlite` with `-wal` and `-shm` of squeal, cezar and toolkit-dev, copied to `/tmp/md157/stores/` at 16:57:03Z (`copy-ms` 1792774623677). No live store, socket or permit pool is opened.
- The real repositories' git objects and reflogs are read with `git ls-tree`, `git cat-file`, `git merge-base --is-ancestor`, `git for-each-ref` and `git --no-optional-locks status` only.
- Live daemons are read with `ps` and `/proc/<pid>/stat` only (`sample-main.sh`).
- The one daemon experiment runs in `/tmp/md157/x`: a `git clone --no-local` of squeal, and a `git worktree add` on that clone, never on a real repository. `envrun.sh` starts every command with `env -i`, `HOME`, `XDG_*`, `TMPDIR`, `CODEX_HOME` and the npm, pnpm and corepack homes under `/tmp/md157`, at nice 10. `PLUGIN_ROOT`, `PLUGIN_DATA` and every `SQUEAL_*` variable are unset. The commit (`46dac522c`) has `baseline.onStart: "lookup-only"`, so no test ran. Started 17:15:07Z, stopped 17:17:05Z with `squeal stop`.
- Removed at the end: `rm -rf /tmp/md157`.

## Files

| File | Measures | Question |
|---|---|---|
| `sig.mjs` | closure-content signature of a test file at a commit (011-152's `content.mjs` method); with `MD_ENV=1`, also the vitest configs and the root lockfile | library |
| `coverage.mjs <store> <repo> <copy ms> <out.jsonl>` | per linked worktree's first start in 72 h: files and median seconds whose signature equals the main checkout's HEAD then, any main HEAD of the 7 days before, and origin/main then; the same for the start's misses (its first baseline checkpoint); where the start was | 1, 5 |
| `reflog.mjs <repo> <copy ms>` | the main checkout's HEAD moves in the window | 2 |
| `moves.mjs <store> <repo> <copy ms> <out.jsonl>` | with `MD_LOG=logs/refs/remotes/origin/main`, the moves of a main checkout that followed origin/main; per main HEAD move: files re-keyed, their median seconds, and how many a clean row of any worktree already held at equal content | 2 |
| `whyrekey.mjs <store> <repo> <from> <to>` | the changed closure paths behind one move's re-keys | 2 |
| `sim.mjs <moves.jsonl> <rate> [skip]` | what a main daemon that stays up runs for those moves at a rate in recorded s per wall minute, a later move superseding a queued file | 2, 5 |
| `lag.mjs <cov.jsonl> <moves.jsonl> <rate>` | at each first start, whether such a daemon had finished the main checkout's moves | 1, 5 |
| `loss.mjs <cov.jsonl> <moves.jsonl> <rate>` | which first starts still lose the start verdict, and why (content, or the daemon behind) | 5 |
| `startmiss.mjs <store> <copy ms> <cov.jsonl>` | each first start's misses today in median seconds | 5 |
| `mainfails.mjs <store> <repo> <copy ms>` | stored file failures at clean commits on origin/main | 5 |
| `validate.mjs <store> <repo> [n] [control]` | the main checkout's stored keys against linked worktrees' at equal signature | 1, 4 |
| `mkpair.sh <commit>`, `runpair.sh <out>`, `pairkeys.mjs <store>` | a main checkout with untracked files and a linked worktree nested in it, both keyed by the shipped 0.1.278 bundle; their keys compared | 1, 4 |
| `layouts.sh <dir>` | what git reports for a main checkout, linked, nested, bare-only, clone and submodule layouts | 4 |
| `sample-main.sh <out.tsv> <n> <s>` | CPU seconds and RSS of the host's main-checkout daemons over time | 2, 3 |
| `envrun.sh` | the isolated environment | 1, 4 |
| `results/` | the outputs the research file quotes (`cov2-*.txt` is the final coverage run; `moves-*.jsonl` without the per-file lists) | all |

## Re-running

```sh
S=/tmp/md157; P=<this folder>; mkdir -p $S/stores/{squeal,cezar,toolkit-dev}; cd $S
for r in squeal cezar toolkit-dev; do cp ~/projects/$r/.git/squeal/store.sqlite* $S/stores/$r/; done; date -u +%s%3N > copy-ms; T=$(cat copy-ms)
for r in squeal cezar toolkit-dev; do                                             # questions 1 and 5
  nice -n 10 node $P/coverage.mjs stores/$r/store.sqlite ~/projects/$r $T cov-$r.jsonl 2>/dev/null > cov-$r.txt
  MD_ENV=1 nice -n 10 node $P/coverage.mjs stores/$r/store.sqlite ~/projects/$r $T cov-env-$r.jsonl 2>/dev/null > cov-env-$r.txt
  nice -n 10 node $P/moves.mjs stores/$r/store.sqlite ~/projects/$r $T moves-$r.jsonl 2>/dev/null > moves-$r.txt   # question 2
  MD_LOG=logs/refs/remotes/origin/main nice -n 10 node $P/moves.mjs stores/$r/store.sqlite ~/projects/$r $T moves-origin-$r.jsonl 2>/dev/null > moves-origin-$r.txt
  for rate in 60 140; do node $P/sim.mjs moves-$r.jsonl $rate; node $P/sim.mjs moves-$r.jsonl $rate skip; node $P/sim.mjs moves-origin-$r.jsonl $rate skip; node $P/lag.mjs cov-$r.jsonl moves-$r.jsonl $rate; node $P/loss.mjs cov-$r.jsonl moves-$r.jsonl $rate; done
  node $P/startmiss.mjs stores/$r/store.sqlite $T cov-$r.jsonl; nice -n 10 node $P/mainfails.mjs stores/$r/store.sqlite ~/projects/$r $T
done
nice -n 10 node $P/validate.mjs stores/toolkit-dev/store.sqlite ~/projects/toolkit-dev   # question 4: main against linked keys in a store
sh $P/sample-main.sh $S/main-ps.tsv 40 30                                                # questions 2 and 3, ps only
cp -a ~/.claude/plugins/cache/hearsay/squeal/0.1.278 $S/bundle; cp $P/envrun.sh $S/        # questions 1 and 4: the pair
sh $P/mkpair.sh 46dac522c && sh $P/runpair.sh $S/an/pair1 && node $P/pairkeys.mjs $S/an/pair1/store.sqlite
sh $P/layouts.sh $S/layouts                                                              # question 4
rm -rf /tmp/md157
```

Start nothing between 06:45Z and 07:30Z. The coverage runs take 1 to 5 minutes each at load 15, longer at load 100.
