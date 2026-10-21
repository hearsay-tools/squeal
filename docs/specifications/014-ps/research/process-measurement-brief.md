# Research brief 014-02: measuring the processes and the host

Use /researcher. Shape: research. Outcome: how `squeal ps` measures CPU and memory of each daemon and each test process, ties each test process to its daemon, lane and test file, and states the host totals, at a cost one snapshot can afford. Follow the rules in `README.md`.

Read first: 011 C10 Capacity (slots, permits, the Priority bullet: nice 10, lane marks, `/proc/<daemon>/task/*/children`, the orphan scan), C13 (the leftover scan); `src/core/capacity/{marks,pool,share}.ts`; `src/core/daemon/{low-priority,leftovers,escaped,terminate,node-test-runners,pytest-runners}.ts`; the Vitest pool setup under `src/runners/`; `../../001-core-loop/research/process-group-tests-under-squeal.md` and `host-capacity.md`.

Questions:

1. **CPU.** Instant CPU from two `/proc/<pid>/stat` samples against the lifetime average: which interval (0.5, 1, 2 s) gives a stable number? Vitest's `threads` pool runs inside the daemon: can its threads be told apart (`task/<tid>`)?
2. **Memory.** RSS, PSS (`smaps_rollup`) and USS for a daemon and for fork workers that share pages: what to show per process, and what to sum so a total counts nothing twice. What can be told from outside about a 1 to 2 GB daemon (heap, native, file)? No heap snapshot of a live daemon.
3. **Attribution.** For each test process: its daemon, lane, runner, test files where knowable (command line, `environ`, the mark), its descendants (a test's servers or browsers) and their totals, nice and ionice. What can be read from outside, and what only the daemon knows?
4. **Host.** Load averages, `/proc/pressure/{cpu,memory}`, available memory, swap, the CPU count the pool uses (cgroup limits). How to state Squeal's share. macOS equivalents.
5. **Cost.** Wall time and CPU of a full snapshot at today's host, and which reads to run in parallel.

Own `process-measurement.md` and `probes/process-measurement/`.
