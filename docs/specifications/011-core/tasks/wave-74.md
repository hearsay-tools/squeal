# Wave 74: row 011-313 (what a daemon does with a core while no test runs)

Coordinator 4f261dae, 2026-11-12. The human took the row: "Grab host-cpu-daemon-profile". Research only: no product change in this wave.

Host policy, as in `wave-73.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; never make CPU load on purpose; no real harness session under the real HOME. Not yours: the board, `status.md`, the spec, `src/`, `plugins/*/dist`, the `package.json` version.

## W1: row 011-313

Use /researcher. Shape: research.

Outcome: a research file that names what a Squeal daemon's main thread does with a core while no test runs, and which database file and code path make its 4 KB reads.

Read: board row 011-313; the overnight report of task 69b56ae6 at `/home/agent/projects/squeal/.ai/cezar/runs/69b56ae6-ed1a-4721-b402-d349e9288bcb-artifacts/633c4930-f26a-46e9-b602-2b8a346d6188/content` (HTML); `research/probes/host-load/README.md` and `sample-trees.py`; the daemon's idle loops (heartbeat, watchers, baseline and catch-up scans, store maintenance) from `src/core/daemon/`, `src/core/daemon-loop/`, `src/core/watcher/` and `src/core/store/`.

Lead: start without touching any process. Find a daemon near one core with `squeal ps` and `/proc`; per thread, read `/proc/<pid>/task/<tid>/stat` (CPU, thread name) and `/proc/<pid>/task/<tid>/io` (read bytes and calls), and map open databases with `/proc/<pid>/fd`. Then take a CPU profile (`node --cpu-prof`, or the inspector) of a daemon **you start** in your own worktree, after `squeal stop` there; a copy of a large store under your scratch directory is allowed when the effect needs store size, deleted afterwards. ptrace and perf are not allowed on this host. Do not signal, attach to, stop or restart a daemon you did not start, including one in another project (cezar): ask me first.

Owns: `docs/specifications/011-core/research/daemon-idle-cpu.md` and `research/probes/daemon-idle-cpu/`. Keep profiles and store copies out of the repository.

Done when: the research file gives the profile's top main-thread functions with their share of samples, the database and query or code path behind the 4 KB reads with the evidence for it, whether the cost appears with no session and with a session but no test, the host load during each measurement, and a proposed row with a done-when if a fix is warranted; committed on your branch.
