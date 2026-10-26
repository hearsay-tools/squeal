# 017-10: notes for the next rows

Row 017-10 wires 017-09's lint surface into `squeal lint`, status, the
registration, the agent's deliveries and an opt-in Stop. 017-09 owns every
lint reader, the lint types and the only lint formatter
(`src/core/lint/surface/format.ts`). This row owns the callers and the
CLI's own rendering. 017-09's notes (`../017-09/notes.md`) describe the
API; this file does not repeat it.

## Seam map

| Surface | Caller (this row) | 017-09 reader | 017-09 words |
|---|---|---|---|
| Registration | `src/core/delivery/delivery.ts` `register`, beside `registerCode` | `registerLint` | `lintRegistrationLine` in `src/core/delivery/format.ts` `formatRegistration`, after the code line |
| Delivery | `delivery.ts` `deliver`: `readLintNews` in the main-store transaction, `acknowledgeLint` after it commits | `readLintNews`, `acknowledgeLint` | `lintLines` after the code lines; `lintTitleWords` joined to the code title words with " and " |
| Known failures | `sideParts` in `delivery.ts`: `knownFailures` beside `code` or `lint` | none | none |
| Status | `src/core/status/lint-status.ts` (`lintStatusOf`, `lintStatusPart`), called from `snapshot.ts` and `format-status.ts` | `lintStatus` with `codeSince(store, id, shell)` | `lintStatusLines` after the coverage lines |
| Hooks | `src/harness/shared/context.ts` builds `HookContext.lint`; `sweep.ts` calls `dropLint` | `lintStoreSource`, `dropLint` | none |
| Stop | `src/harness/shared/stop-lint.ts`, called from `stop.ts` `decide` after the code reason | `lintStop` with `codeSeenUpTo` | the reason text is this row's (below) |
| `squeal lint` | `src/cli/lint.ts`, `src/cli/lint-disk.ts`, `src/cli/lint-report.ts`; `main.ts` dispatch and help | `lintDetails`, `lintChanged` | `lintEntryLine`, `lintOffLine`, `lintFailedLine`, `LINT_STALE` |

The 015 code path is unchanged: `codeLines`, `codeChanges`,
`codeTitleWords` and `CodeNews` keep their signatures and output.
Complexity registration, coverage and the code Stop reason are as they
were. Lint lines are appended by the callers.

## Decisions the spec did not settle

1. **Read, then acknowledge after the commit.** 017-09's notes suggest
   `tellLint`. The delivery calls `readLintNews` inside its main-store
   transaction and `acknowledgeLint` only after that transaction commits.
   With `tellLint`, a delivery that fails after the read (a busy main
   store) would lose the lint news. Test: `delivery.test.ts`, "tells news
   again when the delivery that read it fails before it commits".
2. **When lint news is told.** With the code changes: at a tool boundary,
   and at Stop only beside other news (`changes` in `deliver`).
3. **Known failures.** A delivery with only lint news carries
   `knownFailures` of the tests, as one with only code news does. Lint
   never counts in it. The eval parser reads such a delivery as no test
   evidence (`test/evals/lint-lines.test.ts`).
4. **Title.** Code and lint title words join with " and ":
   `SQUEAL · 1 check changed (1 test) at revision 2; 1 lint change`.
5. **Stop reason.** `Squeal policy lint.blocking is on and 1 file went to
   fail lint since this session started: src/b.js (2 findings). `squeal
   lint --changed` lists them.` Lint never denies a tool call.
6. **`squeal lint` exit codes and JSON.** Exit 0 with an answer, 1 when
   there is none (lint off, store unreadable, status unavailable, a path
   outside the worktree), 2 on a usage error. JSON: `{v, available: true,
   paths, ...LintDetails}`, `{v, available: true, ...LintChanged}`, or
   `{v: 1, available: false, message}`. While lint is off, nothing is
   opened and no `lint.sqlite` is made.
