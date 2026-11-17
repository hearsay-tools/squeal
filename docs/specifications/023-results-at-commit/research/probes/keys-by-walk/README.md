# keys-by-walk probes: throwaway

Throwaway scripts for `../../keys-by-walk.md` (row 023-15). Not product code; do not import them.

They ran on 2026-11-17 between 07:55Z and 08:34Z (host clock UTC+1 in the logs) on 24 vCPUs at a one-minute load of 11 to 26. Each output line states its load. Squeal source and bundle at `9820b54b5` (0.1.538, `plugins/claude-code/dist/cli/squeal.mjs`), Node v26.13.0, pnpm 12.15.0 (12.11.2 pinned by squawk).

Rules kept: the live stores were opened read-only and copied whole with `VACUUM INTO` (`copy-store.mjs`) into `$TMPDIR/kbw/stores/`; each run used a fresh reflink of that copy at `<clone>/.git/squeal/store.sqlite`. The clones were `git clone --shared --no-checkout` of `~/projects/squeal` and `~/projects/cezar` under `$TMPDIR/kbw/`; checkouts were detached `git worktree add` there, installed with `pnpm install --frozen-lockfile` (warm store). Every daemon was stopped with `squeal stop <root>` and checked gone in `/proc`. All checkouts, clones, store copies and the `squeal-links-*` folders the runs left in `$TMPDIR` were deleted at the end. No test ran.

| Script | Question | What it does | Output |
|---|---|---|---|
| `copy-store.mjs <live> <copy>` | all | whole-store `VACUUM INTO` from a read-only connection | `out/store-copy.txt` |
| `walk.ts` (`pnpm exec tsx`, env `ROOT`, `STORE_DIR`, `OUT`, `FILES`, `DUMP`) | 1, 3, 4 | the gate's keyer (`daemonAdapters`, `openDaemonKeys`, `setEnvironments`, adapter `closure`, `trackUntracked`) over a scratch store, so every closure is a fresh walk; times each phase, looks each key up in the store copy; `DUMP=1` writes each file's key inputs (`stabilityPaths`) | `out/runs.json` (`walks`) |
| `daemon-start.mjs <squeal.mjs> <root> <common dir> <out>` | 1, 2 | one `squeal daemon <root>` under `baseline.onStart: lookup-only`; polls the store for the scan, the first key rows and the completed `baseline` checkpoint; samples the process tree's RSS; stops it; lists processes naming the root | `out/runs.json` (`daemons`), `out/daemon-*.log` |
| (inline `node:sqlite`, see `out/quick-check.txt`) | 1 | `PRAGMA quick_check` on each store copy, as a daemon's open runs it | `out/quick-check.txt` |
| `fastpath.mjs <clone> <tip walk> <label>:<sha>[:<walk at X>]...` (env `ASKER`) | 4, 5 | from git objects only: which test files keep the tip's key at X (variants V0 to V5); checks each acceptance against the fresh-walk key at X | `out/fastpath-{sq,cz}.jsonl` (validated), `out/fastpath-curve-*.jsonl` (k = 1..50 from the tip), `out/fastpath-slide-*.jsonl` (10 askers) |

Labels: `sq` is Squeal, `cz` is squawk. Checkouts `a` = main tip, `c` = 1 back, `b` = 10 back, `d` = 50 back (first parent; `out/main-commits-*.txt`). Install timings: `out/install.txt`.
