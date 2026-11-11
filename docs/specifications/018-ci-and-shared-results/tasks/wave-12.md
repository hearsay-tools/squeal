# Spec 018 wave 12: status reports shared results correctly

The human, 2026-11-11: "Status fix: Yes" (row 018-32).

## 018-32 status reports the newest import, counts same-key results as matching, names only blocking differences

Use /worker. Shape: repair.

Outcome: in squawk's main checkout, default status names one line about shared results, from the newest import, and says how many of its files match this worktree, counting files where the local result already sits at the same key.

Evidence (`~/projects/cezar`, main 5b278bdc, Squeal 0.1.435, 34 imports, read-only `squeal status --full --json`): default status printed "Imported results from CI run 43073375295 ... at 0c0f1037: none current here, the environment differs (api-client: config fields allowOnly, browser, watch differ ...)". That import predates 0.1.431's re-key at import, so all 1,523 files stayed at CI's keys. The newer import of run 43088330004 at 67ae4684 has `sameKeyKept: 1440` of 1,523: the keys match, the local results were kept, and status counts that as "none current from the import".

Read: `spec.md` D5, D10, D11, D15, D19; `src/core/status/imports.ts`, `import-lines.ts`, `node-mismatch.ts`, `format-status.ts`, `src/core/types/status.ts`.

Items, each with a failing test first:
1. Default status talks about the newest import only (by import time or commit order, say which); older imports stay in `--full`.
2. Its count is "N of M files match this worktree", where N counts files current from the import and files whose local result sits at the same key (`sameKeyKept`); the wording no longer says "none current" when keys match.
3. Environment differences listed are only those that block after D10's tolerance (use `importDifferences`, not `describeDifferences`); a field D10 accepts is never named.
4. The D19 Node line (row 018-31) keeps working and is not duplicated.

Owns: `src/core/status/*` import lines and their tests. Leave alone: `src/core/shared/*`, `src/core/node-pin.ts`, the daemon.

Done when: status tests reproduce the squawk case (an old un-rekeyed import plus a newer one with same-key results) and show the new line; lint, typecheck, `squeal status --wait 60000` on changed paths. No build, no full suite.
