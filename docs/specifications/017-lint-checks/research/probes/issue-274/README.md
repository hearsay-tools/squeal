# Issue 274 probes (throwaway)

Throwaway research probes for `../../issue-274.md`. Not product code, not tests. They start no daemon, connect to no live socket and open no live store. Fixtures live under `/tmp/sq274/`; delete it after a run.

## Files

- `make-fixture.mjs <root> <plain|import> <oxlint package folder> [packages] [@babel/parser folder]`: a synthetic git repository. 10 packages give 3,009 listed files (2,100 `.ts`, 600 `.json`, 300 `.md`, configs and plugin files); 18 packages give 5,479. Root `.oxlintrc.json` with a local TypeScript JS plugin (`tools/lint/plugin.ts`, whose rules sit in `owner-reader-rules.ts` and `test-enum-literal.ts`, as in the issue), 3 nested configs. `import` turns on oxlint's import plugin. With a `@babel/parser` folder the plugin loads 70 more rule modules (about 640 KB) and that parser: the shape of the issue's repository's plugin (read there, not copied).
- `probe.ts <root> <out.json>`: runs with this worktree's `tsx` and imports Squeal's own modules from `src/`. It times `lintedFiles` (256 paths per run, observe on and off), larger parts, a run with no paths, `chainOf` over every linted file (today, memoized per folder, from the found-configs list), `Keyer.keys` and a once-per-Keyer variant (and checks both give byte-identical keys), the lint store's `results.get` in one block and with a yield every 256 lookups, and three whole `rekey()` calls on a lint store under `/tmp`: first, config (the two plugin rule files edited), and config with `lint.include` narrowed. Each row has wall time, own CPU, the CPU of reaped child processes (10 ms ticks), the longest event-loop block (a 1 ms interval timer) and the one-minute load.
- `boat-run.sh`: what ran on the boat.dev sandbox (fixtures, then the probe on each).
- `debug-files-semantics.sh <empty folder> <oxlint package folder>`: whether `oxlint --debug files` loads a JS plugin or a TS config, and whether a run with no paths lists what explicit paths list. Output in `out/debug-files-semantics.txt`.

## Outputs (`out/`)

- `boat-<fixture>.json`, `boat-run.log`: boat.dev sandbox `default` type, AMD Ryzen 7 9700X, 4 vCPU, Node 24.22.1, load 1.4 to 1.8, 2026-11-24. The quiet reference.
- `local-<fixture>.json`: this host, 16 CPUs visible, Node 26.13.0, load 25 to 41 during the runs, 2026-11-23/24. Busy-host numbers; they vary about 50% between runs.
- `chunk-equality.txt`: `--debug files` over all 5,479 paths in parts of 256 and in 2 large runs lists the same 3,853 files.

## Run

```sh
mkdir -p /tmp/sq274
node make-fixture.mjs /tmp/sq274/heavy-large plain "$(readlink -f node_modules/oxlint)" 18 \
  "$(readlink -f node_modules/.pnpm/@babel+parser@7.29.13/node_modules/@babel/parser)"
TMPDIR=/tmp/sq274 node_modules/.bin/tsx docs/specifications/017-lint-checks/research/probes/issue-274/probe.ts \
  /tmp/sq274/heavy-large /tmp/sq274/heavy-large.json
rm -rf /tmp/sq274
```

Paths above are relative to the worktree root. Do not run pnpm inside a fixture: its `node_modules/oxlint` is a symlink into this worktree's install.
