# Probe: which signal ranks the slow files an edit affects, hearsay-tools/squeal#4 (throwaway)

Throwaway evidence for `../../issue-4-signals.md`. Not product code. The root Vitest config does not include this directory, so Squeal never runs it. Delete freely. `.tmp/` and `node_modules/` are gitignored.

- `store-closures.mjs`: opens cezarion's live Squeal store with `node:sqlite` `readOnly: true`, dumps the stored closure of each slow web spec to a JSON file outside the repository, and counts which paths those closures share (`logs/store-closures.txt`).
- `signals.mjs` and `tokens.mjs`: rank the slow web specs at six edits' revisions by today's order, by (a) the stored closure, (a′) the import closure, (b1) tokens from the diff hunks, (b2) tokens from the changed file and its local imports, and (c) a hypothetical config hint. They read cezarion only through `git show`, `git ls-tree` and `git diff` (`logs/signals.json`).
- `cost.mjs`: measures the plan-time cost of (b2) and of a closure lookup over cezarion's working tree, read from disk (`logs/cost.txt`).
- `probe.test.ts`: the issue-4-ranking probe's 77-file cezarion shape, plus a helper that 7 specs import. It drives the real `Scheduler` and Vitest adapter through three passes: a warm-up markdown edit, a helper edit, and a markdown edit with a C15 promotion (`logs/run-*.json`).

## Commands

Every probe ran with `HOME`, the `XDG_*` directories and `npm_config_cache` under `/tmp/i4s-home`, and with `GIT_CONFIG_GLOBAL=/dev/null`. Nothing in `~/projects/cezar` was edited.

```bash
npm ci --ignore-scripts   # the worktree had no node_modules
P=$PWD/docs/specifications/004-slow-suites/research/probes/issue-4-signals
node $P/store-closures.mjs ~/projects/cezar/.git/squeal/store.sqlite /tmp/i4s-closures.json
node $P/signals.mjs ~/projects/cezar /tmp/i4s-closures.json $P/../issue-4-ranking/ci-durations.json > $P/logs/signals.json
node $P/cost.mjs ~/projects/cezar packages/web/src/routes/task-thread/markdown.tsx 50
npx vitest run --config $P/vitest.config.ts --root $P
```

Run on 2026-10-17 at Squeal `d8d9aa97`, Node 24.21.0 and Vitest 5.0.3, on 24 CPUs. The two scheduler runs started at load 22.5 and 9.0. The calm cost run was at load 10.2. An earlier cost run, started at load 29 and above the shared host's hold, was discarded and replaced.
