# Probes for row 015-114, round 2: `squeal reach` 0.1.416 on squeal and cezar

Throwaway. Written 2026-11-07 for `lessons.md` "Edit reach, round 2". Nothing here is product code or maintained. Round 1's probes are one folder up; `strip-backslash.mjs`, `drop-closures.mjs`, `qc.mjs`, `runs.mjs` and `lookup.mjs` are used from there.

## Rules these probes keep

- The real stores, `~/projects/squeal` and `~/projects/cezar` were only read. Store copies were taken at 22:47Z with their `-wal` and `-shm`. Every write went to a copy inside a scratch clone.
- The candidate is `cand/0.1.416` (`2e996bd8b`): `git archive 2e996bd8b plugins/claude-code`, unbuilt, pinned in a copy. Its daemons ran at nice 10 under `baseline.onStart: lookup-only`. No test ran: each clone's store has 0 runs, 0 results and 0 revisions of its own worktree.
- Two scripts edit a store copy, and only a copy: round 1's `strip-backslash.mjs` (issue #166) and `drop-closures.mjs` (phase B only).
- The scratch folders (`/tmp/r114`, `/tmp/r114b`) were deleted at the end of the round.

## Files

| File | What it does |
|---|---|
| `tables.mjs <store>` | The import tables of 0.1.415 and 0.1.416 in a store, and its re-walk markers |
| `sample.mjs <store> <clone root> <out.jsonl> [max s]` | Once a second: load, CPU of the daemon's process tree (the pid is kept once seen with the store's folder as cwd, because the daemon changes folder while it walks), listed, keyed and pending test files, a digest of the keys (each new key list saved beside the output), walks stored at current keys, the re-walk marker, runs and results. Stops 5 s after the marker |
| `keycheck.mjs <store> <root> <keys file>...` | How many keys of each saved key list have a stored result, and how many closures the worktree wrote |
| `trust.mjs <store> <root>` | Each listed test file by closure owner (this worktree, another with the same key, another with another key) and by a walk at its current key: why the report leaves files out |
| `edits-of.mjs <store> <path>...` | The watch revisions that name a path, with or without a `HEAD` move |
| `edits-diff.mjs <older store> <newer store> <path>...` | Edits (readEdits' rule) in two copies, and those lost with removed worktrees |
| `aggregate.mjs` | Round 1's pooling, with `--block` reading 0.1.416's `test_file_imports` (deflated `[path, static, dynamic]` lists) |
| `sample-*-A.jsonl`, `start-*-A.txt` | The phase A series and the start and settle times with load |
| `report-*.txt` | Phase A (store as copied) and B (every closure walked) answers; `report-cezar-named.txt` (7 paths) and `report-squeal-named.txt` (3 paths, `--limit 3`) |
| `summary-*.json` | Top-level fields, proposals and the first 30 entries of each list of the `--json` answers |

## Re-running

```sh
R=/tmp/r114b; S=$R/cand/plugins/claude-code/dist/cli/squeal.mjs; mkdir -p $R/stores/{squeal,cezar} $R/cand $R/out
git -C <this repo> archive 2e996bd8b plugins/claude-code | tar -x -C $R/cand
for p in squeal cezar; do C=$(git -C ~/projects/$p rev-parse --path-format=absolute --git-common-dir)/squeal
  for f in store code lint; do [ -f $C/$f.sqlite ] && cp $C/$f.sqlite* $R/stores/$p/; done; cp $C/repository-id $R/stores/$p/; done
# clones at squeal e36b8d509 and cezar 5f7c94cf3, pnpm install --frozen-lockfile --offline, as in round 1
for p in squeal cezar; do mkdir -p <clone>/$p/.git/squeal && cp $R/stores/$p/* <clone>/$p/.git/squeal/; done
node ../strip-backslash.mjs <clone>/cezar/.git/squeal/store.sqlite
# phase A, per clone:
node sample.mjs <clone>/$p/.git/squeal/store.sqlite <clone>/$p $R/out/sample-$p.jsonl 900 &
SQUEAL_CLI=$S nice -n 10 node $S start <clone>/$p; node $S status --wait 900000   # then wait for the marker in the series
node trust.mjs <clone>/$p/.git/squeal/store.sqlite <clone>/$p; (cd <clone>/$p && node $S reach --json > $R/out/$p-A.json)
# phase B: stop, a fresh copy, ../drop-closures.mjs on it, start again, then the reports and named views
node $S stop <clone>/$p
```

## Known limits

- The load was 12 to 29 on 24 CPUs throughout, from the host's other work, so read times and CPU include contention.
- The CPU of the daemon's tree misses children that ended before a sample and were not reaped into the daemon's own counters.
- The clone commits are behind the stores' newest closures (squeal before wave 28). The start-up walk of phase A comes from that; a worktree at the newest commit would have walked less at start and more in the re-walk.
