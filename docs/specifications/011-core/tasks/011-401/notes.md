# 011-401 notes: a partial selection says it is partial

Wave 122 W3b, shape repair, after 011-398. Issue #242 (the selection audit: `squeal status <source path> --json` gave 688 / 1 / 1 files at one revision, the short ones with `selection.reason: "unsynced"`).

## What changed

- `selectionPartial(read)` in `src/cli/verdict.ts` decides whether the read that ended a named wait or snapshot may hold an incomplete list. It returns `null` (complete) for a fixed selection (`fixedSelection`, row 011-398: every named path is a listed test file). Otherwise:
  - `unlisted` (the runner has not listed the revision, or an install is awaited): partial, at the verdict's revision.
  - `unsynced` (the daemon's pass over the edits made before the read is not stored at the read's revision, by the same `unsynced` rule the verdict reads): partial, at the pass's revision when the daemon is synced, else `null` (not known).
  - A wait counts a daemon that cannot sync as reached, as `selectionResult` does; a snapshot does not.
- `withPartial(selection, verdict, sync, snapshot)` sets the additive `NamedSelection.partial: { revision: RevisionNumber | null }` (`src/cli/named-selection.ts`). The named wait (`src/cli/wait/named.ts`) and the snapshot (`src/cli/wait/snapshot.ts`) set it on the selection they return.
- Plain text (`src/cli/named-path-lines.ts`, `namedPathLines`): when partial, the first line after `Selected:` is `Selection: at least N test files; the list is partial while Squeal catches up with revision R`. When R is not known, it is `your latest edits`. With no file selected so far, it is `Selection: no test file yet; …`. The per-path lines then say `it selects at least N test files that read it` in place of `it selects the N test files`. `Selection:` does not match the evals parser's `^Selected: ` (`evals/lib/squeal-text.mjs:310`).
- JSON writer: `src/cli/named-print.ts`, `printNamed`, the `NamedWaitPayload` of the `selection` field (and the same object under `wait` or `named`). It gets `complete: boolean`, which is `false` exactly when `partial` is set. Additive; it sits after `paths`.
- Help text: `src/cli/main.ts`, `squeal status <path>...`: "selection.complete false while the list may still grow (the text says "at least")".

Files outside W3's named ownership (accepted by the coordinator, 2026-11-19): `src/cli/wait/named.ts`, `src/cli/wait/snapshot.ts`, `src/cli/named-selection.ts` (the additive `partial` type), `src/cli/named-path-lines.ts`, `src/cli/main.ts` (help). The JSON field is `selection.complete`, as briefed. `NamedSelection.partial` is in memory only, between the read and the writers, and never reaches the JSON (`printNamed` writes `paths`, not the selection object).

`namedText` (`src/cli/status-wait-lines.ts`, W4's file) is not changed. It already prints `namedPathLines(wait.selection)`, so the new line reaches both the plain text and the `--json` stderr lines.

## Decisions the brief did not settle

- Where the text goes: one line after `Selected:`, and "at least" in each source path's line. The `Selected:` line itself is not changed, because the evals parser splits it into file names.
- A test-file-only selection is complete even while the revision is unsynced or unlisted. Each such path selects only itself (row 011-398's rule).
- R for `unsynced` with a pending pass is not known, so the text says "your latest edits" and the JSON gives no revision. The brief asked only for `complete`, so no revision field was added to the JSON.

## Tests

`test/cli/named-partial-selection.test.ts`:
- unlisted, source path: the `Selection:` line, "at least" in the path line, JSON `complete: false`, and the line on `--json`'s stderr.
- unsynced, the pass stored at a later revision: the line with that revision, `complete: false`.
- unsynced snapshot with the pass pending: "no test file yet … your latest edits".
- complete: a source path at a listed, synced revision, and test files during a listing. No line, "it selects the 1 test file", `complete: true`.
- `selectionPartial` by case, including a daemon that cannot sync (a wait counts it as reached, a snapshot does not).

`test/cli/wait-again.test.ts`: the key-order check now lists `complete`.

## Spec amendment proposed (plain text; the coordinator lands it)

005 D2, after the 011-398 amendment:

> Amended 2026-11-19 (the human, row 011-401, gh-242): while a wait's or snapshot's list may be incomplete (the revision is not listed, or the daemon's pass over the edits before the read is not stored) and a named path is not a listed test file, the text says "Selection: at least N test files; the list is partial while Squeal catches up with revision R" and gives each source path's count as "at least N", and the JSON's `selection.complete` is `false`; it is `true` otherwise.

No key-format or validity change.
