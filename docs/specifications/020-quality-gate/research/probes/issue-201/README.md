# Issue 201 probes (throwaway)

These probes are research evidence, not product tests. They create temporary
repositories and stores and remove them afterward. No shared live store or
daemon is controlled. `node_modules` is not part of the probe.

`gate-lock.probe.ts` adapts issue 192's CLI fixture. It runs five node:test
files through the current source CLI, records report and return times, and
checks reuse on a second run. Cases: no lock, a child process holding
`BEGIN IMMEDIATE` past the default 30 s bound, and release after 3 s.

`served.probe.ts` uses the existing keeper test kit: real socket handlers,
`DaemonWrites` and `keepInDaemon`, but no full daemon lifecycle or test runner.
It sets a 600 ms keeper bound to show that daemon routing retains bounded
loss. Its completed file records and input hashes are synthetic.

Run only this research directory (the repository daemon does not run these
`.probe.ts` files):

```sh
ISSUE201_OUT=/tmp/issue-201-evidence.txt pnpm exec vitest run \
  --config docs/specifications/020-quality-gate/research/probes/issue-201/vitest.config.ts
```

Do not interpret a bare lock holder as proof of the issue's exact two-daemon
handover. See `../../issue-201.md` for versions, results and limits.

The recorded run had two assertion-shape failures (`from` is a map). The
committed assertions correct them, but host load exceeded the CPU count afterward,
so the live probes were not rerun. `verify-evidence.mjs` checks the saved results
without opening stores or running tests; it passed. Keep this distinction when
quoting the original failed-run log.
