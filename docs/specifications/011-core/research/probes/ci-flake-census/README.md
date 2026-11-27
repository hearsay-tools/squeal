# CI flake census probes (row 011-428)

Throwaway. Nothing here is product or test code; delete when the repair rows land.

| File | What it is |
|---|---|
| `runs.csv` | The 1,230 `ci.yml` runs on `main` and `cand/**` from 2026-10-27 00:08Z to 2026-11-27 18:39Z (`gh run list --workflow ci.yml --json ...`), the 2026-11-17 11:24Z re-run of 334 old branches left out. |
| `fetch.mjs` | For every run that failed or took more than one attempt: the jobs of each attempt, and each failed job's check-run annotations (the log only when a job has none). Network only, six `gh` calls at a time. `node fetch.mjs <scope.json> <cache-dir> > failures.jsonl` |
| `analyze.mjs` | Joins the failed jobs with every run of the same commit. `node analyze.mjs <scope.json> <cache-dir> <failures.jsonl> > census.csv` |
| `census.csv` | One row per failed test: run, attempt, commit, job (Node version and shard), file, test, first error line, and the same job's passes on the same commit (`same_commit_passed`). |
| `classify.py` | The cause groups as file and test patterns; prints rates per group, the last seven days, and jobs where several timing files failed together. `python3 -I classify.py <scope.json> census.csv > groups.txt` |
| `groups.txt` | Its output, as quoted in `../../ci-flake-census.md`. |
| `board-runs.txt` | The CI run ids the board's `ci-*` rows cite; those runs stay in the census even when three or more jobs failed. |
| `store-process-sigterm/` | The reproduction for row ci-46051074967: `probe.ts` repeats the test's steps; `hold-after-serving.mjs` holds the store process's main thread for 1.5 s right after its `serving` line (`Atomics.wait`, no CPU work); `output.txt` is one run per case on Node 26.13.0 and 22.19.0. Run from the repository root: `node --import tsx docs/specifications/011-core/research/probes/ci-flake-census/store-process-sigterm/probe.ts hold\|late\|at-once`. |

Notes on the method:

- Annotation paths name the file the error was thrown in (a helper); `fetch.mjs` takes the test file from the annotation title instead, and drops annotations under `test/fixtures/`: a fixture's own Vitest inherits `GITHUB_ACTIONS` and annotates its planted failures.
- `same_commit_passed` needs a pass of the same job on the same commit. Runs never fetched (green on attempt 1) count as a pass of every push job.
- Raw logs (204 MB) stayed in the session's scratch folder; they are not committed.
