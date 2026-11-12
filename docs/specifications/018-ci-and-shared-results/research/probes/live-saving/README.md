# live-saving probes (row 018-39): throwaway

Throwaway scripts for `../../live-saving.md`. Not product code; do not import them.

Every script opens squawk's (cezar's) shared store read-only: `new DatabaseSync(path, { readOnly: true })`, or Squeal's own `openReadOnly` in `reasons.ts`. None starts or stops a daemon, runs `squeal`, or writes in `~/projects/cezar`. A read-only `node:sqlite` backup to `$TMPDIR` was tried and stopped: it restarted under the live writes. So the scripts read the live store, with a cutoff of 2026-11-12T14:45:00Z where a time bound matters.

| Script | What it reads | Output |
|---|---|---|
| `local.mjs <store> <runs-dir> <cutoff> <out.json>` | `runs` since 2026-11-05 and each run's `report.json` `fileDurations` (node:test runs: their surviving `file` check results) | `out/local-summary.json` (per window, per worktree and day); the per-file local medians stay in `$TMPDIR` |
| `imports.mjs <store> <local.json> <cutoff> <out.json>` | per import, what the store holds at each exported file's key | `out/imports.json` |
| `late.mjs` | the same, deduplicated by (file, key), by window | `out/late.txt` |
| `perimport.mjs` | per import: exported files, environments, keys looked up (`last_used_at` past the import time) | `out/perimport.txt` (no cutoff) |
| `rekey.mjs` | per import: files stored at a local environment (re-keyed, D11) or at CI's (`ci: true`) | `out/rekey.txt` (no cutoff) |
| `worktrees.mjs <store> <local.json> <cutoff>` | live worktrees: files by origin now, adoption revision, local runs | `out/wt.txt` |
| `reasons.ts <git-common-dir>` | Squeal's `readImports` (D5 counts) per live worktree; run with `pnpm exec tsx` from the repository root | `out/reasons.txt` (read 15:00Z) |
| `envdiff.mjs` | the newest import's server environment against each live worktree's | `out/envdiff.txt` |
| `q.mjs "<sql>"` | any read-only query | `out/environments.txt` |
| `snapshot.mjs <out-dir>` (row 018-45) | per checkout: file states by origin and import, adoptions, daemon version, local runs since the previous snapshot; imports present | `week/<UTC time>.json`, one a day; how to run it: `week/README.md` |

Paths to the store are hard-coded in the small helpers; they ran on 2026-11-12 between 14:48Z and 15:01Z.
