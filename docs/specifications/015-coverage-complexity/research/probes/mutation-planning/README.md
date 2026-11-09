# Probes for research/mutation-planning.md (row 015-125)

Throwaway. Written 2026-11-09 for `../../mutation-planning.md`. Nothing here is product code or maintained.

## Rules these probes kept

- cezar was read only. Its Squeal stores were read from copies taken with `-wal` and `-shm` (`store.sqlite`, `code.sqlite`, 2026-11-09 13:29Z). Stryker ran only in a scratch clone of cezar at `7b726e2a2` under `/tmp/mp125`, at nice 10, concurrency 4, with `HOME`, `XDG_CONFIG_HOME`, `XDG_RUNTIME_DIR` and `TMPDIR` under `/tmp/mp125/home`.
- Question 5 ran its own Squeal daemon (this worktree's committed `plugins/claude-code/dist`, 0.1.419) in a scratch repository under `/tmp/mp125/q5` with the same four variables there. It was stopped with `squeal stop`, and `/tmp/mp125` was deleted at the end. No live daemon socket or live store was opened.
- No Squeal build ran. No package was added to this repository.

## Files

| File | What it does |
|---|---|
| `records.mjs <store dir> <out.json>` | Decodes the newest coverage record of each test file (manifests and shared parts) into an index: per product source, the test files whose record names it, the blob, "called" (a function other than the module top level ran), function spans with hits, covered lines |
| `compare.mjs <art> <runs.txt> <index.json> <cezar> <out.json>` | Per PR (newest run per branch with a Stryker report or a cap skip) and package: `related` from the artifact, Stryker's dry-run and covering test files, Squeal's loaded and called sets, and per-mutant checks where the record's blob equals the PR head's |
| `related.mjs <in.json> <out.json>` | cezar's `mutants-related.mjs`, listing files: Vitest `related` at the scratch copy's revision; runs no test |
| `q1.mjs`, `funcs.mjs` | Question 1 at one revision: related now against Squeal's file-level sets (`q1.mjs`), and per changed named function, using cezar's own `parseDiff` and ast-grep `functionRanges` (`funcs.mjs`) |
| `detail.mjs`, `q3.mjs` | Questions 2 and 3 from stored reports: killed mutants with no killer in Squeal's set, covered pairs Squeal records as not called, and `NoCoverage` against Squeal's per-function "no test runs it" |
| `run-q2.sh <A\|B\|C> <set>` | One Stryker run: A = `related` (the job), B = Squeal's "called" files, C = related minus called, B and C through `testFiles` with `vitest.related: false`; notes the tree's CPU when the dry run ends (`cpu-tree.mjs`) |
| `run-q5.sh <label> <inPlace>` | One Stryker run in the scratch repository beside a serving daemon; daemon CPU, store rows added (from store copies) |
| `q5-fixture/` | The scratch repository's files (its `.gitignore` is the last variant, without `.stryker-tmp/`; `calc.test.ts` is the slow variant) |
| `results/` | The outputs the report quotes: `q1.json`, `funcs.json`, `compare.json`, `detail.json`, `q3-output.txt`, `q2-summary.txt`, `q2-B-web-mutants.json`, `q2-sets2.json`, `q5-*.json`, `runs.txt` (the 530 successful mutation-report runs listed by `gh run list`) |

## Re-running

```sh
S=/tmp/mp125; mkdir -p $S/stores $S/art
C=$(git -C ~/projects/cezar rev-parse --path-format=absolute --git-common-dir)/squeal
cp $C/store.sqlite* $C/code.sqlite* $S/stores/
gh run list -R hearsay-tools/cezarion --workflow mutation-report.yml --limit 2000 --status success --json databaseId,headBranch,createdAt,displayTitle,headSha  # -> runs.txt as in results/
# download each run's mutation-report artifact over 2 kB: gh run download <id> -n mutation-report -D $S/art/<id>
node records.mjs $S/stores $S/index.json
node compare.mjs $S/art runs.txt $S/index.json ~/projects/cezar $S/compare.json
git clone -q ~/projects/cezar $S/cezar && git -C $S/cezar checkout -q 7b726e2a2 && (cd $S/cezar && pnpm install --frozen-lockfile && npm run build:server)
# related-in.json: [{ id: <row index in compare.json>, pkg, files: <the row's fileList, files that exist in the clone> }]
P=$PWD; (cd $S/cezar && node $P/related.mjs ../related-in.json ../related-now.json)
node q1.mjs $S/compare.json $S/related-in.json $S/related-now.json $S/index.json $S/cezar $S/q1.json
(cd $S/cezar && node $P/funcs.mjs ../compare.json ../index.json $P/results/runs.txt ~/projects/cezar ../funcs.json)
node q3.mjs $S/compare.json $S/art $S/index.json ~/projects/cezar
```

Clean up: `squeal stop` in the scratch repository with its environment, then `rm -rf /tmp/mp125`.

## Known limits

- Squeal's sets come from the newest record per test path over every cezar worktree, recorded 2026-11-09 08:34 to 13:23Z; the PR reports are from 2026-10-26 to 11-01. Per-mutant checks use only files whose bytes at the PR head equal the record's blob (929 of 4,659 mutants).
- `funcs.mjs` joins a changed function by name; a V8 function matches its span by end line and a start line equal or one before. Module-level changes are left out of the function-level count, as `ignoreStatic` leaves static mutants out.
- `run-q2.sh C web` was stopped for the CPU budget before Stryker wrote its report.
