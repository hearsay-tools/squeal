# Probe: environment failures (throwaway)

Throwaway probe for `../../environment-failures.md` (board row 001-348). Not product code; delete freely.

`fixture/` is a tiny Vitest 5.0.3 project with two projects: `main` (one file per failure shape) and `gs` (a `globalSetup` that throws). `run.ts` drives Squeal's own Vitest adapter (`createVitestAdapter` from `src/runners/vitest`) over it and feeds the report through `recordsForFile` (`src/core/scheduler/records.ts`) with the real `describeFailure`, so its output is what Squeal would store. It also runs plain `vitest run` for the reporter's own wording.

Run from the worktree root, after `npm ci --ignore-scripts`, with a private HOME:

    HOME=$(mktemp -d) npx tsx docs/specifications/001-core-loop/research/probes/environment-failures/run.ts

Output from the run cited in the findings is in `output.txt`. Port 59321 on 127.0.0.1 is assumed closed (ECONNREFUSED); check with `ss -ltn` first. (Port 1 is not usable: undici refuses it as a "bad port" before connecting.)
