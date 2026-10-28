# Issue 117 throwaway probe

This is research, not a product regression test. It runs the current source scheduler,
real Vitest adapter, and SQLite state sink through the existing scheduler harness.
The harness serializes adapter calls so a controlled run can delay inventory refresh.
Two tiny tracked tests live in a disposable Git repository under `.scratch/`.
No installed daemon or existing repository hold is changed.

From the repository root, first check `cat /proc/loadavg` and
`getconf _NPROCESSORS_ONLN`. Do not run if one-minute load exceeds CPU count.
The probe also checks load before each case.

```sh
pnpm exec vitest run --config docs/specifications/011-core/research/probes/issue-117/vitest.config.ts docs/specifications/011-core/research/probes/issue-117/probe.test.ts
```

The default repository Vitest config does not include this path. The probe writes
state observations to `evidence.jsonl` because the nested adapter captures console
output. It appends on a later run. The committed evidence contains one instrumented
run, two cases. `result.txt` holds its command output. The earlier run of the same
cases also passed, before observations were written to a file.

The harness closes its scheduler, adapter, and store after each case. After the
command ends, remove only this probe's `.scratch/fixture-*` directories. The initial
research run removed them with Python `shutil.rmtree` and then removed the empty
`.scratch` directory. They and any nested `node_modules` are not committed.

Case 1 holds A, commits deletion of B, and submits B's deletion batch. Case 2 holds
B after selection, commits its deletion, and submits the deletion batch. Each starts
with a current pass for B's test and file check, samples the pending state, releases
the run, and asserts no failure transition and no remaining B key or known state.
This does not exercise a real daemon, merge, multi-project inventory, Vitest 4,
failed listing, or an inventory call that exceeds its timeout.
