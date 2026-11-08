# 018-07 notes: export, import, the imported origin, status counts

Worker 5530f229, 2026-11-08. For whoever continues (018-08's trial, the transport slice).

## Where things are

| Part | File |
|---|---|
| Export file format, parser, D5 hashes | `src/core/store/transfer-bundle.ts` (`RESULTS_FORMAT`, `decodeBundle`, `listHash`, `observedHash`) |
| Export and import | `src/core/store/transfer.ts` (`exportResults`, `importResults`, `importRefusal`) |
| Their SQL reads | `src/core/store/transfer-rows.ts` |
| `imports`, `import_files` tables, readers, source label | `src/core/store/imports.ts` |
| Add-only meta helpers | `src/core/keys/observed.ts` (`readSharedEntries`, `addMissingEntries`) |
| Commands | `src/cli/export.ts`, `src/cli/import.ts` |
| Import mark, origin kind | `src/core/types/state.ts` (`importMark`, `importIdOf`, `originWorktree`) |
| D5 reasons | `src/core/status/imports.ts`; text in `import-lines.ts`; environment line in `import-environment.ts` |

## Decisions the spec left open

- Import id: the first 16 hex characters of the file's SHA-256. Importing the same file again adds nothing and keeps the first `imports` row.
- Provenance: `worktree_id` and `run_id` are both `import:<id>`; `revision` 0; `commit_sha` and `dirty` from the header.
- `known_states` stores an imported origin with `origin_kind` NULL and `origin_worktree` = `import:<id>`. A release before 018 reads `origin_kind` with `oneOfOrNull(own, inherited)` and would throw on a new kind; NULL reads as "no known origin". This release also reads any unknown kind as no known origin.
- The origin carries the import id and commit, not the source label. Readers look the label up in `imports` (`importSourceOf`, `WhyReport.importSources`, `TransitionEntry.originSource`).
- A key the store already holds results at keeps them; the import counts them as `alreadyStored`. So a file already run here stays `own` or `inherited`.
- `--dry-run` runs the same transaction and rolls it back, so its counts are the import's.
- `squeal import` makes the store when it is missing (an import must work before any daemon).
- After the import it sends `retry` to every daemon the store records. That does not itself adopt the keys; each daemon adopts at its next reconciliation pass (30 s) or tier selection (`StoredKeys`).
- Export counts three reasons a file is left out: no key or a pending one, no result at the key, a failure at the key.
- D5's "observed set" hashes all three per-file maps (`observed`, `observedDirect`, `observedModules`): each can change a key through the runtime-file classification.
- D5 counts only exported files this worktree lists (a `test_file_keys` row); a listed file with a NULL key is "no local key yet".

## Facts found on the way

- An observed path that does not exist does not change a key: the round-trip test needed an existing file in the observed entry to make the key differ.
- Each file in the scheduler fixture stores two results (its file check and its test).
- `imports` and `import_files` are never pruned. One row per exported file per import; a daily import would grow them. Prune them with their results in a later slice.
- `src/harness/shared/test-command-reason.ts` names inherited sources only; it ignores imported ones (not this row's file).
