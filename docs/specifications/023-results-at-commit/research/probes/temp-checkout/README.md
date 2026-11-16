# temp-checkout probes: throwaway

Throwaway scripts for `../../temp-checkout.md` (row 023-01). Not product code; do not import them.

They ran on 2026-11-16 between 15:43Z and 16:08Z, on 24 vCPUs, at a one-minute load of 9.5 to 35.2 (each output names its own). Every checkout was a detached `git worktree add` in a clone under `$TMPDIR/tc` (`git clone --local --no-checkout` of `~/projects/squeal` and `~/projects/cezar`, read-only on the originals), so each clone had its own store. Stores were read from `VACUUM INTO` copies in `$TMPDIR/tc/stores`. Tests and gate runs ran with `HOME` set to a scratch directory and `timeout 600`. No daemon was started. Every worktree was removed (`out/remove.txt`), `$TMPDIR/tc` was deleted (8.4 GB with the store copies and cold caches), and the gate's leftover folders in `$TMPDIR` were deleted after they were listed. A warm install writes to the user's pnpm store (`~/.local/share/pnpm/store/v11`); it added nothing (`reused 321`, `reused 702`).

| Script | Question | What it does | Output |
|---|---|---|---|
| `measure-install.sh <label> <clone> <commit> <pnpm\|npm> <warm\|cold> <scratch>` | 1 | times `git worktree add --detach` and a frozen install; network from `eth0` receive bytes (15 s background sample first); disk as node_modules bytes with link count 1 against hard-linked bytes; cold = an empty `--store-dir` plus `XDG_CACHE_HOME` (pnpm) or `--cache` (npm) | `out/install-*.txt` |
| `ignored-inputs.mjs <store copy> <checkout>` | 2 | test files at X whose stored closure or observed reads name a path X's tree lacks and git ignores | `out/ignored-inputs-*.json` |
| `concurrency.mjs <store copy> 7` | 3 | how much of the last 7 days' test-run time had runs of two or more worktrees at once | `out/concurrency.jsonl` |
| `kill-probe.sh <checkout> <scratch> <TERM\|KILL>` | 4 | starts a gate run, sends the signal once test processes run, lists processes with the checkout in their arguments then, 5 s and 30 s later; the file list comes from `$FILES` | `out/kill-sigkill.txt` |
| `overlay-imports.mjs <repo> <ref> 200 <test regex>` | 7 | for 200 first-parent commits, each added or changed test file: does each relative static import exist at the parent? Kinds: only test-side files missing, or a source file. Its last run read the original repositories with `git log`, `diff-tree`, `show` and `cat-file` only (the clones were already deleted) | `out/overlay-imports-*.txt` |
| `durations.mjs <store copy> <checkout> [excluded projects]` | 6 | per test file at X, the summed test durations of its newest stored run; wall time for a share of files at width 4 and 12 | `out/durations.jsonl` |

Gate runs, the SIGTERM probe, `squeal ps` after a kill and the overlay run were typed commands; their output is in `out/gate-runs.txt`, `out/ps-after-kill-summary.json` and `out/tmpdir-leftovers.txt`.

Known limits:

- `measure-install.sh` reads the host's whole `eth0` counter. The background sample was 0.2 to 5.6 MB per 15 s; a 6 s install carries at most about 2 MB of it.
- `overlay-imports.mjs` reads imports with a line-start regex. It misses dynamic imports and can still catch a fixture line inside a template string. It does not follow bare package names.
- `durations.mjs` sums test durations; it leaves out each file's setup and transform time, so its totals are a lower bound. Its "share" picks files evenly along the sorted list, which is an assumption about which files are missing.
