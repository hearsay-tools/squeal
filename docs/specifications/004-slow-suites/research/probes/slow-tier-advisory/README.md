# Probes for `slow-tier-advisory.md` (row 004-75)

Throwaway. Nothing here is product code or a test. Every probe only reads: Claude Code transcripts
under `~/.claude/projects/-home-agent-projects-cezar*`, the live Squeal stores
`/home/agent/projects/cezar/.git/squeal/store.sqlite` and `/home/agent/projects/squeal/.git/squeal/store.sqlite`
(opened with `readOnly: true`), cezarion's git objects (`git show`, `ls-tree`, `diff`), and the eval
cells under `/tmp/squeal-evals-1001/cells`. Nothing was run in a repository, no test or browser ran, and
nothing was written outside this directory. The probes ran at a 1-minute load of 4.9 to 19.1 on 24 CPUs.
They paused once while the load was 25.9, until it fell below 20.

| File | What it does |
| --- | --- |
| `timeline.mjs` | One transcript as a timeline: prompts, Bash commands, SQUEAL hook text. `CLIP` sets the excerpt length. |
| `slow-deliveries.mjs` | Every slow-tier delivery (`..., slow tier, Squeal's run saw it at revision N`) per transcript, with the hook that carried it, and the agent's own slow-suite commands. |
| `agent-slow-acts.mjs` | Per transcript with a slow tier and a SQUEAL registration: the primer's slow wording, edits, and whether the agent ran `squeal run --slow`, `run --all`, or an npm/pnpm e2e or `test:package` run. Output `logs/agent-slow-acts-cezarion.txt`. |
| `check-history.mjs` | One test file's results, transitions and known states in a store, for matching worktrees. |
| `store-slow.mjs`, `groups-*.json` | Per revision, whether a changed path re-keys each slow group (its declared inputs, its test directory); runs, inherited states, re-runs at a new key and how many changed an outcome; every slow transition with its previous result. Output `logs/store-cezarion.json` (18:54), `logs/store-cezarion-1900.json` (19:00), `logs/store-squeal.json`. |
| `reuse.mjs` | Latest known state of each slow file per worktree, inherited or own, valued at that file's mean single-file run wall time in the store. Output `logs/reuse-*.json`. |
| `reruns.mjs` | Re-runs at a new key by file-level outcome. Output `logs/reruns-*.txt`. |
| `advisory.mjs` | The set an advisory would name for a cezarion commit range: one-hop importers of a changed path, plus specs with D2's token evidence (b2, `../issue-4-signals/tokens.mjs`). Output `logs/advisory-1234-*.json`. |
| `q.mjs` | Ad-hoc read-only SQL against a store. |

Limits:
- The stores are live and prune themselves. Between 18:54 and 19:00, two finished worktrees were removed, which took 243 browser and 65 package results with them. Both snapshots are kept.
- A file-level result's `duration_ms` is not the run's wall time (1,531 browser results summed 59.8 min, their runs 575 min). Minutes here come from `runs.ended_at - started_at` of single-file runs, which include the per-run setup and exclude the once-per-environment `globalSetup` build.
- The store keeps one result per check and key. A re-run at an unchanged key replaces the row, so same-key retries are not counted.
- Only Claude Code transcripts were read. Codex sessions on cezarion were not.
