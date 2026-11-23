# Probes for `boat-sandboxes` (throwaway)

Throwaway scripts of the 026 research topic `boat-sandboxes` (`../../boat-sandboxes.md`). Not product code, not maintained. Run on 2026-11-23 against Squeal at `1bbd7b4c5` (0.1.611), boat CLI 1.0.103.

| File | What it does |
|---|---|
| `setup-node.sh` | Installs Node 26.13.0 on a sandbox and puts it first on the non-interactive `PATH`; enables corepack. |
| `dsync.sh` | 200 writes of 4 KiB with `oflag=dsync` in `/tmp` and the home (021 `boat-trial.md` D5), I/O pressure, `ascii-lazyfs`, and the virtual disk's flush count and time from `/proc/diskstats`. |
| `dsync-monitor.sh` | The same write test every 30 s on a sandbox, detached. |
| `run-tests.sh` | Vitest over a set: `capacity` (first 10 of `test/capacity`, 021 set A), `unit` (021 set B), `git` (three files that failed in 021 D2). |
| `mem.sh` | Memory in use before and at its peak while Vitest runs `test/scheduler` at 4 workers. |
| `sshargs.sh` | Prints the ssh arguments `boat ssh` uses, plus a ControlMaster socket, so a driver keeps one connection. |
| `driver.mjs` | Drives `squeal runner-host --tree` (spec 021 D6) over that connection: edit rides on `invalidate`, then `affected`, `closure`, blob proof, `run`. Also a node:test mode. |
| `delta.sh` | A 10-file delta sent as tar.gz and as a diff through `git apply`, over a kept connection. |
| `results/` | Raw output. `other.txt` holds the numbers read off the terminal. |

Every sandbox was made with `--no-env` and deleted at the end.
