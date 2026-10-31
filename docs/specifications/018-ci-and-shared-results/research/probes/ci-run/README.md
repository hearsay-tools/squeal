# Probes for topic ci-run (row 018-01)

Throwaway. Nothing here is product code or a test; delete it once spec 018 is written.

All runs were on this host on 2026-10-31, Node 24.22.1, git 2.43.0, Linux x64, with the Squeal CLI bundle of commit 6053220eb (`plugins/claude-code/dist/cli/squeal.mjs`, version 0.1.387). One-minute load average 8.6 to 11.2 on 24 CPUs. No test of this repository ran.

| Script | What it does |
|---|---|
| `fixture.sh <dir>` | Builds a small Vitest 5.0.3 repository (two passing test files, one failing) as a bare `origin.git`. Vitest is copied from the e2e harness's install cache `/tmp/squeal-e2e-cache`. |
| `ci-like.sh <dir> <squeal.mjs> run\|warmup` | A CI-like job: depth-1 clone, detached HEAD, `env -i`, `CI=true`, no git identity, no `XDG_RUNTIME_DIR`, read-only HOME. Runs `run --all --wait` before any daemon, `start`, `run --all --wait`, `status --json`, `stop` (or `warmup`, `stop`). |
| `cache-restore.sh <dir> <squeal.mjs>` | Saves the store, deletes the clone, clones again at the same path and restores the store, as `actions/cache` would. Then `run --all --wait`. |
| `ci-flag.sh <dir> <squeal.mjs>` | The same clone and store with `CI` unset. |
| `file-times.mjs <log>...` | Per-file times from GitHub job logs (`gh run view --job <id> --log`). |
| `same-key.mjs <repo> <store copy> <pairs.json> [times.json]` | Estimates which test files keep their key between two commits from git and a read-only copy of the store. Its header says what it models and what it does not. `NO_SETUP=1` leaves the globalSetup closure out. |
| `setup-diff.mjs <repo>` | Which globalSetup-closure files changed in the four landings that changed the environment. |

`results/` holds the outputs the findings cite: `run.log`, `restore.log`, `ci-flag.log`, `warmup.log`, `status-run.json`, `landings.jsonl` and `landings-nosetup.jsonl` (20 landings), `failures.jsonl` (4 CI failures), `times-node22-summary.json` (run 41226020041), and `total.cjs`, which sums the landing lines.

The store copy was taken with `node:sqlite`'s `backup()` from a read-only connection to `<common dir>/squeal/store.sqlite` into `$TMPDIR`, and deleted afterwards. Every clone and daemon these scripts started was stopped and deleted; `pgrep` found none left.
