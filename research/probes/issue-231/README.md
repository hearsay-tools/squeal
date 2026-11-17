# Issue 231 throwaway probes

These are research probes, not product tests. Run from the repository root:

```sh
pnpm exec tsx research/probes/issue-231/probe.ts
```

The probe refuses live work when one-minute load exceeds available CPUs. It
creates two tiny repositories under the system temporary directory and removes
them in `finally`. It opens only their stores. It changes no existing worktree,
starts no daemon, installs no packages and runs no repository test suite.
No `node_modules` or generated database belongs in git.

The first repository calls the real store API with a synthetic clock. It checks
the seven-day cutoff, live-key and main-result protection, and replacement at
one check/key. The second calls the real `codeGateCommand` with
`--base main --json --timeout 15`, using one node:test file. It checks a pass,
stored reuse, then an expected test failure (`incomplete`, exit 3). Only selected
report fields and SQL counts go to stdout, with no temporary paths or logs.
The CLI process wrapper and a serving daemon are outside this probe.

Observed on checkout `b0da5d149d445ea92c8517497141a7ed6dbbcc96`, Squeal
0.1.543, Node 26.13.0, SQLite 3.54.0, pnpm 12.15.0, load 7.83 / 24 CPUs:

```text
prune at cutoff: 2 removed; boundary, recent, live-key, main-newest kept
prune 1 ms later: 1 removed; recent, live-key, main-newest kept
same-key rewrite: one row; previous run provenance replaced
first pass: exit 0, pass, 400 ms; checkpoints=0, runs=0, results=2, joined=0
same bytes: exit 0, pass, 148 ms; from=store; same database counts
failed test: exit 3, incomplete, 388 ms; checkpoints=0, runs=1, results=4, joined=0
PASS: isolated prune, replacement, pass/reuse/failure gate probes
```

The failed test's run row has start/end, `end_state=completed` and
`checkpoint_id=NULL`. All four result rows have a `gate-` run id, but none
matches that log run. Timings are one observation, not a benchmark.
