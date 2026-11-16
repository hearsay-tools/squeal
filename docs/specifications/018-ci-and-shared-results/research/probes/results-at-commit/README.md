# results-at-commit probes: throwaway

Throwaway scripts for `../../results-at-commit.md`. Not product code; do not import them.

Every script opens a live store read-only (`new DatabaseSync(path, { readOnly: true })`, `PRAGMA query_only`) and reads git with `log`, `ls-tree` and `ls-remote` only. None starts or stops a daemon, runs `squeal`, fetches, or writes in a checkout. Large intermediate files (the result dumps, a scratch SQLite file) stay in `$TMPDIR/rac/` and are removed after the run. They ran on 2026-11-16 between 15:05Z and 15:30Z (`now` = 1794842001446, 15:13Z) at a one-minute load of 26 to 30 on 24 CPUs, so no timing is reported. `dump.mjs` first marked imported rows by the bare import id; the fix (`import:` prefix) came after the cezar dump, and only `labelOrigins` in `out/label-cezar.jsonl` depends on it.

Stores: `~/projects/squeal/.git/squeal/store.sqlite` (Squeal, 2.6 GB) and `~/projects/cezar/.git/squeal/store.sqlite` (squawk, 4.2 GB).

| Script | Question | What it does | Output |
|---|---|---|---|
| `q.mjs <store> "<sql>"` | all | one read-only query | `out/ages.txt` |
| `dump.mjs <store> <out>` | 1 | results grouped by (commit label, project, test path, key, dirty, worktree) | `$TMPDIR/rac/*.jsonl` (not kept) |
| `lib.mjs` | 1, 4 | git trees, the store's closures, and the content proxy (closure blobs, environment runner files, lockfile, Node pin file) | none |
| `label.mjs <repo> <store> <dump> <ref> <since> 40 60 <now>` | 1 | 100 main commits: what `commit_sha = X` finds against the listed test files at X, and why the rest differ | `out/label-squeal.jsonl`, `out/label-cezar.jsonl` |
| `import-labels.mjs <store> <dump>` | 1 | per import: the label rows at each imported key carry now | `out/import-labels-cezar.jsonl` |
| `blobs.mjs <store> 6` | 2 | stored file hashes against `git ls-tree` of the worktree's `HEAD` | `out/blobs-*.jsonl` |
| `disk-only.mjs <store> <worktree>` | 2 | hashed paths not in git, and closures that name one | `out/disk-only-*.json` |
| `seen.mjs <repo> <store> origin/main <since>` | 3 | main commits a daemon had as a clean revision head | `out/seen.jsonl` |
| `history-size.mjs <dir> <files> 100 <rate>` | 3 | bytes per commit of a key history in a scratch SQLite file | `out/history-size.jsonl` |
| `reuse.mjs <repo> <store> origin/main <since> 40` | 4 | 40 main pairs per distance 1, 10, 50: content proxy equal, or the first part that breaks it; real keys from imports | `out/reuse-*.jsonl` |
| `agree.mjs <repo> <store> origin/main <since>` | 4 | the proxy against real imported keys, file by file | `out/agree-cezar.json` |
| `tree-of.mjs` | 2 | `git ls-tree` helper | none |

`refs.mjs <repo>` (question 5) reads `git ls-remote origin 'refs/squeal/*'` on stdin: which of the last 200 first-parent main commits have a CI export ref; output `out/refs-cezar.json`.
