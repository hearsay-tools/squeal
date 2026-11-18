# Throwaway issue-243 probe

Run from the repository root:

```sh
cat /proc/loadavg
nproc
pnpm exec tsx docs/specifications/019-run-triggers/research/probes/issue-243/moment.ts
```

This calls the actual moment predicate with a synthetic store and six hours of
simulated time. It starts no daemon, runner, test suite or child agent. It checks
the pause condition only; it does not reproduce the reporter's full workload.
