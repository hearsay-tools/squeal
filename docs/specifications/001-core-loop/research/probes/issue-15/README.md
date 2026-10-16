# Throwaway probe: issue 15

**Throwaway.** Nothing here is product code. These scripts exist only to produce the evidence in `../../issue-15.md`. Delete them freely.

- `run.sh [cli]`: builds a git repository in a fresh `/tmp/squeal-issue15-*` with worktrees `wt-a`, `wt-b`, `wt-c` of one failing Vitest file. Each run's error carries its daemon's `TMPDIR` and a `mkdtemp` suffix (`cez-cursor-package-XXXXXX`, as in the issue). It runs the real daemons and CLI with a scratch `HOME` and `XDG_*` and no session variables, saves `why --json` after each step, then stops the daemons. It does not delete the fixture. Vitest 5.0.3 and Vite 8.3.2 come from the e2e harness's install cache (`VITEST_CACHE`, default `/tmp/squeal-e2e-cache/vitest-5.0.3-vite-8.3.2-node24-linux-x64`). `EDITS=n` sets how many foreign keys `wt-c` writes (default 21). `OUT_DIR` sets the output directory.
- `summarize.mjs <out>`: one block per saved `why --json`.
- `rows.mjs <store.sqlite> [marker]`: the stored `results` rows of the test check, read-only, plus the `failure-producers` meta, the runs with no stored result and the failure texts carrying A's marker.
- `out/`: default run (21 edits) with this worktree's committed bundle, 0.1.200. `out-0.1.199/`: the same with the released 0.1.199 bundle, copied to `/tmp` first. `out-six/`: `EDITS=5`, the issue's shape (six results).

Steps: (1) A runs, fails at key K. (2) C edits the file `EDITS` times, each a new key and a newer failure. (3) B, whose bytes equal A's, runs at K and its failure replaces A's row.

Reproduce:

```
docs/specifications/001-core-loop/research/probes/issue-15/run.sh
EDITS=5 OUT_DIR=$PWD/out-six docs/specifications/001-core-loop/research/probes/issue-15/run.sh
```

Each run takes about 25 s. Paths, run ids and keys differ per run. The facts in `summary.txt` do not.
