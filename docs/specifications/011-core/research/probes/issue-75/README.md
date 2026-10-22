# Throwaway issue-75 probes

These are research fixtures, not product code or regression tests. See [the findings](../../issue-75.md) for the verdict and exact commands.

Run `probe.mjs` with Node 24 from the repository root. It needs the local release tags `squeal--v0.1.260` and `squeal--v0.1.261`. It extracts their committed Codex bundles without a build or installation. It skips live work when one-minute load exceeds CPU count.

Modes: `natural` sends new hooks; `mixed` sends old and new hooks in each batch; `blocked-delay` pauses its own old daemon 10 ms after its shutdown diagnostic, waits across heartbeat grace, and resumes it. `blocked` is an exploratory immediate pause; it can hold a store write and is not the main result. The pause modes are synthetic. Timing can change whether they reach the intended point; inspect the hold event and snapshots.

Each run creates a unique `.scratch/<UUID>/repo`, its own Git/store state and XDG directories. The configured node:test project has no test files. No test run is requested. The only inherited environment value is PATH. Squeal creates its own unique socket and temporary directory through its normal runtime fallback. Cleanup signals only processes whose argv contains both `daemon` and this exact fixture root. It leaves the scratch files for inspection.

Redirect each run's stdout to `<mode>.jsonl`. `summarize.mjs <log>...` extracts notices, claims, final daemon records and cleanup into `results.txt`. The committed results are observations from 2026-10-22. Raw logs and extracted bundles stay uncommitted. Each result includes the hook exits and elapsed times; exit 0 alone does not prove delivery, since hooks fail silently.
