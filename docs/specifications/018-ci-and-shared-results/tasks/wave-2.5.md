# Spec 018 wave 2.5: review repair

## 018-09 import status counts follow adopted states

Use /worker. Shape: repair, on the candidate `cand/0.1.417`.

Outcome: status never calls a file current from an import unless the daemon's current known state for it is that import's result.

Read: `reviews/wave-1-2.md` B1 and N1 (with the reproduction and "Inputs for the repair"); `spec.md` D5 as amended 2026-11-08; `tasks/018-07/notes.md`.

Starting seam: `src/core/status/imports.ts` `reasonOf` (about line 65) and the file count near line 94; text in `src/core/status/import-lines.ts` (about lines 27 and 41). First edit offered as a lead: a failing test in `test/status/import-reasons.test.ts` for the review's reproduction (local `fail` at key K, import a pass at K, status must not count it current from the import and must name "same key, another result kept").

Owns: `src/core/status/imports.ts`, `import-lines.ts`, `import-environment.ts`, the import parts of `src/core/types/status.ts`, `test/status/import-reasons.test.ts`, `test/cli/transfer.test.ts` if a command-level fixture is needed.

Leave alone: the import writer (`src/core/store/transfer*.ts`, `imports.ts`): it stays add-only and never replaces a local result; any key input; `test/keys/key-format.test.ts`.

Done when: fixtures for a kept local failure, a kept local pass, two imports with equal keys, the time before daemon adoption, and a mixed environment/content default line pass; `--full` and `--json` counts agree with adopted states; the existing D5 order and silence tests still pass; `squeal status --wait 60000 <changed paths>` current and passing; lint and typecheck clean. Do not run `pnpm run build`; the coordinator rebuilds. Final message: the new `status --full` lines for the kept-failure fixture.
