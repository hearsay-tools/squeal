# Throwaway issue-146 probes

These scripts are research fixtures, not product tests. They change no product code.

`probe.mjs` creates a separate Git repository under the process temp directory,
links this checkout's existing `node_modules`, and generates 12 explicit test
files. It runs a direct Vitest control, a pinned Squeal baseline and a comment-only
edit. Each live phase checks one-minute load against the CPU count and refuses
to start when load is higher. It stops only the daemon it started. The temp
fixture is retained for inspection; its path is in `output.txt`. No dependencies,
SQLite stores or generated test files are committed here.

Run from the repository root, with a compatible existing dependency installation:

```sh
node docs/specifications/011-core/research/probes/issue-146/probe.mjs /absolute/versioned/dist/cli/squeal.mjs
pnpm exec tsx docs/specifications/011-core/research/probes/issue-146/grants.mts /fixture/root/from/first/output
```

`grants.mts` runs the source adapter with explicit grants 1 and 4 on the same
warm instance after the daemon has stopped. Both scripts bound individual runs.
The saved transcript uses Squeal 0.1.390 for the daemon and checkout 0.1.401 for
the adapter. Both use Vitest 5.0.3 and Node 24.22.1.

`output/` holds file events, current-result status, direct-control output, daemon
shutdown and complete run reports. `grants-output.txt` holds explicit grants and
whole-file timings. `source-evidence.txt` pins the relevant implementation;
`issue.json` preserves the reporter's claims separately. The top-level findings
state the limits of both experiments.

Repository verification: `node --check` passed for `probe.mjs`; both probe
commands completed with exit 0. The absolute Squeal launcher ran
`status --wait 60000` for `issue-146.md`, `probe.mjs` and `grants.mts` at revision
14. It returned exit 3, "No verdict: no test file's closure holds" those paths,
with known failures 0 and all 1,448 test files current. These research files
have no affected product tests. Their executed probes supply the task's
verification. `git diff --check` passed. No full suite or build ran.
