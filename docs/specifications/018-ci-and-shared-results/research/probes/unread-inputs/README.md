# Probes for `unread-inputs.md` (row 018-56)

Throwaway. Nothing here is product code or a test. Run on 2026-11-20 in this
task's `$TMPDIR` and, for one shard, in a work directory on a separate VM
that was deleted afterwards. No Squeal daemon was started anywhere.

## Setup that was run

1. `gh run download 44805319389` and `gh run download 44808547913`
   (`-R hearsay-tools/squawk`, read-only). For 44805319389 only the two
   node:test parts (`runner: "node-test"`) of `squeal-parts-node-test` were
   used beside the 8 shard dirs; its 26 nested Vitest parts are row 018-54's.
2. A blobless clone of `hearsay-tools/squawk` with worktrees at `cd8cea696`
   and `d5762f11`, each installed with `pnpm@12.11.2 install
   --frozen-lockfile` on Node 26.13.0, `HOME` in scratch, `CI=true`. No build.
3. Squeal: a copy of this branch's `plugins/claude-code/dist` (candidate
   0.1.580), with two patches that only write debug files:
   `uncertifiedLines` writes every left-out file and its inputs to
   `$SQUEAL_PROBE_UNCERTIFIED`; `startRecording().close` copies the raw
   evidence directory to `$SQUEAL_PROBE_KEEP` before removing it.

## Runs

- Export replays, as the CI job runs them: 44805319389 gives 1330 exported,
  568 left out for inputs (as row 018-55); 44808547913 gives 1163 and 583,
  equal to that run's own export log.
- `rules.mjs <uncertified.json> <checkout> <part dirs>` → `files-<run>.tsv`
  (per left-out file: runner, seconds, its pairs' kinds) and
  `summary-<run>.txt` (pairs per kind, files and seconds per candidate rule).
- `record-shard.sh <work> 3` on the VM: cezar's Vitest shard 3/8 at
  `d5762f11`, as its merge-group step runs it, with the raw evidence kept
  and `git status` before and after (526 s; 219 files, 1 failed on two
  35 s timeouts under load). `shard-writes.mjs` over it and the CI run's
  left-out list: 0 writes, 0 conflicting paths, all 339 left-out pairs
  untouched, status unchanged.
- `fixture.sh <scratch> <patched squeal.mjs> <node_modules with vitest>`:
  six one-test fixtures (Vitest from this repository's `node_modules`),
  each through `ci record` and `ci export`, then plain Vitest at the
  exported content, then `simulate.mjs` (the candidate rule over the raw
  evidence and the start and end hashes). Output: `fixture-output.txt`
  (absent resolution candidates trimmed).

The clones, artifacts, patched bundle and fixture trees stay in `$TMPDIR`
and are not committed.
