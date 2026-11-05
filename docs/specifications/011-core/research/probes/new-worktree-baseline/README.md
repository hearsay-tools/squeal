# Probes for 011-299: why a new worktree's first baseline runs so much

Throwaway. Written for `research/new-worktree-baseline.md`, 2026-11-05/06. Nothing here is product code, and nothing here is maintained.

## Rules these probes keep

- A store is read only from a copy: `store.sqlite` with its `-wal` and `-shm`, copied with `cp` under `$TMPDIR/nw/stores/`. No live store, daemon socket or permit pool is opened. Run logs (`report.json`) are read in place, read only. cezar's git repository is read with `git ls-tree`, `diff`, `merge-base`, `rev-list` only.
- Fixture runs happen only in a fresh repository under `$TMPDIR/nw/x/fx` and its own `git worktree`s, through `env.sh` (from `../restart-baseline/`): `env -i` with `HOME`, `XDG_*` (sockets and permit pool private), `TMPDIR` and package-manager homes under `$TMPDIR/nw/x`. 4 host slots, nice 10. Squeal is this worktree's committed `plugins/claude-code/dist/cli/squeal.mjs` (0.1.406). `node_modules` is a symlink to this worktree's install; nothing installs.
- No test runs in a cezar or squeal worktree, no `squeal run --all`, no script under `evals/bin/` or `tasks/*/probe/`.

## Files

| File | What it gives | Question |
|---|---|---|
| `firsts.cjs <store> <from> <to>` | one JSON line per file run of a worktree's first baseline: seconds, ended, keys, commit, dirty, revision | 1 |
| `classes.cjs <store> <firsts> <git dir> [maxY=12]` | per file run: the start commit, own commits or edits that touched the closure, earlier runs at the same closure content whose row is gone (orphans), overlapping runs in other worktrees, clean rows stored before the run at the same closure content (up to 12 newest commits), the nearest stored content | 1 |
| `summary.cjs <classes.jsonl>` | the first matching class of each file run, seconds, runs, baselines; the dirty-worktree calibration; writes `classes.cls.jsonl` | 1 |
| `startcommits.cjs <store> <firsts> <git dir> [hub share=0.5]` | per first baseline: start commit seen before (commit or tree), on main or not, main commits since the newest seen one, hub files changed; writes `starts.jsonl` | 2 |
| `newcontent.cjs <store> <classes.jsonl> <classes.cls.jsonl> <starts.jsonl>` | class (b): how far the nearest stored content is, which paths differ, hub files among them | 2 |
| `dupes.cjs <store> <classes.jsonl> <classes.cls.jsonl>` | classes (a) and (d) in detail | 3 |
| `components.cjs` | class (c): when and by which worktree the equal-content row was stored | 1 |
| `owned-edits.cjs` | live worktrees: the closure paths own uncommitted edits touched | 1 |
| `hubs.cjs` | main commits that change a hub file; per first baseline, whether its base on main changed one | 2 |
| `levers.cjs <store> <classes.cls.jsonl> <git dir> [lags]` | the main-checkout bound: file runs whose closure content equals a main commit (its base on main or main's tip) that landed at least 0, 30, 120 min before the run; content repeats across first baselines | 4 |
| `fixture.sh` | fixture repository: 8 Vitest files (`MS` ms each, default 1000; `testTimeout` 120 s); `h.test.ts` uses `src/a.ts` and `src/b.ts` | 3 |
| `cycle.sh <label>`, `fx-count.cjs` | one daemon life (start, settle, stop) and the baseline counts of a store copy (from `../restart-baseline/`) | 3 |
| `scenario.sh` | M, B1, B2 (branches change `a`, `b`), S (squash of both), N (new worktree at S), P (one change, two worktrees started together) | 2, 3 |
| `parallel.sh` | a `vitest.config.ts` change re-keys 8 files; two worktrees start at the same moment | 3 |
| `stagger.sh` | the same with `MS=20000`; the second worktree starts 8 s after the first, while its runs are in flight | 3 |

## Fixture results (2026-11-05, 23:16Z to 23:27Z, load1 26 to 38, Squeal 0.1.406)

| Step | Listed, ran |
|---|---|
| M main | 8, 8 |
| B1 (`src/a.ts` changed) | 2, 2: a, h |
| B2 (`src/b.ts` changed) | 2, 2: b, h |
| N, new worktree at the squash of B1 and B2 (tree never validated) | 1, 1: h only; a and b inherited from B1 and B2 |
| P1, P2 started together after a `src/c.ts` change | 1, 1 and 1, 0 |
| Q1, Q2 started together after a `vitest.config.ts` change | 8, 4 and 8, 4 (split, no file twice) |
| S1, then S2 8 s later, 20 s files | 8, 8 and 8, 0 (S2 waited for S1's runs) |

A first try of `scenario.sh` had `h` import `a` and `b` without using them; TypeScript drops such imports, so `h` never re-keyed; the fixture now uses them. A first try of `stagger.sh` hit Vitest's 5 s test timeout; the FAIL results were then confirmed in both worktrees (held-failure confirmation, not a duplicate), so `fixture.sh` sets `testTimeout`.

## Re-running

```sh
P=<this folder>; SQ=<squeal checkout with node_modules>; export X=$TMPDIR/nw/x SQ
mkdir -p $TMPDIR/nw/stores/cezar $TMPDIR/nw/out && cp ~/projects/cezar/.git/squeal/store.sqlite* $TMPDIR/nw/stores/cezar/
cd $TMPDIR/nw; S=stores/cezar/store.sqlite; G=~/projects/cezar
nice -n 10 node $P/firsts.cjs $S 2026-11-02T16:50:00Z 2026-11-05T16:50:00Z > out/firsts.jsonl        # about 8 s
nice -n 10 node --max-old-space-size=6144 $P/classes.cjs $S out/firsts.jsonl $G 12 > out/classes.jsonl  # about 10 min
node $P/summary.cjs out/classes.jsonl
nice -n 10 node $P/startcommits.cjs $S out/firsts.jsonl $G 0.5
node $P/newcontent.cjs $S out/classes.jsonl out/classes.cls.jsonl out/starts.jsonl
node $P/dupes.cjs $S out/classes.jsonl out/classes.cls.jsonl
node $P/components.cjs; node $P/owned-edits.cjs; node $P/hubs.cjs
for d in ~/projects/cezar ~/projects/cezar/.ai/cezar/worktrees/*; do f=$d/node_modules/.pnpm/lock.yaml; [ -f $f ] && echo "$(sha1sum < $f | cut -c1-10) $(sha1sum < $d/pnpm-lock.yaml | cut -c1-10)"; done | sort | uniq -c   # installs
nice -n 10 node --max-old-space-size=6144 $P/levers.cjs $S out/classes.cls.jsonl $G 0,30,120
# fixture (absolute paths: cycle.sh changes directory)
$P/env.sh env X=$X SQ=$SQ sh $P/fixture.sh && sh $P/scenario.sh && sh $P/parallel.sh
rm -rf $X; $P/env.sh env X=$X SQ=$SQ MS=20000 sh $P/fixture.sh && $P/cycle.sh M && sh $P/stagger.sh
```

Clean up: `pgrep -af "$X"` must list nothing, then `rm -rf $TMPDIR/nw`. Done on 2026-11-06: the store copy, outputs and fixture are removed.
