# 011-241 notes: a named wait's asked runs have one owner, with 011-238 slice 2

Worker 659c8da3, wave 50 W1, 2026-10-26, from baseline `00daa15e5`. Rows 011-241 (with `quality/2026-10-26-b.md` slice 3) and 011-238 slice 2 (`quality/2026-10-26-a.md`). Slice 2's notes are here, not in `tasks/011-238/`, because W2 writes that file for slices 3 to 5.

## Cause

Row 011-207 kept a wait's asked runs in two closure variables of `waitForNamed`'s read (`asked`, `unpromoted`), read or written at eight places. The read closure was CC 55, and `status-wait-paths.ts` 575 lines. `NamedSelection.unmatchedPaths` and `paths` were optional although `selectNamedFiles`, their one producer, always sets both, so five readers kept a fallback.

## What changed

- `WaitAsks` (`src/cli/status-wait-ask.ts`) is the one owner per wait: `toAsk` (the files to ask at the first decided read, once; none decides it asks nothing), `asked` (the answers), `untaken`, `promoted` and `taken` (the files to promote once the daemon took them; `takenSince` folded in), and `ends` (the `asked` field for the lines). `heldOutcome` states the rule that an untaken run keeps a settled read waiting. `askableFiles` and `askedEnds` are now module-private.
- Texts moved to `src/cli/status-wait-ask-lines.ts`: `AskedPayload`, `askedPayload`, `waitAsked`, `askedLines`, `queuedText`, unchanged.
- The store writes moved to `src/cli/status-wait-ask-store.ts`: `AskNamed`, `stillAskable`, `askNamedRuns`, unchanged. This is a third ask file the row did not name. With the owner in it, `status-wait-ask.ts` was 325 lines; the write path is the one cohesive part with its own imports (`openForWrites`, `whileBusy`, `tellDaemonRetries`). `askableState` is exported for `stillAskable`.
- `status-wait-paths.ts` was still 563 lines after the owner, because the asked-run code in it was only about 25 lines. So `printNamed`, `NamedWaitPayload`, `NamedPrint`, `withAsked` and `namedWaitCommand` moved unchanged to `src/cli/named-print.ts`. With `namedWaitCommand` there too, the imports run one way: `named-print.ts` reads `status-wait-paths.ts`, and `status-wait-paths.ts` no longer imports `status-wait-lines.ts`, which ends that import cycle.
- Slice 2: both fields required. Fallbacks removed in `unmatchedText` (`named-file-lines.ts`), `namedPathLines` and `pathsText` (`named-path-lines.ts`), `namedResult` and `printNamed`, and a fifth one row 011-243 added after the scan, `waitAgainCommand` (`no-verdict-lines.ts:141`).
- Quality b slice 3: `storedAt(records, asked, testFile, key)` in `src/core/retry/kept.ts`, called by `askNamedRun` and `askableFiles`; `isAsked` folded into it (no other caller); the `asked` answer's `record` removed. `storedAt` reads `records` with `some` and does not call `retriesAt`, so `kept.ts` takes no value import from `records.ts` (no cycle).

## Ownership changes

- Slice 3 touches `src/core/retry/kept.ts`, `records.ts`, `index.ts` and `test/retry/records.test.ts`. The brief said "Not yours: src/core/"; the coordinator gave them to this row for slice 3 only (reply to request 849b05ff: "the brief's 'Not yours: src/core/' was my error").
- Import-only edits outside the named files: `src/cli/status-wait-lines.ts` (`askedLines`), `src/cli/status-wait.ts` (`namedWaitCommand`), `src/cli/status-paths.ts` (`printNamed`, `NamedPrint`), and ten test files (`namedWaitCommand`, `printNamed`, `askNamedRuns`, `AskNamed`).
- `src/cli/no-verdict-lines.ts:141`, the fifth fallback, for slice 2's "no `??` fallback left".
- Hand-built selections gained the two fields: `test/cli/wait-again-fixture.ts`, `wait-again.test.ts`, `test/evals/evidence-squeal.test.ts`, `named-wait.test.ts`, `stopping-evidence.test.ts`, `test/status/not-current.test.ts`. The `as unknown as EndedNamed` ones are invisible to the type check; Squeal's run found them. Their `paths` are the per-file `test-file` entries `selectNamedFiles` gives, not `[]`: with the fallback gone, `waitAgainCommand` reads only `paths`, and `[]` would drop the paths from the wait-again command.

## Evidence

- `squeal code src/cli/status-wait-paths.ts`: `waitForNamed.<withStatusStore>` CC 44 (was 55). Over 20 among the changed `src` files: only it, `namedLine` (26) and `waitForStatus`'s read (65), both older and in files where only an import changed.
- Lines: `status-wait-paths.ts` 412 (was 575), `status-wait-ask.ts` 255, `status-wait-ask-lines.ts` 97, `status-wait-ask-store.ts` 74, `named-print.ts` 165.
- `grep -rn "unmatchedPaths ??\|paths ??\|paths?\.\|unmatchedPaths === undefined" src/cli`: one hit, `code.ts:161`, another `paths`.
- `npx vitest run test/keys/key-format.test.ts` before the slice 3 commit: 12 of 12 passed; no version moved.
- The evals parser gate tests (`test/evals/no-verdict-evidence.test.ts`, `named-wait.test.ts`, `evidence-squeal.test.ts`, `stopping-evidence.test.ts`) are current and passing, with only the selection builders and one import changed.
- Squeal 0.1.334 at revision 25 (`e21b511d4` plus these notes): the changed `src/cli` paths selected only one reader each (row 011-233's defect), so the 94 test files that import a changed module, directly or through a test helper, were named by their own paths: `squeal status --wait 60000 <94 files>` ended "Named test files at revision 25: no known failures; 94 test files, each with a current result". The worktree's 4 known failures are the bundle checks below.
- Expected drift: `test/harness/plugin.test.ts`, `pi/package.test.ts`, `opencode/package.test.ts` and `codex/plugin.test.ts` fail "cli/squeal.mjs differs from the build". The row does not own the bundles (no `npm run build`).

## Commits

- `df67459b8` refactor(011-241): a named wait's asked runs have one owner
- `9970721af` refactor(011-238): NamedSelection's unmatchedPaths and paths are required (slice 2)
- `e8075a8a8` refactor(011-241): the named wait's command and print move to named-print.ts
- `e21b511d4` refactor(011-241): one storedAt rule for a request stored at a file and key (quality 2026-10-26-b slice 3)

## Type changes

- Removed exports: `takenSince` (into `WaitAsks.taken`), `isAsked` (into `storedAt`); `askableFiles` and `askedEnds` no longer exported. None had a caller outside these files.
- Added: `WaitAsks`, `heldOutcome`, `askableState` export, `storedAt`.
- Moved, same shape: the ask texts, `AskNamed`, `askNamedRuns`, `NamedWaitPayload`, `NamedPrint`, `printNamed`, `namedWaitCommand`.
- Narrowed: `NamedSelection.unmatchedPaths` and `paths` required; `NamedRunAnswer`'s `asked` has no `record`. Not additive, but every producer already set the fields, and no reader used the record.

## For the next worker

- The read closure is at CC 44, one under the bound. Its next cut is the focus part (`whole`, `focusOf`, the send at the first promotion), which is not asked-run code.
- `waitForStatus`'s read (CC 65, `status-wait.ts`) is now the most complex function in `src/cli`.
