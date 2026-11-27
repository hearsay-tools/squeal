# Wave 129: what the intermittent CI failures have in common (row 011-428)

The human, 2026-11-27 (session bca5dbc3), approved after a summary: "25 proposed rows of intermittent CI failures, mostly Node 22 timeouts; each can force a CI re-run before a release; one row to find what they have in common would cut release friction": "Start the approved rows and the two that needed my decision". Coordinator 9d95aa57. Research only: no product code, no version, no release.

## Row 011-428 (researcher; shape: research)

**Outcome.** One findings file that groups every intermittent CI failure by cause, counts how often each group fails per CI run, and names for each group one repair that removes the cause instead of raising a timeout.

**Read.** `docs/styleguide.md`; `docs/process.md` ("Test runs on a shared host"); the board's Triage rows keyed `ci-*`, `flake-*` and `local-*` (list below); the earlier findings `specifications/011-core/research/ci-intermittent.md`, `ci-crash-rekey-stall.md`, `ci-opencode-continued.md`, `research/enotempty-cleanup.md`, and `specifications/009-pi-adapter/research/idle-wake-not-armed.md`; `.github/workflows/ci.yml` (shards, Node versions, runner size); `vitest.config.*`.

**Rows covered (all `proposed`).** ci-45929184093, ci-45839381817, ci-45806426506, ci-45710459569, ci-45670612795, ci-45620165526, ci-44761495685, ci-44844073825, ci-45015922328, flake-0.1.597-storage, ci-44730874934, ci-43528167215, ci-43589305691, ci-43514823592, ci-42385447650, ci-44048718107, ci-program-build, ci-41350776522, ci-42925034090, ci-41207574795, ci-44491147466, local-handover-gap-2026-10-31, ci-45070126199, ci-45074346217, ci-45208543882, ci-45256832662, ci-45286593938, ci-45467136364. Context only, already diagnosed: ci-40592034593, ci-43987606521, ci-43472769648.

**Method.**
1. Census, not only the board: `gh run list --workflow ci.yml` for at least the last 30 days on `main` and `cand/**`; for each failed job, `gh run view <id> --log-failed` (and `--attempt N`). Record per failure: run, attempt, commit, Node version, shard, test file and name, assertion, and whether a re-run passed. Keep the table as a CSV under `research/probes/ci-flake-census/`.
2. Rates: failed runs over all runs, per Node version and shard; per test file, sightings over runs that ran it. Which failures forced a re-run before a release (candidate or exact-main runs).
3. Group by cause: a fixed time bound under a slow or loaded runner; a cleanup or teardown race (ENOTEMPTY, kill, lock); an ordering assumption between processes (daemon, hook, store); a real product defect. Look for a shared mechanism: one helper, fixture, poll or wait used by many of the failing files; the shard's file mix; Node 22 against 24 and 26.
4. Per group: the cause with a source line, its tag (`verified by experiment`, `read in source code`, `inferred`), its frequency, and one repair that does not only raise a timeout (an event to wait on instead of a sleep, a deterministic clock, a fixture that owns its cleanup, a product fix), with its size and the files it touches.

**Limits.** No product or test edits. No artificial host load. A reproduction that needs a quiet host or repetitions runs on boat.dev (`~/projects/notes/topics/boat-dev.md`), never here; keep its cost under about $5 and stop when one group's mechanism is shown. Bound the whole task to about three hours.

**Owns.** `docs/specifications/011-core/research/ci-flake-census.md` and `research/probes/ci-flake-census/`. Not `docs/board.md`, `spec.md`, `src/`, `test/`.

**Done when.** The findings file opens with a table: group, rows and files in it, failures per 100 CI runs, re-runs it forced before releases, cause and tag, proposed repair and cost. Every board row above is in exactly one group or named as unexplained with the evidence missing. Committed on the worker branch.

Use /researcher.
