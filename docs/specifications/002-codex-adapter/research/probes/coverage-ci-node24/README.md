# Throwaway probes for 002-42

These probes inspect coverage without changing product code. They create a unique fixture under the target checkout's ignored `test/fixtures/node-test/.tmp/` and remove it in `finally`. Run sequentially. No full suite, daemon or global plugin setup is required. `probe.mts` maps copies of inputs through the existing product functions; it is not a proposed repair.

## Evidence

- `main-*.txt`, `candidate-*.txt`: exact focused command, runtime PATH, cwd, UTC completion time, exit and Vitest output (trailing whitespace and final blank lines removed).
- `environment.json`: full commit/runtime/dependency versions, Node binary SHA-256, load snapshot and empty diff of the coverage paths/lockfile.
- `payload-*.json`: exact fixture text and hashes, selected fixture V8 scripts and map-cache entries, records before/after the edit, inline-map decoding control, null-text and bad/missing-URL variants. Unrelated Node and dependency coverage scripts are omitted. Fixture paths are preserved as observed, though the fixtures have been removed.
- `control-*.json`: source-map and child-inheritance control without Squeal.
- `internal-source_map-source_map_cache.diff`: full unified diff of that built-in module in the two installed Node binaries.
- `ci-excerpt.txt`: command and selected CI version/failure lines, with ANSI color escapes and trailing whitespace removed.

## Reproduce

Run from this research checkout, with its existing pnpm-installed dependencies. The recorded scratch paths were `/tmp/squeal-002-42-main` and `/tmp/squeal-002-42-candidate`; both were removed after research. Use unused paths if reproducing alongside other work.

```sh
git worktree add --detach /tmp/squeal-002-42-main 40259a9e4
git worktree add --detach /tmp/squeal-002-42-candidate 9401c1d08
ln -s "$PWD/node_modules" /tmp/squeal-002-42-main/node_modules
ln -s "$PWD/node_modules" /tmp/squeal-002-42-candidate/node_modules
```

In each scratch checkout, for `V=24.21.0` and then `V=24.22.1`:

```sh
PATH=/home/agent/.nvm/versions/node/v${V}/bin:$PATH \
  pnpm exec vitest run test/runners/node-test/coverage.test.ts \
  --maxWorkers=1 --reporter=verbose
```

From the research checkout, set `PROBE_DIR` to this directory's absolute path. For `TREE=main` and then `TREE=candidate`, and each runtime above:

```sh
PATH=/home/agent/.nvm/versions/node/v${V}/bin:$PATH \
  node --import tsx "$PROBE_DIR/probe.mts" \
  /tmp/squeal-002-42-${TREE} /tmp/payload-${TREE}-${V}.json
```

Each probe exits 0 when it has captured its observations, including the known bad records. It does not assert a repair. For each runtime, the independent control command is:

```sh
PATH=/home/agent/.nvm/versions/node/v${V}/bin:$PATH \
  node "$PROBE_DIR/control.mjs" /tmp/squeal-002-42-main /tmp/control-${V}.json
```

Each adapter observation was repeated while extending the probe; all had the same result. Final committed captures include every variant. Runtime comparisons were never concurrent.

Extract the source examined in each binary with:

```sh
/home/agent/.nvm/versions/node/v${V}/bin/node -e \
  'process.stdout.write(process.binding("natives")["internal/source_map/source_map_cache"])' \
  > /tmp/node-${V}-source-map-cache.js
diff -u /tmp/node-24.21.0-source-map-cache.js /tmp/node-24.22.1-source-map-cache.js
```

The preserved diff was generated with Python `difflib.unified_diff` (trailing whitespace removed, including blank context-line prefixes), using labels `24.21.0/internal/source_map/source_map_cache` and `24.22.1/internal/source_map/source_map_cache`. `internal/modules/esm/translators`, `internal/modules/esm/load` and `internal/modules/typescript` were also compared; they had no diff.

CI command:

```sh
gh run view 40513866109 --job 122222539571 --log
```

Cleanup after checking both scratch worktrees have no tracked changes:

```sh
rm /tmp/squeal-002-42-main/node_modules
rm /tmp/squeal-002-42-candidate/node_modules
git worktree remove /tmp/squeal-002-42-main
git worktree remove /tmp/squeal-002-42-candidate
```
