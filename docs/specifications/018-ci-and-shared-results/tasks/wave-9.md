# Spec 018 wave 9: the cezar proof, measured

The human, 2026-11-10: "cezar proof: Yes, all four" (row 018-21: one-day measurement after the cezar change), then "Install node 26 as a default" (the host's nvm default is Node 26.13.0 since 2026-11-10; `~/projects/notes/topics/host-node-version.md`).

## 018-21 measurement: cost in CI, files current from fetched exports

Use /researcher. Shape: research.

Outcome: `research/shared-proof.md` answers, with numbers and the commands that produced them: what recording costs cezar's CI, and what share of a fresh cezar worktree's test files is current from the fetched results alone.

Read: `spec.md` D8 to D17 (D13 publish, D14 reader, D1 and D10 key rules); `research/import-trial.md` (the earlier trial: 87% of files current from a CI export); `status.md` lines of 2026-11-10.

State: cezar merge-group runs record, export and publish since cezarion#3176 (first ref `refs/squeal/ef0c1ff0136d42e6b90d849d265c13bc73cd5471`, run 42859836676). cezar pins Squeal 0.1.426 and Node 26.13.0; its `squeal.config.json` sets `shared.ref`. Cezar sessions on this host still run Node 24.22.1 until the cockpit restarts.

Questions:
1. CI cost: wall time and CPU of the four Vitest shards in merge-group runs with recording (42843943744, 42859836676 and later ones) against merge-group runs before cezarion#3151, plus the export and publish jobs. Say how noisy the runner timings are.
2. Files current: in a fresh clone of cezar at a published commit (and at a later main commit, which is the usual case), started with Node 26.13.0 explicitly and Squeal 0.1.426 lookup-only, how many test files does `squeal status` report current right after the reader imports, and why are the others not (each difference `status` names)? Repeat with Node 24.22.1 to show what the Node pin buys.
3. If cezar sessions have moved to Node 26 by the time you finish, the same share in one or two live cezar worktrees; otherwise say so.

Rules: never run cezar's test suite (lookup-only, `squeal status`; no `squeal run`); probes and clones under `$TMPDIR` with a temporary HOME, never the real HOME; read-only GitHub API calls only; stop every daemon you start. No change to cezar's repository or settings.

Done when: `research/shared-proof.md` and its probes under `research/probes/shared-proof/` are committed, with effect sizes first and the n behind each number.
