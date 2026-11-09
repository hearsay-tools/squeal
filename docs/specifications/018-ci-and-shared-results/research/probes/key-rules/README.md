# key-rules probes (throwaway)

Throwaway material for `research/key-rules.md` (row 018-15). These are not product code or tests. They read a **copy** of a Squeal store, never a live one, and run only `git` read commands on the repository they are given.

Inputs used: a copy of `~/projects/cezar/.git/squeal/store.sqlite` with `-wal` and `-shm` (taken 2026-11-09 12:20:25Z to 12:20:38Z), CI's export of run 42596322864 (`gh run download`, gunzipped to `export.json`), and `git ls-tree -r --name-only 721c19b0` of cezarion. All three were deleted after the counts.

- `q.mjs <db> "<sql>"`: one read-only query on a copied store (`node:sqlite`, `readOnly`).
- `union-extras.mjs <store copy> <export.json> <tree.txt> <out.json>`: per exported test file, the observed paths the store's shared union adds over CI's own run (`X`), the paths CI read that the union lacks (`M`), the kinds of `X` at the commit, and whether `X` moves the key. Output summary: `counts/union-extras-summary.json`; per file: `counts/union-adds-per-file.tsv`.
- `extra-paths.mjs <store copy> <export.json> <tree.txt>`: the union-only paths counted across files. Output: `counts/union-adds-top-paths.txt`.
- `reachable.mjs <repo> <commit> <export.json> <union-extras.json> <store copy>`: whether a file in CI's list names a union-only path's file name at the commit. A noisy heuristic (short names such as `claude` match unrelated text); only its examples are used. Output: `counts/reachable.txt`.
- `exposure.mjs <repo> <commit> <export.json> <store copy> <out.json> <commit>...`: for nearby main commits, how many files keep CI's list's content (`eqE`) and how many also keep the union-only paths' content (`eqL`). Output: `counts/exposure.json`.
- `node-env.ts <root> <node A> <node B>`: Squeal 0.1.419's `probeNode` and `projectEnvironment` for one node:test project under two Node executables, plus `process.versions` and `process.config` hashes. Run with `pnpm exec tsx` from this repository. `PATH=<dir>` leaves `node` unset and puts `<dir>` first on the daemon's PATH. Outputs: `counts/node-env.txt` (explicit paths), `counts/node-env-path.txt` (`node` unset, as in cezar's config).
