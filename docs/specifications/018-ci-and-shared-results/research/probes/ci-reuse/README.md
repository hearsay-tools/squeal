# Probes for topic ci-reuse (row 018-04)

Throwaway. Nothing here is product code or a test; delete it once spec 018 is decided.

Run on this host on 2026-11-01 with Node 24.22.1 and git 2.43.0. No test ran in cezarion or in this repository, no daemon was started and nothing was timed on this host. GitHub was read only (`gh api`, `gh run view --log`, `gh pr list`). Store copies were taken with `cp` of `store.sqlite` and `store.sqlite-wal` into `$TMPDIR`, checked with `pragma quick_check`, opened read-only and deleted afterwards. The cezarion clone was a fresh blobless clone of `hearsay-tools/cezarion` under `$TMPDIR`, deleted afterwards.

| Script | What it does |
|---|---|
| `ci-times.mjs <dir>` | Wall time, job time, test-step share, queueing and re-runs of cezarion's `ci.yml`, from `runs.jsonl` and `jobs/<id>.json` that `gh api` returned. Output: `results/ci-times.json`. |
| `file-times.mjs <shard>=<log>...` | Per-file times and shard of each cezarion test file from the job logs of run 41291671624 (main push, 2026-11-01). Output: `results/times-run41291671624.json`. |
| `same-key-cez.mjs <repo> <store copy> <pairs> <times>` | Which cezarion test files keep their Squeal key between two commits. Extends `../ci-run/same-key.mjs`: listed directories, per-project environment files. `E2E_IGNORE_TESTS=1` is a what-if for cezarion's declared inputs. Outputs: `results/prs.jsonl` (50 merged PRs), `results/intra-pr.jsonl` (55 later pushes of one PR), `results/prs-e2e-ignore-tests.jsonl`. |
| `wall-model.mjs <jsonl>` | Turns a replay into a heavy-phase wall-time estimate for cezarion. Inferred model; its header names every assumption. `OVERHEAD_S` adds an unmeasured per-job cost. Outputs: `results/wall-model*.json`. |
| `same-key-fixed.mjs` | `../ci-run/same-key.mjs` with `FIX_VERSION=1` (a `package.json` that differs only in `version`) and `FIX_SETUP=1` (setup closure without `src/core/types/`). Outputs: `results/squeal-landings-v<0|1>-s<0|1>.jsonl`, summed in `results/squeal-landings-summary.txt`. |
| `setup-closure.mjs <repo> <rev> <esbuild>` | This repository's globalSetup closure after esbuild strips TypeScript, as Vite does. Output: `results/setup-closure-HEAD.json`. |
| `squeal-ci-times.mjs <dir>` | `ci-times.mjs` for this repository's `ci.yml`. Output: `results/squeal-ci-times.json`. |

Other outputs: `results/pairs-prs.json`, `results/pairs-intra-pr.json` (the commit pairs), `results/cezarion-reruns.txt` and `results/cezarion-failed-jobs.txt` (test jobs that ran more than once on one SHA), `results/times-squeal-run41226020041.json` (per-file times of this repository's Node 22 shards, the run 018-01 used).
