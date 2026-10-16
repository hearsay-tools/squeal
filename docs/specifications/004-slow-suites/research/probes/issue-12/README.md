# Issue 12 probes (throwaway)

Throwaway: evidence for `../../issue-12.md`, not tests and not product code.
Each script builds its own fixture under `/tmp/issue12*-XXXXXX` with its own
`HOME`, `XDG_RUNTIME_DIR` (so its own slow slots and socket) and git repo,
runs the daemon in the foreground with stderr captured, and removes the
fixture at the end. Neither touches another session's daemon, slot or store.

- `probe.sh <squeal.mjs>`: a daemon on an empty fixture. A: 14 s of status,
  nothing held (negative control). B: `hold-store.mjs` holds the store's
  write lock (`BEGIN IMMEDIATE`) 20 s. C: the daemon is `SIGSTOP`ped 14 s,
  an event-loop stall. Status is read once a second; the daemon's pid is
  checked each time.
- `probe-slow.sh <squeal.mjs>`: a fixture with Vitest 5, one fast and three
  slow files (`slow.maxParallel` 1, load guard off). `hold-slots.mjs` holds
  the slow slot 75 s, as another worktree's slow tier would. Then
  `run --slow --wait 60000` and `status --wait 60000 test/slow/a.test.js`
  start, the store's write lock is held 16 s, `squeal start` runs during the
  lapse, 20 s of status with the store free and the slot still held follow
  (negative control), and the script waits for the slow files to run once
  the slot frees. Needs network or an npm cache for `npm i vitest@5`
  (`npm_config_cache` overrides the cache path).

Run from the repository root:

    P=docs/specifications/004-slow-suites/research/probes/issue-12
    $P/probe.sh      ~/.claude/plugins/cache/hearsay/squeal/0.1.199/dist/cli/squeal.mjs
    $P/probe-slow.sh ~/.claude/plugins/cache/hearsay/squeal/0.1.199/dist/cli/squeal.mjs

The candidate build was the committed plugin bundle of `cand/0.1.201`
(f9c29e11), extracted with
`git archive f9c29e11 plugins/claude-code | tar -x -C <tmp>` and passed as
`<tmp>/plugins/claude-code/dist/cli/squeal.mjs`.

`output-<version>-lock.txt` and `output-<version>-slow.txt` are the runs the
findings quote: 0.1.199 (sha256 of `squeal.mjs` 6869478e…ae31f) and 0.1.201
(35ef882d…454620a), 2026-10-16 20:40 to 20:51 UTC, host load 15 to 23 on
24 CPUs.
