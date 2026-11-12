# Probes for `left-out-files.md` (row 018-40)

Throwaway. Nothing here is product code or a test. Run on 2026-11-12 in
`$TMPDIR`, not in any repository checkout.

## Setup that was run

1. `gh run download 43188846583 --repo hearsay-tools/squawk` into `art/`
   (`squeal-parts-shard-1..8`, `squeal-results`). Read-only.
2. A shallow clone of `hearsay-tools/squawk` at
   `cc3cead4b816910280bfc6633348cbe59cd74e5d` (the run's `headSha`), then
   `pnpm install --frozen-lockfile` (pnpm 12.11.2, Node 26.13.0), the same
   steps as the CI export job. No build.
3. Squeal 0.1.443 (the version in the run) from
   `git archive v0.1.443 plugins/claude-code/dist`, with three patches. Each
   only writes a debug file and changes no result:
   - `dist/cli/squeal.mjs`, `uncertifiedLines`: when
     `SQUEAL_PROBE_UNCERTIFIED` is set, write every left-out file and its
     inputs as JSON (the CLI prints only 3).
   - `dist/cli/squeal.mjs`, `startRecording().close`: when
     `SQUEAL_PROBE_KEEP` is set, copy the raw evidence directory before it
     is removed.
   - `dist/ci/evidence.cjs`, `written`: when `SQUEAL_PROBE_TRACE` matches a
     written path, write the call stack to `SQUEAL_PROBE_TRACE_OUT`.
4. `HOME` set to an empty directory under `$TMPDIR`, `CI=true`.

## Runs

- Replay of the export:
  `squeal ci export --parts art/squeal-parts-shard-* --out replay.json.gz`
  in the clone. Same counts as CI (1484 files, 24272 results, 150 + 31 left
  out); the 1484 keys and the environment hashes equal CI's
  `squeal-results.json.gz` exactly.
- `classify.mjs uncertified.json art squawk > pairs.json`: per left-out
  (file, input) pair, the input's kind here (tracked, missing), its value in
  the file's own shard evidence and in the other shards, and whether the
  file's own observed reads hold it.
- `recover.mjs pairs.json art`: per file, its causes and the files and test
  seconds each fix would recover. Output is in `left-out-files.md`.
- `causes.tsv`: the 150 files, their shard and causes (from the same rules
  as `recover.mjs`).
- Three single-file recorded runs in the clone, `squeal ci record --out
  recN -- node_modules/.bin/vitest run --project <p> <file>`:
  `harness-autosave-settlement.test.ts` (rec1: the pi extension scripts are
  in the test's observed reads but in no evidence line and no write line),
  `command-palette.test.tsx` (rec2: none of its 84 left-out inputs is read
  or observed), `cursor-print-runner.test.ts` (rec3, rec4 with the trace:
  `unlinkSync` of a symlink in a temp directory marks
  `mock-cursor-print.mjs` written; 31 child processes read it unchanged).

The clone, the artifacts and the patched bundle were removed after the runs.
No daemon was started.
