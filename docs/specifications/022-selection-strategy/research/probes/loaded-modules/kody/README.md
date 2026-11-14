# Kody: loaded modules vs import closure (throwaway probe)

Compares the repo modules each Kody test file evaluated in a CI run (Kody's `test-module-map-*`
artifacts, PR kody-hq/kody#5108) with an emulated Vite import closure built from the same tree.
Read only: no Kody install, build, test or script runs. Results: `results.md`.

Re-run (Node 26; `$T` is any scratch directory outside the repo):

```sh
T=/home/agent/projects/squeal/.ai/squawk/t/c2c50555
SQ=/home/agent/projects/squeal/.ai/squawk/worktrees/c2c50555-e186-415e-b143-fa557218cc48
P=$SQ/docs/specifications/022-selection-strategy/research/probes/loaded-modules/kody
gh run download 43588774129 -R kody-hq/kody -p 'test-module-map-*' -D $T/kody-maps/43588774129
mkdir $T/kody-at-map && cd $T/kody-at-map && git init -q && git remote add origin https://github.com/kody-hq/kody.git \
  && git fetch -q --depth 80 origin 518a02f027e5158df9384aa788837df289ae4c31 && git checkout -q FETCH_HEAD
cd $T && nice -n 10 node $P/closure.mjs kody-at-map kody-maps/43588774129 $SQ/node_modules kody-out/result.json 50
node $P/tables.mjs kody-out/result.json > kody-out/tables.md
# VERBATIM=0 transforms TS without verbatimModuleSyntax (no change to any count here)
```

- `closure.mjs`: merges shards as `mergeTestModuleMapShards` does; parses every tracked JS/TS file
  once (esbuild transform, es-module-lexer); resolves per project (vitest-shared.ts aliases,
  vitest.node.config.ts aliases incl. `cloudflare:workers` stubs, harfbuzzjs alias for workers,
  package.json `imports`, workspace package `exports`); static, dynamic and template-glob edges
  kept apart; setupFiles closure per project; optional wrangler `main` closure for workers-unit;
  replays the last N first-parent commits with one map and one graph (both from the map commit).
- `tables.mjs`: prints the tables in `results.md`.

The map JSON and the clone stay outside the repo (Kody is FSL-licensed); only counts are here.
