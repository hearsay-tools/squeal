# Probes for 011-149: edits that change only types or comments

Throwaway. Written for `research/type-only-edits.md`, 2026-10-23. Nothing here is product code, and nothing here is maintained. The fixture tests under `q2/cases/` are not Squeal's tests: no Vitest config of the repository includes them.

## Rules these probes keep

- Every repository is a `git clone` under `/tmp/to149`, never `git worktree add`. Dependencies are copied from an installed checkout at the same lockfile (`cp -a node_modules`, and cezar's and toolkit's nested `node_modules`), never fetched.
- Every command runs through `env.sh`: `env -i` with `HOME`, `XDG_*`, `TMPDIR`, npm, pnpm and corepack homes under `/tmp/to149`. `PLUGIN_ROOT` and `PLUGIN_DATA` are never set. No Squeal daemon is started.
- A store is read only from a copy (`store.sqlite` with `-wal` and `-shm`). Blobs are read with `git cat-file` from each repository's `.git`, read only.
- Every probe runs at nice 10 in one process. The fixtures run Vitest with `--maxWorkers=1`.
- `emit.mjs` overwrites files in its clone only, and restores the clone with `git checkout -- .` and `git clean -fdq` at its end.

## Files

| File | Measures | Question |
|---|---|---|
| `env.sh` | the isolated environment | all |
| `corpus.py <store copy> <git dir> <out.tsv>` | every code path edit of the store's `watch` revisions, with whether both blobs are in git | 1, 5 |
| `pairs.py <store copy> <corpus.tsv> <out.tsv>` | unique (path, old, new) edits with both blobs, and the projects whose closures hold the path | 1 |
| `emit.mjs <clone> <pairs.tsv> <git dir> <out.jsonl> [projects]` | per edit and project: Vitest's pipeline (`transformRequest` on the project's Vite environment), Vite's `transformWithOxc` alone, Node's `stripTypeScriptTypes`, esbuild; code and `mappings` compared | 1, 3 |
| `nocomment.mjs <clone> <pairs.tsv> <git dir> <out.jsonl>` | per edit: oxc's code, then its reprint without comments (K3), with times | 1, 3 |
| `classes.py <emit.jsonl>` | `emit.mjs` output counted per transform, and where the pipeline and oxc alone disagree | 1, 3 |
| `q1.py <store copy> <corpus.tsv> <emit.jsonl> <squeal.config.json> [since ms]` | per equal edit: recorded seconds of the files whose closures hold it, by import, observed, declared, own | 1 |
| `globs.py` | `squeal.config.json` `inputs` as regular expressions (used by `q1.py`) | 1 |
| `replay.py <store copy> <corpus.tsv> <emit.jsonl> <bare.jsonl> <config> <since ms> <out.json> [project=esbuild,project=raw]` | every revision replayed with keys on emitted code (K1, K2, K3): files kept, their recorded and stored seconds, and their transitions until the next revision touching the closure | 5 |
| `summary.py <replay.json> [since ms]` | `replay.py` output by agent and bulk revisions, with the transitions in kept files | 1, 5 |
| `cost.mjs <clone>` | the cold cost of oxc, oxc with maps, the reprint and the blob id over every TypeScript file | 3 |
| `diffone.mjs`, `vq.mjs` | one edit through one project's pipeline; the import specifiers of one file's output (the cezar `web` disagreement) | 2 |
| `q2/q2.mjs` with `q2/cases/*` | each case's test with `lib.A.ts` and `lib.B.ts`, outcome and the `lib.ts` frame, and oxc's output compared; transform demos for decorators, enums, namespaces, parameter properties and import elision | 2 |
| `q2/oxc-comments.mjs`, `q2/reprint.mjs` | which comments oxc keeps; the reprint without comments | 1, 2 |
| `out/` | every output the findings quote | all |

## Re-running each measurement

```sh
S=/tmp/to149; P=<this folder>
mkdir -p $S/{home,run,tmp,logs,an,probe} $S/stores/{squeal,cezar,toolkit} $S/xdg/{config,cache,data,state}; chmod 700 $S/run
cp $P/*.py $P/*.mjs $P/env.sh $S/probe/ && mv $S/probe/env.sh $S/
for r in squeal cezar toolkit-dev; do git clone ~/projects/$r $S/$r; done      # then cp -a each installed node_modules
cp ~/projects/squeal/.git/squeal/store.sqlite* $S/stores/squeal/               # likewise cezar and toolkit-dev
cd $S
# question 1: the corpus, the transforms, the comment-free reprint
python3 -I probe/corpus.py stores/squeal/store.sqlite ~/projects/squeal/.git an/squeal-corpus.tsv
python3 -I probe/pairs.py stores/squeal/store.sqlite an/squeal-corpus.tsv an/squeal-pairs.tsv
(cd squeal && nice -n 10 ../env.sh node ../probe/emit.mjs $S/squeal $S/an/squeal-pairs.tsv ~/projects/squeal/.git $S/an/squeal-emit.jsonl)
nice -n 10 ./env.sh node probe/nocomment.mjs $S/squeal an/squeal-pairs.tsv ~/projects/squeal/.git an/squeal-bare.jsonl
python3 -I probe/classes.py an/squeal-emit.jsonl
python3 -I probe/q1.py stores/squeal/store.sqlite an/squeal-corpus.tsv an/squeal-emit.jsonl squeal/squeal.config.json [since ms]
# question 2: the fixtures (node_modules: a link to the squeal clone's)
cp -r $P/q2 $S/q2 && ln -s $S/squeal/node_modules $S/q2/node_modules && (cd $S/q2 && ../env.sh node q2.mjs)
# question 3: cost
nice -n 10 ./env.sh node probe/cost.mjs $S/squeal
# question 5: replay, then the last 72 hours (since = copy time - 72 h, in ms)
python3 -I probe/replay.py stores/squeal/store.sqlite an/squeal-corpus.tsv an/squeal-emit.jsonl an/squeal-bare.jsonl squeal/squeal.config.json 0 an/squeal-replay-all.json
python3 -I probe/replay.py stores/cezar/store.sqlite an/cezar-corpus.tsv an/cezar-emit.jsonl an/cezar-bare.jsonl cezar/squeal.config.json 0 an/cezar-replay-all.json "test:unit=esbuild,root:test:unit=raw,test:package=raw"
python3 -I probe/summary.py an/squeal-replay-all.json 1792502418000
```

The 72 h window of the findings ends at the store copy, 2026-10-23 13:20:18Z (`since` 1792502418000). For toolkit, pass `"github-scripts=raw,plugin-scripts=raw"` and a copy of its untracked `squeal.config.json`.

Clean up: `rm -rf /tmp/to149`.

Done on 2026-10-23 at 13:46Z: no probe process is left (`pgrep -af to149` finds none, `systemctl --user list-units --all 'to149-*'` lists 0 units), and `/tmp/to149` (clones, store copies, intermediate outputs) is removed. The numbers the findings quote are in `out/`.
