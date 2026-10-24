# Probe: gh-92 load retry gate (throwaway)

Throwaway. Not part of the suite: the root `vitest.config.ts` includes only `test/**` and `src/**`.
Host load is mocked through `SchedulerOptions.hostLoad` on 24 CPUs; nothing loads the host.

Run from the worktree root, after checking `cat /proc/loadavg` is below `nproc`:

    npx vitest run --config docs/specifications/011-core/research/probes/issue-92/vitest.config.ts

Outputs of the recorded run are in `run-output.txt`.
