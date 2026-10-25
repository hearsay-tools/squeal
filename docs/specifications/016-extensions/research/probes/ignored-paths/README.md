# Probe: git-ignored paths a test run observes (016-19)

Throwaway. Nothing here is product code; delete it when `ignored-paths.md` is folded.

- `make-recorder.mjs` copies `src/runners/observe/{recorder,fs,spawn,preloads}.cjs` at this
  worktree's HEAD (e5e432c81) into `$S/rec/src/runners/observe/` and splits the recorder's kind `f`
  into `load` (resolve hook), `read` (readFile, read streams, opens that can read, copy sources),
  `stat` (stat, lstat, exists, access, realpath) and `exec` (entry point, spawn arguments, Worker
  scripts). `f`, `l`, `r` and `w` are still written as before. The path suffix keeps it a
  "Squeal recorder" for `ownNodeOptions`, so nested Squeal runs strip it as they strip the daemon's.
- `setup.sh` makes scratch clones of squeal (this HEAD) and cezar (`/home/agent/projects/cezar`,
  e2882a245) under `S=/tmp/ip-016-19`, with their own HOME, XDG_* and TMPDIR. Squeal's
  `node_modules` is a plain copy. Cezar's was then replaced by `pnpm install --frozen-lockfile
  --offline` in the clone (the main checkout's tree lacks `@types/node`), and `npm run build:server`
  ran, as cezar's CI does before its unit suite.
- `run.sh <repo> <label> <cmd...>` runs one suite in the clone under `nice -n 10`, the host's
  full-run lock, a clean env (no CEZ_* or SQUEAL_* of the session) and the recorder in
  `NODE_OPTIONS`. It refuses when the one-minute load is not below the CPU count.
  `when-quiet.sh` waits for that, then calls `run.sh`. `meta.txt` wall times include any wait
  for the lock; the findings use the first-to-last record time instead.
- `node-test-each.sh` / `cezar-node-test.sh`: each node:test file in its own `node --test`, with
  the recorder's `file` set to it (cezar's two `nodeTest` projects from its `squeal.config.json`).
- `analyze.mjs <root> <out> <result.json> <files.txt>` applies `observedInputs`' filters per test
  file of the run (written paths, outside root, `node_modules`, plain directories), then
  `git check-ignore -z --stdin` as `checkIgnored` does, and the Q4 bounds. The closure is not
  subtracted, so the counts are an upper bound of what (b) would track.
- `summarize.mjs` makes the committed `results-*.json`; `compare.mjs` the Q2 comparison.
- `fixture-output.txt`: the recorder copy on a one-file node:test fixture (ignored `dist/` loaded,
  read, stat'ed and listed; a written file left out).

Raw recorder output (44 MB and 60 MB) stayed in `/tmp/ip-016-19/out` and was deleted at the end.
