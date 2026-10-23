# Throwaway issue-75 probes

These are research fixtures, not product code or regression tests. See [the findings](../../issue-75.md) for the verdict and exact commands.

Run `probe.mjs` with Node 24 from the repository root. It needs the local release tags `squeal--v0.1.260` and `squeal--v0.1.261`. It extracts their committed Codex bundles without a build or installation. It skips live work when one-minute load exceeds CPU count.

Modes: `natural` sends new hooks; `mixed` sends old and new hooks in each batch; `blocked-delay` pauses its own old daemon 10 ms after its shutdown diagnostic, waits across heartbeat grace, and resumes it. `blocked` is an exploratory immediate pause; it can hold a store write and is not the main result. The pause modes are synthetic. Timing can change whether they reach the intended point; inspect the hold event and snapshots.

Each run creates a unique `.scratch/<UUID>/repo`, its own Git/store state and XDG directories. The configured node:test project has no test files. No test run is requested. The only inherited environment value is PATH. Squeal creates its own unique socket and temporary directory through its normal runtime fallback. Cleanup signals only processes whose argv contains both `daemon` and this exact fixture root. It leaves the scratch files for inspection.

Redirect each run's stdout to `<mode>.jsonl`. `summarize.mjs <log>...` extracts notices, claims, final daemon records and cleanup into `results.txt`. The committed results are observations from 2026-10-22. Raw logs and extracted bundles stay uncommitted. Each result includes the hook exits and elapsed times; exit 0 alone does not prove delivery, since hooks fail silently.

## Row 011-133: three versions in one worktree

`probe.mjs mislabeled|control <clone> <scratch> [seconds]` runs `three-versions.mjs` (2026-10-23, [findings](../../issue-75-77.md)). It takes the committed Codex and Claude Code bundles of 0.1.271, 0.1.272 and 0.1.273 from a clone of this repository under `/tmp`, never from this worktree, and builds nothing. `HOME`, `CODEX_HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and `TMPDIR` are under the scratch directory. It does nothing when the one-minute load is 16 or more.

The steps:

1. A Codex SessionStart of 0.1.272 spawns the old daemon from its kept copy, which holds 0.1.271.
2. The probe removes the 0.1.272 cache directory, as Codex's install of 0.1.273 does.
3. Codex hooks of 0.1.273 run every few seconds, a Stop every 20 to 30 s.
4. A writer holds the store while a named `status --wait` runs. Then an edit, a `squeal start` from Claude Code's 0.1.272 CLI, and four short store holds.
5. One node:test file of 4 s gives a real tier.

`mislabeled` also keeps a copy named 0.1.273 that holds 0.1.272, as this host had. `control` has no copy named 0.1.273. The probe logs each daemon process (argv: executable, `--await-lock`), each record, claim and exit note, and each hook's notice. Cleanup signals only processes whose argv names the scratch directory.

`summarize-three.mjs <log>...` writes `results-three.txt`. Raw logs, clones and scratch stay under `/tmp` and are removed after the research.
