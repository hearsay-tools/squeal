# 018-44 notes: an import stays usable for every worktree whose environment matches CI's

Worker 06a2884d, 2026-11-12. Brief: `tasks/wave-18.md`, row 018-44. Evidence: `research/live-saving.md` Q3.

## Seam map

- `src/core/shared/reader.ts`, `#pass`: `held` is the commits of every import in the shared store. The D21 refusal check still uses the nearest held commit (`reach`), as before. New: `servesHere` (`src/core/shared/served.ts`) asks whether the nearest held commit's imports serve this worktree. When they do not, the loop tries that commit too (`candidates.slice(0, reach + 1)`): nearer exports first, as before, then the held one, fetched once and imported for this worktree.
- Re-keying is per importing worktree (`transfer-rekey.ts`, `localHash`): the worktree's environment hash for each project when D10 finds it equal to the export's, else the exported key. `rekeyedHash` is that rule, now exported, so `servesHere` asks the same question of the hashes an import's files went at.
- `import_files` holds one row per (import, file): the key and environment the results went at. Its `environment` column is how the store knows which environment an import serves (`importEnvironments` in `imports.ts`, one `DISTINCT` query over the commit's imports).
- `importIdHere`: the first import of a file keeps today's id (`fileHash[0..16]`, as `squeal import` names it). A later import of the same file by another environment gets `sha256(fileHash, the worktree's environment hashes)[0..16]`. Each environment keeps its own `imports` and `import_files` rows, so status (D5, `src/core/status/imports.ts`) reads each worktree's keys correctly. No `src/core/status/*` change.

## When a held export serves this worktree (no fetch)

In this order, per the commit's imports:

1. One of them has this worktree's own id in its present environments (`ownId(fileHash, environments)`). This stops a repeated fetch when the D10 check said "re-keys" but the import re-keyed nothing (for example, every file's proof failed).
2. Else, per project the imports hold files of: this worktree has no environment recorded for it; or a file went at this worktree's hash; or no hash a file went at re-keys to this worktree's under D10, read from the store's `environments` descriptor of that hash.

Otherwise the worktree fetches and imports for itself.

## Decisions the brief did not settle

1. **One import record per environment, not one shared record.** A second import of the same file under the same id would replace the first worktree's `import_files` rows (`INSERT OR REPLACE`), and status would then call the first worktree's current files "environment differs". With two worktrees that both match CI under different hashes, each restart would fetch and replace the rows again. A separate id per environment avoids both. Cost: `status --full` lists one line per environment for the same CI run; default status speaks of the newest import, as before.
2. **D10 check against stored descriptors.** The store does not record which hash was the export's own once a worktree re-keyed every file of a project. `servesHere` therefore checks each hash the files went at, CI's or a matching worktree's. When this worktree matches a matching worktree's descriptor under D10, it also matches CI's (`watch` and `coverage` are ignored both ways, `browser` only when both sides have it off, `allowOnly` only from false to true), so the fetch is not wasted; rule 1 bounds any other case to one fetch per file and environment. **Known miss:** CI rejects focused tests (`allowOnly` false), worktree Y allows them (true, a match) and re-keyed every file of a project, so no file stayed at CI's hash; worktree W rejects them as CI does. W matches CI but not Y's descriptor, so W is not served and does not fetch. A local daemon rejects focused tests only with `CI` set, so this should be rare. Closing it needs the export's own hash per import and project in the store (an additive table); not done.
3. **The CLI and the daemon's import request keep `fileHash[0..16]`.** `squeal import` of the same file in two worktrees still shares one id; out of this row's ownership (`src/cli/import.ts`, `src/core/daemon/import-request.ts`).
4. **No environment recorded yet** (a daemon whose start has not keyed): the export serves it (nothing better is possible now). At its next pass after the environment is recorded (next start point or restart), rule 2 decides again. The daemon starts the reader after `loop.start()`, which records environments, so this is rare.

## Tests

- `test/shared/import-each-worktree.test.ts`: two worktrees of one clone on one store. X (`pool` differs) imports first at CI's keys; Y (`watch` differs, D10-equal) then imports for itself and has every file current, no run. With the remote unreachable, restarts of X and Y and a third worktree in Y's environment reach no remote; the third has the results at its start. Second test: an export whose keys no worktree reproduces; Y fetches it once, and a restart does not fetch again. The second test fails without rule 1 (checked by removing it).
- `test/shared/daemon-kit.ts`: the CI run, publish and daemon wiring shared with `import-rekey.test.ts`, whose own copies it replaces.
