# Probes for research 016-06 (third-party trust)

Throwaway. Nothing here is product code or a test; delete it when spec 016 no longer needs the evidence. Run on 2026-10-24, Linux 6.8.0-147-generic (Ubuntu), Node 24, Python 3.12.3, gcc. No timings: the host is loaded.

Each script builds in a fresh `/tmp` scratch directory with its own `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and `TMPDIR`, starts no daemon, opens no store, and removes the scratch directory at the end (the last line of each output says so).

## `run.sh <worktree root>`: who sees a check provider's reads (Q3)

`fake.test.cjs` stands in for a test file whose checks shell out. It reads `data-node.txt` in Node, then starts: Python reading `data-py.txt` from a `-c` string; a dynamically linked C reader (`reader.c`) with `data-dyn.txt` as its argument; the same reader statically linked with `data-static.txt` as its argument; the static reader again, with its path in `$PROBE_DATA` (`data-env.txt`); and `sh -c "cat data-sh.txt"`.

- A runs it under Squeal's own recorder (`src/runners/observe/*.cjs` copied at HEAD 0822a4440), as a `--require` with `SQUEAL_OBSERVE`, as C12 delivers it.
- B runs it under `strace -f` (ptrace), with no recorder.
- C runs the two C readers under `shim.c`, an `LD_PRELOAD` tracer that interposes libc's `open`, `open64` and `openat`.

Result (`output.txt`):

| Data file | Read by | A: Squeal recorder | B: strace | C: LD_PRELOAD |
|---|---|---|---|---|
| data-node.txt | Node `fs` | seen | seen | n/a |
| data-dyn.txt | dynamic C, path in argv | seen (argv names it) | seen | seen |
| data-static.txt | static C, path in argv | seen (argv names it) | seen | missed |
| data-env.txt | static C, path in env | missed | seen | n/a |
| data-py.txt | Python, path in code | missed | seen | n/a |
| data-sh.txt | `cat` under `sh -c` | missed | seen | n/a |

The recorder lists `data-dyn.txt` and `data-static.txt` only because C12 records "the existing files a spawn's arguments name", not because it saw the read: the same binary reading a path from its environment goes unrecorded.

## `sandbox.sh`: which unprivileged sandboxes this host allows (Q2, Q5)

- `unshare --user --map-root-user`: the user namespace Bazel's `linux-sandbox` and bubblewrap need. Refused here (`apparmor_restrict_unprivileged_userns=1`).
- `landlock.c`: a Landlock ruleset that allows reads only under the scratch worktree and system directories, then `exec`s `sh`. Landlock ABI 4; the read inside succeeds, the read of a sibling directory fails with "Permission denied". No root, no namespace.

Result: `sandbox-output.txt`.
