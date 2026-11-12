# Probes of row 011-313 (throwaway)

Throwaway probes for `../../daemon-idle-cpu.md`. Not product code; nothing imports them. Keep profiles and store copies out of the repository.

- `threads.py SECONDS PID...`: per-thread CPU and reads from `/proc`, and the open `.sqlite` files. Read only. Note: the process line of `/proc/<pid>/io` includes reaped children.
- `cdp-profile.mjs PORT SECONDS OUT`: a CPU profile over the inspector of a daemon **you started** with `--inspect=127.0.0.1:PORT`.
- `cdp-profile-strict.mjs`: the same with `Profiler.enable`, `start` and `stop` only; used once, with the coordinator's permission, on a live daemon after `SIGUSR1`.
- `summarize.mjs FILE [TOP]`: self and inclusive shares of a `.cpuprofile`.
- `prune-probe.ts COPYROOT [PASSES]` (run with `node_modules/.bin/tsx` from the repository root): the hourly prune on **copies** of a project's stores (`COPYROOT/.git/squeal/`), timed per SQL statement with reads from `/proc/self/io`. It writes to the copies.
- `integrity-io.sh STORE_COPY`: the daily full check's `PRAGMA integrity_check(10)` at nice 10 on a copy, with its reads.
- `line-reader-bench.ts`: `LineReader.push` on one long line in 64 KB and 4 KB chunks.
