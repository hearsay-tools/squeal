# Probe: Vitest workers per CI shard (row 011-435)

**Throwaway.** Evidence for `../../ci-shard-workers.md`. Nothing here is product code or a test. It ran on boat.dev sandboxes only, on 2026-11-27, and never on the host.

## Files

- `setup.sh`: runs on a fresh sandbox. It installs what the Node 22 CI job installs (Node 22.19.0, pnpm 12.15.0, uv 0.12.2, Python 3.10 and 3.13). Then it clones the repository from a git bundle (HEAD `858a4edf1` plus the 283 `squeal--v*` tags shard 1 reads) and runs `pnpm install --frozen-lockfile`.
- `run.sh`: runs `node scripts/ci-shard.mjs --shard 1/6 $SHARD_ARGS` once per arm given, in order, with `CI=true` and `GITHUB_ACTIONS=true`. `SHARD_ARGS` is read from `.github/workflows/ci.yml`. Before each run it resets the machine to a fresh CI job: it deletes the Vitest results cache, empties `/tmp` except the e2e install cache that CI restores, kills stray processes and cleans the tree. Every 5 s it records the load, the shard's own Vitest fork workers and the free memory.
- `summarize.mjs`: prints the table and the per-arm and per-pair lines in the findings, from `data/`.
- `data/<sandbox>/<round>/<NN-arm>/`: one folder per run. `meta.json` holds the arm, start and end (epoch s), exit code, stray processes after the run, and dirty files. `samples.txt` holds the 5 s samples: time, load 1/5/15, workers, MemAvailable in MiB. `vitest-summary.log` holds the run's `FAIL |project|` lines and Vitest's final summary lines, cut from the full log to keep the repository small.

Arms: `W` is a warm-up with default workers that fills the e2e install cache; it is not counted. `D` uses Vitest's default workers (3 on 4 vCPUs). `2` sets `VITEST_MAX_WORKERS=2`; this arm is **flawed**, see the findings. `F` passes `--maxWorkers=2` on the command line: `run.sh` adds the flag to that run's copy of `scripts/ci-shard.mjs`, and the next run's checkout restores the file.

Rounds: `out-warm`, `out-s1`, `out-s2` and `out-s3` hold arms D and 2; `out-f1`, `out-f2` and `out-f3` hold arms D and F. Sandboxes: `bx_e3dm3pue` (s1) and `bx_35xz2nex` (s2) run at 4.29 GHz; `bx_v92nzzbr` (s3) runs at 3.79 GHz and takes about 2.2 times as long. All three are 4 vCPU and 8 GB, and `/proc/cpuinfo` names their CPU only as "AMD EPYC". All three are deleted.

## Rerun

```sh
git bundle create /tmp/push/repo.bundle HEAD --tags='squeal--v*'
id=$(boat new --type default --no-env --ttl 21600 --json | tail -1 | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).id')
boat push $id /tmp/push --to /home/user/push; boat push $id <copy of this folder> --to /home/user/probe
boat ssh $id -- 'bash /home/user/probe/setup.sh <commit>'
boat ssh $id -- 'cd /home/user && setsid nohup bash probe/run.sh /home/user/out W F D D F F D > out.log 2>&1 < /dev/null &'
# when /home/user/out/done exists: fetch out/, then
node summarize.mjs data
```
