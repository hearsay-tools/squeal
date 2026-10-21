# Probes for research 011-53 (a quiet daemon's memory)

Throwaway. Not product code, not tests. Everything ran in a scratch `/tmp/dm-XXXXXX` with its own `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` and `TMPDIR`, on a shallow `git clone` of cezar (never a worktree of the live repository) and a copy of the installed Squeal 0.1.236 bundle. No live daemon's socket or store was opened, and no live process was signalled or reniced. The scratch was removed at the end. Run Python with `-I`.

| File | What it does |
|---|---|
| `setup.sh` | Makes the scratch: clone, bundle copy, `pnpm install --offline` from the host's store (files copied, not hardlinked), pool capped at 4 slots (`capacity.hostSlots`), slow lane off (`slow` removed, `vitest.exclude: packages/web/e2e/**`), `daemon.idleExitMinutes: 240`. |
| `env.sh` | The isolated environment, `sq` (the copied CLI), `start_daemon`, `ctl` (a command to the inside probe) and `edit_and_wait` (append a comment, time to `squeal status --wait`). |
| `inside.mjs` | Loaded with `--import` into the daemon only. Logs `process.memoryUsage()`, `v8.getHeapStatistics()`, the heap spaces and `/proc/self/status` every 15 s; runs a full GC (`gc({type:"major",execution:"sync"})`) on a control file. No product change. |
| `outside.py` | Reads `/proc/<pid>/status` and `smaps` of the research's own daemon every 5 s: private memory, swap, the 256 KiB heap mappings, `[anon:mimalloc]`, `[heap]` (glibc), other anonymous memory, and the descendants' private memory. |
| `run-daemon.sh` | The protocol of run 3: baseline, three edit tiers, a GC after the first, 30 min of quiet, a GC, three warm edits, three cold edits (a touch of a source file the instance read replaces the instance at the next call, task 013-02). |
| `close-reopen.mjs` | Question 3 without a daemon: one Vitest instance with the adapter's options at 4 workers; the keying walk; warm edits; `close()` and GC; cold edits on a new instance each. |
| `leak-check.mjs` | Counts live `Vitest`, `TestProject` and module-graph objects (`v8.queryObjects`) after each close-and-GC cycle. |
| `listeners.mjs` | Do process listeners grow over create-and-close cycles. |
| `snapshot.mjs`, `retainers.py` | A heap snapshot after two closed instances, and the shortest strong retainer path from the GC roots to each `Vitest`. |
| `last-resort.mjs` | One cezar-size instance: a regular GC, then `gc({flavor:"last-resort"})`, then `close()` and the same GC. |
| `exit-cost.sh` | Stop, then start as a hook would and edit: `edit-first` (edit at once) or `after-baseline`. |
| `estimate.py` | Question 4's arithmetic over 011-52's `snapshot-1.json`. |
| `show.py` | Prints an inside log's marks. |
| `v8-ns*.cjs`, `v8-flavor.cjs` | Bare Node: does V8 give freed heap pages back after a GC, under which flags, and with the `last-resort` flavor. |
| `logs/` | The outputs, named below. |

Runs (`logs/`):

- `run1-*`: the first daemon (11:42Z to 12:06Z). Its first edit (`model-identity.ts`) queued 235 files; the 200-file tier hit the 600 s run timeout at load 38 to 80. One GC after it. Stopped early.
- `run2-*`: aborted after its baseline re-queued run 1's stale files; kept only for its inside log. Its `outside` sampler watched a wrapping shell, not the daemon (fixed in `env.sh` since).
- `run3-*`: the protocol of `run-daemon.sh` on an empty store (12:42Z to 13:18Z). `run3-outside-node.tsv` samples the node pid; the script's own sampler watched the wrapping shell (same bug) and is left out. `run3-marks.txt` prints the inside log's marks. The cold phase was stopped after its first touch queued 235 files.
- `close-reopen.jsonl`, `leak-check.jsonl`, `retainers.txt`, `last-resort.jsonl`, `last-resort-mimalloc-purge0.jsonl`: on a copy of the clone, so the daemon did not see their edits.
- `exit-cost-edit-first.txt` and `-status-*.txt`: three restarts with the edit at once. The `after-baseline` mode never reached its baseline (the 230 queued files ran first) and has no log.
- `v8-release.txt`, `v8-flavor.txt`: bare Node under several V8 flags.
- `estimate.txt`: `estimate.py`.

Clean-up: `sq stop` at 13:35Z, then `rm -rf /tmp/dm-py5IK4`; afterwards `ls -d /tmp/dm-*` found nothing and no process named the scratch. The daemon removes its own temp directory under `/tmp/squeal-<uid>/tmp/` at its stop (`scratch.ts`, `removeScratch`); that one was not checked by its key.
