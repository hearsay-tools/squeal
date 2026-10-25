# 011-206 notes (wave 39 W2, worker b087c35b)

A selection says its verdict and why it has none (gh-88, gh-84, gh-83). Contract agreed in request 5cac9813 (the coordinator, 2026-10-25).

## What landed

- `selectionResult` (`src/cli/verdict.ts`) takes what a named wait's or snapshot's last read saw (`SelectionRead`) and gives `{ result: "pass" | "fail" }` or `{ result: "none", reason }`. `resultCode` turns it into 0, 1 or 3. `namedResult` (`src/cli/status-wait-paths.ts`) builds the input from an ended `NamedWait`; `namedCode`, the JSON payload and `namedLine`'s none clause read it.
- Reasons, in precedence order: `no-daemon`, `lapsed`, `on-hold`, `paused`, `focused`, then `unsynced`, `unlisted`, `pending`, `not-current`, then `not-run` and `unmatched` (these two only when the files pass; a known failure stays `fail`).
- `verdictCode` and `noVerdictText` now read one private `classReason` (unlisted, pending, not-current), the same one `selectionResult` reads.
- JSON, additive in both forms (`selection`, and `wait` or `named`): `result`, `reason` (only with `none`), `paths` (`{ path, kind, selects }` per named path, `kind` one of `test-file`, `source`, `not-run`, `unmatched`). No `schemaVersion` change.
- `NamedWait.lapsed` (additive): the wait's last read found `WaitLiveness` `lapsed` (stale heartbeat with a live socket, or a handoff under way). Set by `livenessOf` beside `down`.
- `NamedSelection.paths` (additive, optional): set by `selectNamedFiles`.
- `notRunTestFile` (`src/cli/retry-unlisted.ts`): a path no listed test file has, with a test file's name (`testFileName`: a node:test or pytest project's `include`; with Vitest, Vitest's default include in brace form or policy `vitest.exclude`), that `unkeyedPath` reads as `other` (exists, the listing covers it). `mayList` now takes the policy as an argument; `notKeyed`'s output did not change.
- Text: `Selected:` is unchanged, since `evals/lib/squeal-text.mjs` `selectedOf` splits it by `, `. `namedPathLines` (`src/cli/named-path-lines.ts`) adds one line after it per non-test path that selects files: `Not a listed test file: <path>; it selects the N test files that read it` or `Not run by Squeal: <path> is not a test file any runner here lists; it selects the N test files that read it, whose verdict is not its own`. The verdict line names a not-run path before D2's unmatched text (`pathsText`), and `No verdict: Squeal does not run <path>, ...` when no path selects a file.
- A timeout whose reason is `lapsed` now says `the daemon's heartbeat had lapsed at the last read; results are as of revision N` in place of `no result yet` or the pending count. The lapse suffix is unchanged.
- `commands.md` (all three copies): gate on `selection.code` or `selection.result`, never `state`; the reason list; `selection.paths`; the not-run line.

## Deviations the coordinator records in status.md

- not-run is not only `notKeyed`'s `mayList` reading. gh-83's file was kept out by cezar's own `vitest.config.ts` include, which only Vitest reads, so `mayList` says true for it; and in a pytest-only repository `mayList` is false for any source file. The name check above fixes both. A Vitest test file with a custom suffix (`*.e2e.ts`) that only Vitest's own config keeps out still reads as `source`.
- gh-83's shape changes from exit 0 to exit 3 while the readers pass (exit 1 when one fails). This adds a gate; none is loosened.

## Tests

- `test/cli/selection-result.test.ts`: the precedence table; gh-88's 24 files unsynced (3, `unsynced` in the text and the JSON), stored beside an unrelated current failure and a pending load retry (0, `pass`), a current failure (1, `fail`); a named wait that times out with a lapsed heartbeat (`lapsed`).
- `test/cli/selection-paths.test.ts`: gh-83's shape (a `vitest.config.ts` include only Vitest reads), readers failing, not-run with no reader, a file not listed yet, `vitest.exclude`, a source path (with the evals `squealEvidence(...).selected` gate), a pytest-only repository.
- `test/harness/skill-wait.test.ts`: the gating lines in every `commands.md` copy.

## For whoever continues

- `selectNamedFiles` runs at every poll of a wait. For each path without its own row it now reads the policy once per call, and for a path with a test file's name also stats it and reads the header. The closure read it already did per poll is larger. If that cost matters, move the not-run reading to the last read (`waitForNamed`'s returning branch and `readOnce` in `src/cli/status-paths.ts`, which this row did not own).
- `status-wait-lines.ts` is 501 lines and `status-wait-paths.ts` 491, both over the 300-line guide before this row. The named-verdict half of `status-wait-lines.ts` (`namedLine` to `unsyncedText`) is a natural file of its own.
- The bundles (`plugins/*/dist`, Pi's `cli/squeal.mjs`) were not rebuilt; they drift until the release rebuilds them.
- Spec text owed: 011 C15 "What status and the named line say" and 005 D2's JSON sentence, for `result`, `reason`, `paths` and the not-run line.
