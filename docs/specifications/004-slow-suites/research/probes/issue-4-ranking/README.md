# Probe: slow-tier order after a source edit, hearsay-tools/squeal#4 (throwaway)

Throwaway evidence for `../../issue-4-ranking.md`. Not product code. Biome and `tsc` skip `docs/`. The root Vitest config does not include this directory, so Squeal never runs it. Delete freely.

## What it does

`probe.test.ts` builds a scratch git repository under `.tmp/` (gitignored, removed after the run) shaped like hearsay-tools/cezarion at `d88c8c1d3`:

- 77 Vitest files named as its `packages/web/e2e/*.e2e.ts`. Each sleeps its duration from cezarion CI run 38795107753 (`ci-durations.json`, from `logs/ci-38795107753-file-lines.txt`) divided by `PROBE_SCALE` (default 100). The specs the issue names carry the literal tokens the real specs select.
- `packages/web/src/routes/task-thread/markdown.tsx`, which imports `task-link.tsx` and `link-safety-dialog.tsx`, and `packages/web/src/components/diff/diff-file.tsx`. No spec imports any of them.
- Policy as cezarion's: `slow.include` the 77 files, `slow.maxWorkers` 1, `slow.maxParallel` 1, `baseline.onStart` `"lookup-only"`, declared inputs `packages/web/src/**` and `packages/web/e2e/**`.

It drives the real `Scheduler` (`src/core/scheduler`) through `test/scheduler/helpers.ts` (`openHarness`: a real Vitest adapter, a real store, no consumer, so the idle trigger runs the slow tier). The load guard reads load 0. Then:

1. Edit `markdown.tsx` on a fresh store (no durations known).
2. Edit `diff-file.tsx` (durations known from pass 1).
3. Edit `markdown.tsx` again (durations from pass 2).

After each pass it writes the slow tier's run order and compares it with "shortest stored duration first, unknown last, then path". It reads each file's stored duration under its key before the edit. Results go to `logs/run-<time>.json`.

## Commands

```bash
npm ci   # the worktree had no node_modules
P=$PWD/docs/specifications/004-slow-suites/research/probes/issue-4-ranking
npx vitest run --config $P/vitest.config.ts --root $P
$P/tokens.sh ~/projects/cezar d88c8c1d3 > $P/logs/tokens-diff-d88c8c1d3.txt
node $P/store-worktrees.mjs ~/projects/cezar/.git/squeal/store.sqlite
node $P/store-runs.mjs ~/projects/cezar/.git/squeal/store.sqlite
node $P/store-main-r80-90.mjs ~/projects/cezar/.git/squeal/store.sqlite
```

The `store-*.mjs` scripts open cezarion's live Squeal store with `node:sqlite` `readOnly: true` and write nothing. `tokens.sh` reads cezarion only through `git show` and `git grep` at a fixed revision. Nothing in `~/projects/cezar` was edited.

Run on 2026-10-16 at Squeal `e0ff15a3`, Node 24.21.0, Vitest 5.0.3. The host load was 38.9 at 15:58 and 12.1 at 16:00 local time, on 24 CPUs. Two runs: `logs/run-2026-10-16T14-00-00-929Z.json` (88 s) and `logs/run-2026-10-16T14-02-02-644Z.json` (93 s).
