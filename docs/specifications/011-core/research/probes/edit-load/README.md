# Probes for 011-143: what one edit costs the machine

Throwaway. Written for `research/edit-load.md`, 2026-10-23. Nothing here is product code, and nothing here is maintained.

## Rules these probes keep

- Every repository is a `git clone` under `/tmp/el143` (never `git worktree add`). Dependencies are copied from an installed checkout at the same commit (`cp -a node_modules`, and toolkit's `.venv`), never fetched.
- Every command runs through `env.sh`: `env -i` with `HOME`, `XDG_*` (`XDG_RUNTIME_DIR` too, so the permit pool and daemon sockets are private), `TMPDIR`, npm, pnpm, corepack and uv homes under `/tmp/el143`. `PLUGIN_ROOT` and `PLUGIN_DATA` are never set.
- Squeal is the squeal clone's committed `plugins/claude-code/dist/cli/squeal.mjs` at `800cb629d` (0.1.274). No build.
- A store is read only from a copy (`store.sqlite` with its `-wal` and `-shm`). Run logs (`report.json`) are read in place, read only.
- Every probe runs at nice 10 in its own systemd user scope, pinned with `taskset` to 4 CPUs (question 4: 8 CPUs, by the coordinator's reply of 2026-10-23), with at most 4 Vitest workers where the probe sets the count.

## Files

| File | Measures | Question |
|---|---|---|
| `env.sh` | the isolated environment | all |
| `cgrun.sh <unit> <cpus\|-> <cmd>` | one command's CPU: the scope's `cpu.stat`, which keeps the time of every exited child | 1 (baselines) |
| `edit.sh <clone> <unit> <file> <label> [comment]` | one edit: appends a comment line, samples `squeal status --json` every 2 s until three idle samples, logs the scope's CPU and the daemon's own (`/proc/<pid>/stat`) | 1, 5 |
| `editsum.sh x <label>...` | one line per edit: wall to idle, CPU, daemon CPU, tests CPU, load | 1 |
| `runsum.cjs <store copy> <t0 ms> [t1 ms]` | runs, files and summed `fileDurations` of a probe daemon's runs in a window | 1 |
| `burst.sh <clone> <unit> <label> <cpus> <paths>` | 20 edits 30 s apart; every 5 s the scope's CPU, host load, the pinned CPUs' busy share (`/proc/stat`) and runnable threads last on them | 4 |
| `work.mjs <store copy> - <hours> [tierSize] [slow regex]` | a host store's test work in file-seconds, split by cause and by whether it stored a result | 2 |
| `fanin.cjs`, `cost.cjs` | how many stored closures hold a path; the files and recorded seconds an edit of a path re-keys | 1 |
| `cand.cjs <store copy> <out.tsv>` | real agent edits (watch revisions of 1 to 3 paths) with their old and new blob ids | 3, 4 |
| `cov-setup.ts`, `cov.config.ts` | per-test-file V8 block coverage: a setup file that starts precise coverage before the test file loads and writes it with each transformed script's source in `afterAll` | 3 |
| `cov-lines.mjs <dir> <root> <out> <trace-mapping>` | executed source lines per test file, through each script's inline source map | 3 |
| `reach.py` | per real edit: re-keyed files, whether each executed a changed line, and the edit's true result (transitions) | 3 |
| `exports.py` | per real source edit: re-keyed files that import a changed export, the module only, or not the module | 3 |
| `reach-summary.py <reach.json> <checkout>` | `reach.py` per revision, by edit class, and the new failures in files coverage did not reach | 3 |
| `cells.py <store copy> <checkout> <slow regex> <path>...` | per edit cell from warm closures: re-keyed files, recorded seconds, slow part, static importers (type-only imports included) | 1 |
| `alpha.cjs <probe store> <host store> <t0 ms>` | recorded host seconds of the files a probe's runs held, for CPU per recorded second | 0 |
| `nicesample.py <seconds>` | niced CPU on the host, split by whether a process's environment names `SQUEAL_OBSERVE` (names only, never values) | 0 |
| `burst-sum.cjs <burst log> <probe store copy> <cpus>` | a burst's CPU share of the pinned CPUs, loads, and each edit's time to its first result | 4 |
| `tk-chain.sh` | toolkit's second pass: daemon, `run --all`, four edits | 1 |

## Re-running each measurement

```sh
S=/tmp/el143; P=<this folder>
mkdir -p $S/{home,run,tmp,logs,an} $S/xdg/{config,cache,data,state}; chmod 700 $S/run; cp $P/*.sh $S/
git clone ~/projects/squeal $S/squeal-q1 && git -C $S/squeal-q1 checkout 800cb629d   # then cp -a node_modules
# a daemon per clone, lookup-only so nothing runs until an edit (add "baseline": {"onStart": "lookup-only"})
systemd-run --user --scope --unit el143-q1sq taskset -c 16-19 nice -n 10 $S/env.sh node $S/squeal-q1/plugins/claude-code/dist/cli/squeal.mjs start
# question 1: one edit per class, then its summary
$S/edit.sh $S/squeal-q1 el143-q1sq src/core/ps/model.ts sq-leaf && sh $P/editsum.sh x sq-leaf
# question 1 baselines: the edited test file alone, and vitest related for a source
$S/cgrun.sh el143-b2 16-19 $S/env.sh npx vitest related src/core/ps/model.ts --run --maxWorkers=4
# question 2: copy the store first, then split its last 72 hours
cp ~/projects/squeal/.git/squeal/store.sqlite* $S/stores/squeal/ && node work.mjs $S/stores/squeal/store.sqlite - 72 4
# question 3: whole suite with per-file coverage (4 workers), lines, reach, exports
(cd $S/squeal && cp $P/cov-setup.ts el143-cov-setup.ts && cp $P/cov.config.ts el143-cov.config.ts && \
  $S/cgrun.sh el143-sq-cov - $S/env.sh EL143_COV_OUT=$S/cov/squeal EL143_ROOT=$S/squeal npx vitest run --config el143-cov.config.ts --maxWorkers=4 --reporter=json --outputFile=$S/logs/sq-cov.json)
node cov-lines.mjs $S/cov/squeal $S/squeal $S/an/sq-lines.jsonl $S/squeal/node_modules/@jridgewell/trace-mapping
node cand.cjs $S/stores/squeal/store.sqlite $S/an/sq-cand.tsv   # keep rows whose two blobs exist: git cat-file --batch-check
python3 -I reach.py $S/stores/squeal/store.sqlite $S/an/sq-ok.tsv $S/an/sq-lines.jsonl ~/projects/squeal/.git $S/squeal $S/an/reach.json
python3 -I exports.py $S/an/reach.json $S/an/sq-ok.tsv ~/projects/squeal/.git $S/squeal $S/an/exports.json $S/stores/squeal/store.sqlite
# question 4: restart the clone's daemon pinned to 8 CPUs with default capacity, then the burst
systemd-run --user --scope --unit el143-q4sq taskset -c 0-7 nice -n 10 $S/env.sh node .../squeal.mjs start
$S/burst.sh $S/squeal-q1 el143-q4sq sq 0-7 $S/an/burst-sq.txt
```

Clean up: `squeal stop` in each clone through `env.sh`, `systemctl --user stop 'el143-*.scope'`, then `rm -rf /tmp/el143`.

Done on 2026-10-23 at 12:33Z: every probe daemon stopped, `systemctl --user list-units --all 'el143-*'` lists 0 units, `pgrep -af el143` finds no process, and `/tmp/el143` (clones, store copies, logs) is removed.
