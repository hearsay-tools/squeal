# Probes for 011-223: inherited counts at registration

Throwaway. Written for `research/fresh-start-counts.md`, 2026-10-25. Nothing here is product code, and nothing here is maintained.

## Rules these probes keep

- Store copies only: `store.sqlite` with `-wal` and `-shm` of squeal and cezar, copied at 2026-10-25 20:59:01Z (epoch ms 1792961941772). No live store, socket or permit pool is opened. The git object stores and reflogs of `~/projects/squeal` and `~/projects/cezar` are read with `git ls-tree` and plain file reads only.
- Experiments run Squeal daemons in clones under `/tmp/fsc223/clones`, made with `git clone --no-local`, never `git worktree add`. `envrun.sh` starts every command with `env -i`, `HOME`, `XDG_*`, `TMPDIR`, `CODEX_HOME` and the npm, pnpm and corepack homes under `/tmp/fsc223`, at nice 10. `PLUGIN_ROOT`, `PLUGIN_DATA` and every `SQUEAL_*` variable are unset. `XDG_RUNTIME_DIR` under `/tmp` gives the daemons their own sockets and permit pool.
- Both repositories' `squeal.config.json` already set `baseline.onStart` to `lookup-only`, so no clone daemon ran a test.
- `series.sh` starts each timed run only when the one-minute load is at or below 24 on 24 CPUs and logs how long it waited.
- Every daemon was stopped with `squeal stop`; `/tmp/fsc223` was removed after the commit.

## Files

| File | Measures | Question |
|---|---|---|
| `starts.mjs <store copy> <copy ms> [hours]` | per live worktree registered in the window: hook to daemon (only where a `liveness-told` start time survives), daemon to first baseline checkpoint (the listing and lookup done), misses, keys | 1 |
| `patch.mjs <squeal.mjs> <out.mjs> <log>` | a copy of the shipped 0.1.321 bundle that appends one line per start step (process start, integrity check, registration, scan, environments, listing, closures, lookups, commit) to a log | 1, 4 |
| `envrun.sh`, `mkclone.sh <name> <repo> <commit> <store dir>` | the isolated environment; a clone with its install and a plain copy (not vacuumed, so the same page count) of the store copy, daemon columns cleared | 1, 2 |
| `runstart.sh <clone> <store dir> <label>`, `series.sh` | one fresh start: a fresh store copy, `squeal start`, poll `squeal status` until listed, `squeal stop`, keep the clone's keys as `keys-<label>.json` | 1, 2 |
| `steps.mjs <steps.log>` | the per-run table of seconds from `squeal start` to each step | 1, 4 |
| `integrity.mjs <store copy>` | wall and CPU ms of `PRAGMA integrity_check` (what every daemon start runs) and `PRAGMA quick_check` on a store copy | 1, 4 |
| `same-content.mjs <store copy> <git dir> <copy ms>` | per live worktree start: whether another worktree had listed at the same commit, or at a commit with equal test-relevant content, before it | 3 |
| `results/*.txt` | the outputs the research file quotes | all |

## Re-running

```sh
S=/tmp/fsc223; P=<this folder>; mkdir -p $S/{stores/{squeal,cezar},home,xdg,config,cache,data,state,tmp,clones,an}; chmod 700 $S/xdg
for r in squeal cezar; do cp ~/projects/$r/.git/squeal/store.sqlite* $S/stores/$r/; done; T=$(date +%s%3N)
cp $P/*.sh $S/; cd $S
node $P/starts.mjs stores/squeal/store.sqlite $T; node $P/starts.mjs stores/cezar/store.sqlite $T          # question 1, history
nice -n 10 node $P/integrity.mjs stores/squeal/store.sqlite 1                                              # questions 1 and 4
V=0.1.321; cp -a ~/.claude/plugins/cache/hearsay/squeal/$V $S/bundle; mv $S/bundle/dist/cli/squeal.mjs $S/bundle/dist/cli/squeal.orig.mjs
node $P/patch.mjs $S/bundle/dist/cli/squeal.orig.mjs $S/bundle/dist/cli/squeal.mjs $S/an/steps.log
./mkclone.sh a ~/projects/squeal <commit> stores/squeal; ./mkclone.sh b ~/projects/squeal <commit> stores/squeal
./mkclone.sh c ~/projects/cezar <commit> stores/cezar;   ./mkclone.sh d ~/projects/cezar <commit> stores/cezar
./series.sh a:stores/squeal:sq-a1 b:stores/squeal:sq-b1 c:stores/cezar:cz-c1 d:stores/cezar:cz-d1             # questions 1 and 2
node $P/steps.mjs an/steps.log
# Question 2: compare an/keys-*.json between the two clones and with a host worktree's test_file_keys at the same commit.
node $P/same-content.mjs stores/squeal/store.sqlite ~/projects/squeal/.git $T                              # question 3
node $P/same-content.mjs stores/cezar/store.sqlite ~/projects/cezar/.git $T
# Clean up: squeal stop in each clone (series does it), then rm -rf /tmp/fsc223.
```

This run used squeal at `c696096a9` (the commit two host worktrees, 26a6ad36 and 017527fd, started at) and cezar at `fe61be8c4` (origin/main at the copy).

The cezar starts (`cz-c1`, `cz-d1`) never ran: `series.sh` waited from 21:20Z for a load at or below 24, the load stayed at 36 to 63, and the script was stopped at 22:38Z. `results/steps.txt` therefore holds the two squeal starts only.
