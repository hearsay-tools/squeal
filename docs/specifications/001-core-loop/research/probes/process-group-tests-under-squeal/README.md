# Probe: process-group-tests-under-squeal (throwaway)

Throwaway. Not product code. Research task 001-127, 2026-10-08. Findings: `../../process-group-tests-under-squeal.md`.

The probes ran against fresh clones of `cezar` under the task scratch, never the `c8580be4` worktree:

- `cezar` at `5974ec91` (the merge that brought S26 to S28) and `6b660859` (branch head, mock fixed), `npm ci --ignore-scripts`.
- `cezar-sq` at `5974ec91` plus one local commit that removes every test file except `packages/cezar/src/core/runner-shutdown-parity.test.ts`, so a daemon bootstrap runs one file.

Files:

- `run-cases.sh <clone> <label> <n>`: runs cursor S26 to S28 `n` times with `npx vitest run`, printing the launching shell's sid, pgid and tty. Run directly for "shell", under `setsid -w` for "detached session leader".
- `daemon-probe.sh <squeal.mjs> <cezar-sq> <n>`: a real daemon from this checkout's `plugins/claude-code/dist` (0.1.32), `n` forced runs with the fixed mock, then a declared `inputs` glob. Its step 1 did not wait for the bootstrap run, so its steps 1 and 2 do not isolate the mock edit; `daemon-probe-stays-current.sh` does.
- `daemon-probe-stays-current.sh <squeal.mjs> <cezar-sq> <store-query.mjs>`: bootstrap at the broken mock, wait for 3 known failures, replace only the mock, wait 60 s, compare Squeal's state with a plain `npx vitest run` on the same tree.
- `store-query.mjs <store.sqlite> <sql>`: `node:sqlite` with `readOnly: true`. Used on the `cezar` store (`/home/agent/projects/cezar/.git/squeal/store.sqlite`) with the coordinator's permission, and on the probe clone's own store.
- `logs/`: the output of every run quoted in the findings.
