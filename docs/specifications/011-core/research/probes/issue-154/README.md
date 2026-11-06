# Issue 154 startup probe

Throwaway fixture. Run from the Squeal checkout, using its installed dependencies:

```sh
node docs/specifications/011-core/research/probes/issue-154/startup.mjs 60000
```

The optional argument is the lint wait in milliseconds (default 60000). The
probe skips live work when one-minute load exceeds CPU count. It creates a
separate Git repository and socket directory under `/tmp/sq154-*`, links the
checkout's dependencies, and starts the checkout's committed CLI/daemon bundle.
No dependencies are installed. Generated repositories, stores, sockets and
`node_modules` are never committed.

An async Vitest configuration waits for a file under the fixture's `.git`.
The probe runs `run lint --wait`, queries that same request ID before and after
releasing startup, runs a second lint wait as a control, then stops its daemon
and removes the fixture. The gate has a 180-second fallback. CLI children have
bounded lifetimes. Cleanup targets only this fixture and its directly owned
process. The baseline is lookup-only; this does not run a test suite.

This is a real daemon with an artificial startup delay. It proves a reachable
pending-request state, not the cause of the original incident. Results and
limits are in `../../issue-154.md`. Standard output is JSON Lines for inspection;
do not commit that generated output or fixture state.