7. **Bytes on disk (wave 2 rule 1; parent's ruling 2026-10-26).** After
   the store read, `lint-disk.ts` hashes each listed `pass` or `fail` file
   with `hashFile` (the repository's file hash: a symlink as git stores
   it, never followed; the object format from the blob's length) and
   compares it with the stored `blob`:
   - Other bytes: `outcome: "pending"`, `reason: "changed on disk since
     its lint"`.
   - No file: `outcome: "pending"`, `reason: "no longer a file on disk
     since its lint"`.
   - A read error: `outcome: "unknown"`, `reason: "Squeal could not read
     it: <code>"`.
   - `revision`, `blob`, `findings` and `stale` stay as stored
     (provenance). The worktree's `pending` and `unknown` counts take in
     each file that moved.
   - Text: `src/a.js: pending: changed on disk since its lint at revision
     1 (2 findings then)`. `--changed`: `...; at revision 2; now pending:
     changed on disk since its lint`.
   - So `reason` is set for these `pending` files too, not only for
     `unknown` (017-09's type comment says `unknown` only).
8. **What the disk check does not cover.** It checks the files the
   answer lists. With no path, that is the failing files only. A passing
   file edited on disk before the daemon records it is not in the list
   and not in "Not current in this worktree". No old pass is shown for it,
   because no pass is shown with no path.
9. **No wait for the daemon.** `squeal code` asks a live daemon to sync
   and reads again (row 015-22). `squeal lint` does not; a file edited
   since its lint reads pending at once. A later row can add the wait.
10. **Paths.** Paths resolve from the current directory to the worktree
    root. A folder holds the files below it at a `/` boundary (017-09's
    `holderOf`). Paths that hold no linted file print under "Not linted"
    once a keying has run, else under "Not known yet (the first lint in
    this worktree has not finished)".

## Type changes (all additive)

- `Delta.lint?: LintNews`, `Registration.lint?: LintRegistration`
  (`src/core/types/delivery.ts`).
- `StatusSnapshot.lint?: LintStatus` (`src/core/types/status.ts`).
- `DeliveryOptions.lint?: LintStoreSource`, `HookContext.lint?:
  LintStoreSource`.
- `lintCommand` returns `Promise<number>`.

## Tests

| Done-when | Test |
|---|---|
| Real formatter output passes the eval parser, plain and hook JSON | `test/evals/lint-lines.test.ts` |
| Test failures first; five lint changes and the overflow | `test/lint/wiring/delivery.test.ts` |
| Registration, status and off reasons are true | `test/lint/wiring/reasons.test.ts`, `status.test.ts` |
| Daemon-free details and `--changed` | `test/lint/cli/lint-command.test.ts` (`alive: false`) |
| Opt-in Stop counts only eligible failures, never denies an edit | `test/lint/wiring/hooks.test.ts` (with a deny control) |
| Off-mode output is identical | `test/lint/wiring/off.test.ts` |
| Revision and read race | `delivery.test.ts`: a failed commit retells; a pass commit between read and acknowledgement is told next. `test/lint/cli/disk.test.ts`: an edit between the store read and the disk read |
| Bytes on disk, folders, unreadable | `test/lint/cli/disk.test.ts`, `report.test.ts` |

`test/lint/wiring/rig.ts` writes every file into both the fake tree the
pass reads and the worktree `squeal lint` reads, so the blobs compare.

## Cherry-picked 017-09 commits

Approved by the parent. Each is unchanged; the parent drops the duplicate
at integration.

| 017-09 original | Copy on cez/326e6aab |
|---|---|
| 32016a5fa | 59e848334 |
| cff898098 | 4ff5f402b |
| 2af6ad325 | 2ca53c95d |
| 798bda1e6 | e39612dd0 |
| a077f0904 | 2137bfbe4 |
| 46c4016cc | 6b2ba9609 |
| 9dec4dc24 | b1cc3ef77 |
| 0fceb1d08 | dc5d345c9 |
| 057f90d14 | de8076815 |
| a0bbabfdb | 248379b05 |
| 7cb8b95fb | cf892a910 |
| 7d6e04833 | 67dce0a00 |
| 16f332fc5 | 1e20929a4 |
| 8ba5bd624 | 1cbaaf095 |
| 9ee943e7e | 999d2e9d9 |
| 406b04da2 | a17ac8a7f |
| 94507a714 | 43ac8d4c3 |

d15b94740 and 2835ed2cf added lint words of this row's own. 3ce5a214c
removed them (the parent's ruling: 017-09's formatter is the only one).

## Checks run (2026-10-27, at dc5ec4104)

- `npm run lint`: "Checked 2404 files in 1036ms. No fixes applied."
- `npm run typecheck`: exit 0, no output.
- Node 22.19 (CI's), `npx vitest run test/lint/cli test/lint/wiring
  test/evals/lint-lines.test.ts test/lint/surface`: "Test Files 18 passed
  (18)", "Tests 72 passed (72)". These tests use the fake provider, not
  real ESLint.
- `squeal status --wait 60000` over the 49 changed src and test files
  (revision 76, two waits): 850 test files pass; 4 fail; 180 were still
  pending when the wait ended (the daemon was running a tier of 52 files
  from other changes; host load).
- The 4 failures are the bundle checks, expected because worker trees do
  not build: `test/harness/plugin.test.ts`,
  `test/harness/codex/plugin.test.ts`,
  `test/harness/opencode/package.test.ts`,
  `test/harness/pi/package.test.ts`, each "cli/ps.mjs differs from the
  build". `cli/squeal.mjs` differs too. The coordinator rebuilds the
  bundles at integration.
- Not run: the full suite, a build, evals (worker rules).
