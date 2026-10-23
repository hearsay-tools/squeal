# Probes for 011-152: why a new worktree misses results another worktree stored

Throwaway. Written for `research/missed-sharing.md`, 2026-10-23. Nothing here is product code, and nothing here is maintained.

## Rules these probes keep

- Store copies only: `store.sqlite` with `-wal` and `-shm` of squeal and cezar, copied at 15:41:22Z and 15:41:24Z, each with a snapshot of its `runs` directory taken right after it. No live store, socket or permit pool is opened.
- The git object store of `~/projects/squeal` is read with `git ls-tree`, `git rev-list` and `git cat-file` only.
- Experiments run Squeal daemons in clones under `/tmp/ms152/clones`, made with `git clone --no-local`, never `git worktree add`. `envrun.sh` starts every command with `env -i`, `HOME`, `XDG_*`, `TMPDIR`, `CODEX_HOME` and the npm, pnpm and corepack homes under `/tmp/ms152`, at nice 10. `PLUGIN_ROOT`, `PLUGIN_DATA` and every `SQUEAL_*` variable are unset. `XDG_RUNTIME_DIR` under `/tmp` gives the daemons their own sockets and permit pool.
- Each clone sets `baseline.onStart` to `lookup-only` and gets a scrubbed copy of the store copy (`daemon_*` columns set to NULL), so a daemon keys and looks up and runs no test.
- Started 15:57Z, stopped 16:20Z. Every daemon was stopped with `squeal stop`, and `/tmp/ms152` was removed after the commit.

## Files

| File | Measures | Question |
|---|---|---|
| `first.mjs <store> <runs> <copy ms> <out.jsonl> [every]` | one line per miss of each worktree's first baseline checkpoint in the 72 hours (with `every`: every baseline checkpoint); its key, recorded seconds, rows of its file before the start at the same key and at the same commit | 1 |
| `sumck.mjs <first.jsonl>` | the same, one line per checkpoint | 1 |
| `content.mjs <store> <first.jsonl> <git dir> <out.jsonl>` | per miss: an earlier clean stored row of the file at a commit with equal closure content (stored closure list + observed set + declared inputs, hashed from `git ls-tree`) | 1, 2 |
| `earlier.mjs <store> <runs> <content.jsonl> <git dir> <out.jsonl>` | per miss with no such row: an earlier run whose report completed the file at equal content, and what became of its row | 1, 2 |
| `age.mjs <store> <content.jsonl> <git dir> <out.jsonl>` | how long the missed closure content had stood on its commit's first-parent line before the start | 2 |
| `classify.mjs <content> <earlier> <age>` | one cause per miss, recorded seconds and CPU-seconds | 2, 4 |
| `growth.mjs <store> <runs> <out.json>`, `growth2.mjs` | when each observed path of a file first appears in a run report; the paths that appeared between two runs at equal content | 2 |
| `envrun.sh`, `mkclone.sh <name> <commit>` | the isolated environment; a clone with `npm ci`, the lookup-only config and a scrubbed store copy | 2, 3 |
| `pair.mjs`, `pairkeys.mjs` | keys of two worktrees or two clones for the same files, against the stored keys | 2, 3 |
| `rekey3.mjs`, `rekey4.mjs` | rebuild a logged key with the host worktree's hashes and closure list (bundle copy patched to log `keyFromSegments` inputs) | 3 |
| `cezar.mjs`, `recon.mjs` | cezar's lookup-only first starts; the reconciliation with `stored-nothing.md` finding 5 | 1 |
| `results/*.txt` | the outputs the research file quotes | all |

## Re-running

```sh
S=/tmp/ms152; P=<this folder>; mkdir -p $S/{stores/{squeal,cezar},runs/{squeal,cezar},an}
for r in squeal cezar; do cp ~/projects/$r/.git/squeal/store.sqlite* $S/stores/$r/; cp -a ~/projects/$r/.git/squeal/runs/. $S/runs/$r/; done
T=<copy time, epoch ms>; G=~/projects/squeal/.git; cd $S
nice -n 10 node $P/first.mjs stores/squeal/store.sqlite runs/squeal $T an/first-squeal.jsonl          # question 1
nice -n 10 node $P/first.mjs stores/cezar/store.sqlite runs/cezar $T an/first-cezar.jsonl; node $P/cezar.mjs
nice -n 10 node $P/content.mjs stores/squeal/store.sqlite an/first-squeal.jsonl $G an/content-squeal.jsonl   # question 2
nice -n 10 node $P/earlier.mjs stores/squeal/store.sqlite runs/squeal an/content-squeal.jsonl $G an/earlier-squeal.jsonl
nice -n 10 node $P/age.mjs stores/squeal/store.sqlite an/content-squeal.jsonl $G an/age-squeal.jsonl
node $P/classify.mjs an/content-squeal.jsonl an/earlier-squeal.jsonl an/age-squeal.jsonl                      # questions 2 and 4
# The same four with `every` as first.mjs's last argument: every baseline checkpoint (results/causes-every.txt).
nice -n 10 node $P/growth.mjs stores/squeal/store.sqlite runs/squeal an/growth-squeal.json; node $P/growth2.mjs an/content-squeal.jsonl
# Question 3: build nothing; copy the shipped bundle, then a clone per commit (the paths in the scripts assume S=/tmp/ms152).
cp -a ~/.claude/plugins/cache/hearsay/squeal/0.1.276 $S/bundle; cp $P/envrun.sh $P/mkclone.sh $S/; B=$S/bundle/dist/cli/squeal.mjs
$S/mkclone.sh c 69cb9f7ed; cd $S/clones/c; $S/envrun.sh node $B start $S/clones/c; $S/envrun.sh node $B status --wait 180000
$S/envrun.sh node $B stop $S/clones/c; cp .git/squeal/store.sqlite* $S/an/c/   # then compare test_file_keys with a host worktree at that commit
```

Rolling back a store copy for E3: remove the named paths from `test_files.closure_paths` and from `meta` `observed.` for the 54 files, then key clone a again (the command is in `results/experiments.txt`'s E3 text). Clean up: stop every clone daemon, then `rm -rf /tmp/ms152`.
