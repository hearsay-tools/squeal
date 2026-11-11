# 018-34 notes: status names a Squeal mismatch with CI (D21)

## Seam map

- Daemon notes (`DaemonNote`, `src/core/notes.ts`) reach status only in `--full` (`status-detail.ts`, `notesLines`), at most 20 per worktree. A refused export makes no import record, so the D21 line cannot come from `readImports`.
- The reader (`src/core/shared/reader.ts`, `#take`) now sends a key-format refusal to `#refused`. That method writes one per-worktree record (`src/core/shared/refused.ts`, meta row `shared-refused:` in `WORKTREE_META_ROWS`) and logs the old text. It writes no note. Other refusals (decode error, header commit) stay notes.
- The record is cleared in the import's `try`, before `importResults`: an export that passes `importRefusal` has this Squeal's format, so the mismatch no longer holds even if the import fails.
- Status: `snapshot.ts` `importsOf` adds `squealMismatchOf(store, worktreeId)` to `shared` (only with `shared.ref`). `format-status.ts` prints `squealMismatchLines(result.shared, full)` after the D19 Node line.
- `transfer-import.ts`: `otherKeyFormat(bundle)` gives CI's `{ version, keyFormat }`; `importRefusal` keeps its string for `squeal import`.

## Decisions the spec did not settle

1. A record, not a note. Notes are a bounded log: other notes can evict one, and a note cannot be cleared when the formats match again.
2. Status shows the record only while its `here.keyFormat` equals the status's `KEY_FORMAT_VERSION` and `ci.keyFormat` differs. A record from a daemon of an older or newer format says nothing; the next daemon fetches again at start.
3. `--full` appends `CI's export of <commit8> has key format X; this Squeal's is Y.` to the same line, so the fact is shown once in both views. The `More:` line does not name it.
4. Only `squeal status`: hooks and the session primer do not name it.
