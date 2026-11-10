# Probes for ci-evidence.md (survey-020-08)

Throwaway. Not product code, not tests. Kept only as the evidence of
`../../ci-evidence.md`. Run 2026-11-10 at Squeal `bba538f1b` (0.1.425 on
main), Node v24.22.1, Vitest 5.0.3 (this repository's lockfile) and Vitest
4.1.10 with `@vitest/coverage-v8` 4.1.10 (cezar's checkout at `7b726e2a2`,
linked read-only as `node_modules`).

Every run used scratch directories under `/tmp/ce`, with `HOME`,
`XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_DATA_HOME`, `XDG_RUNTIME_DIR` and
`TMPDIR` under `/tmp/ce`:

- `/tmp/ce/repo`: `git clone --shared` of this worktree, `node_modules` a
  symlink to this worktree's.
- `/tmp/ce/fx-v4`, `/tmp/ce/fx-v5`: a two-file fixture (`src/math.ts` with a
  cast arrow and a curried arrow, `test/add.test.ts`,
  `test/grade.test.ts` with one skipped test), committed, on Vitest 4.1.10
  and 5.0.3.
- `/tmp/ce/fx-insp`: the fixture plus a test that starts, takes and stops its
  own V8 precise coverage through `node:inspector/promises`.

`squeal ci record` and `ci export` were the committed bundle,
`plugins/claude-code/dist/cli/squeal.mjs`. No daemon, no store, no agent
session. `/tmp/ce` was deleted afterwards.

| File | What it does | Output |
|---|---|---|
| `map-entry.ts` | The mapper (`buildRecord`, `encodeRecord`, `shareRecord`) as one entry, bundled with esbuild to CommonJS (`/tmp/ce/mapper.cjs`, 13.5 KB, Node built-ins only) | — |
| `probe-hook.cjs` | Q1, Q2, Q4: loaded by `--require` beside `ci record`'s hook. Wraps `Vitest.prototype.start`, sets `configOverride.coverage` to Squeal's provider before the original `start`, stamps what Vite reads, maps each payload in the Vitest process at run end. Modes `provider`, `nomap`, `yield` | `events-<pid>.jsonl`, `records/` |
| `gate-records.mts` | Q2: the gate's own collector (`collectEvidence`, row 020-03) on the same files, records written per file | `records/` |
| `compare.mjs` | Q2: per file, hook record against gate record | `compare.out.txt` |
| `timing.sh`, `sample.txt` | Q2 cost: 5 rounds of plain Vitest, `ci record`, `ci record` + provider (`nomap`), `ci record` + provider + mapping (`map`) on 015-126's 30 files, rotating order, one-minute load logged | `timing.out.tsv` |
| `runs.out.txt` | The command lines and outputs of Q1, Q3 and Q4 runs (versions, `--coverage`, export, evidence check, `node:inspector`) | — |

Build the mapper bundle, from this worktree:

```sh
node_modules/.bin/esbuild <this dir>/map-entry.ts --bundle --platform=node \
  --format=cjs --target=node22 --outfile=/tmp/ce/mapper.cjs
```

Run the hook around a command (from a scratch project):

```sh
PROBE_CI='{"provider":"<worktree>/src/core/code/coverage/provider.mjs","out":"<dir>","mode":"provider","mapper":"/tmp/ce/mapper.cjs","dump":true}' \
NODE_OPTIONS="--require <this dir>/probe-hook.cjs" \
node <worktree>/plugins/claude-code/dist/cli/squeal.mjs ci record --out <parts> -- node_modules/.bin/vitest run
```

Timing, from `/tmp/ce/repo`: `W=<worktree> P=<this dir> $P/timing.sh`.
