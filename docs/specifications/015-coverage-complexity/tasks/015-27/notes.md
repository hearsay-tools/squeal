# 015-27 notes: each delivery names what still stands on the other side

Worker cfd93e9b, 2026-10-24. Brief: `tasks/wave-1b.md` W6, on `int/015b` (149cc99a9). What the review and the next row read first.

## Seam map

| What | Where |
|---|---|
| The two lines | `toldOverLine` and `knownFailuresTailLine` in `src/core/delivery/code-format.ts` |
| Which line a delta ends with, if any | `otherSideLines` in `src/core/delivery/format.ts`, the last part of `formatDelta`'s tail, after the code lines; never cut |
| The functions told in full and over now: one read for the count and for `squeal code --told` | `toldOver` and `withToldOver` in `src/core/delivery/code-told.ts` (new) |
| When the count is read | `tellCode(..., { changes, toldOver })` in `code-deliver.ts`; after the view is written, in the same transaction, so a FAIL this delivery tells is counted |
| The wiring | `deliver` in `src/core/delivery/delivery.ts`: `toldOver` is `delta.entries.length > 0`, `changes` is the old condition; `knownFailures` beside `code` (`currentFailures`) |
| Whose views `--told` reads | `toldTo` in `src/core/delivery/code-since.ts`, which shares `registeredOf` with `codeSince` |
| `--told` itself | `readCodeReport` (`src/cli/code-report.ts`), `codeCommand`, `whatListed` and `scopeLines` (`src/cli/code.ts`), the usage in `src/cli/main.ts` |

## The rule as built

| The delivery has | The other side has | It ends with |
|---|---|---|
| a test entry (FAIL, PASS, UNKNOWN, RESOLVED) | functions told `FAIL` or `STILL FAIL` (view mark `full` or `still`) that fail now | `Complexity: 2 functions over 20 that this session was told about; squeal code --told lists them.` |
| code lines and no test entry | current known failures | `Tests: 3 known failures; squeal status lists them.` |
| anything else | | nothing new |

A blank line comes before the line, as before every tail block. "Lists them" stays plural at 1, as in the registration and recount lines.

## Decisions the brief did not settle

All four were agreed by the coordinator on 2026-10-24 (request 83b1457e), the first two on condition that each sits in its own commit.

1. **`squeal code --told`, not `--changed`.** `--changed` lists every function whose state changed since the session registered: passes too, and changes past the 5-line limit (told by count). It leaves out a standing function told `STILL FAIL`, which has no transition. So it cannot agree with the count. `--told` lists the functions over the threshold now that the shell's session was told about in full, from the same `toldOver` read the delivery counts with. A shell whose session is not registered in the worktree (Pi, a terminal, an expired session) gets those told to any registered consumer, as `--changed` falls back to the oldest registration; the text and the JSON's `told.scope` (`worktree`) say so. `--told` and `--changed` together exit 2. With paths, `--told` keeps the told functions in those files. Its place in `references/commands.md` (claude-code, codex, pi) is beside `--changed` (coordinator).
2. **The wiring, and the waiter.** The brief named no seam that carries the counts to the formatter. `CodeNews.toldOver` and `Delta.knownFailures` carry them; `delivery.ts` passes the options and sets `knownFailures`. The idle waiter (and a peek, which the deny hook formats) now reads the told count too, read-only, when it has test entries: before this row it never opened the code store, so a waiter's `PASS 7 checks recovered` had no way to name what stood. With the policy off nothing is opened: `codeSource.open` reads the policy and returns before `openCodeStore` (the coordinator's condition; the policy-off test runs the waiter and finds no `code.sqlite`).
3. **The test count is status's `Known failures`**: `current` failures only (011 C6), as `squeal status`, the registration and Stop count them. Right after an edit, failures pending a rerun are not counted, so 0 current and 3 pending give no line. The line never disagrees with `squeal status`'s count.
4. **Stop.** Stop's text ends with its own `Known failures: N (...)` line, so the test line is left out of the `full` header form, which only Stop uses. The complexity line stays at Stop. At Stop, `tellCode` runs only beside other news, so complexity-only news there needs a liveness or hold change anyway.
5. **"Test news" is any test entry**, also when the same delivery has code lines: then the complexity line follows the code lines and counts the FAIL just told. "A code part" for the test line means code lines; a `toldOver`-only `CodeNews` has none, and is only made for a delivery with test entries.
6. **A liveness or hold change alone is not test news**: no test entry, so no complexity line. With code lines it is complexity news, so the test line can follow.
7. **What counts as told in full.** View marks `full` (a FAIL told in its own line) and `still` (after a STILL FAIL). A `count` entry is left out: over at registration or since a recount, taken in by count after a catch-up (015-20), or a change past the 5-line limit. A recount seeds the view again by count, so after a threshold change the count starts at 0.

## Type changes

All additive and optional.

- `CodeNews.toldOver?: { count, threshold }` (`src/core/types/code-delivery.ts`). With it, `entries` can be empty.
- `Delta.knownFailures?: number` (`src/core/types/delivery.ts`), set beside `code` only, so a policy-off payload has neither.
- `CodeReport.told?: { scope: "session" | "worktree" } | null` and `CodeReportOptions.told?: boolean` (`src/cli/code-report.ts`).
- `tellCode` gains a fifth parameter, `TellCodeOptions` (`changes`, default `true`; `toldOver`, default `false`). With neither, it opens nothing and returns `null`.
- New: `toldOver`, `withToldOver` (`code-told.ts`); `toldTo`, `ToldTo` (`code-since.ts`); `toldOverLine`, `knownFailuresTailLine` (`code-format.ts`).

## Tests

`test/code/delivery/cross-summary.test.ts`: a recovery with a told FAIL still over ends with the line, and not once it passes; a standing function never told stays out; a STILL FAIL counts; a FAIL told in the same delivery counts; another session's are not this one's; a waiter's recovery ends with the line; complexity news with 3 known failures ends with the test line, with 0 not; a failure pending a rerun is not counted; Stop's full form has no test line; the registration is unchanged; policy off is byte-identical at a boundary and through the waiter, with no code store.

`test/code/delivery/code-command.test.ts`: `tellCode`'s count and `squeal code --told` name the same function, in JSON and text, with paths, with the worktree scope, and `--told --changed` exits 2.

No existing line constant changed: no other test delivers test news while a told function is over, or code news with known failures.

## For the next rows

- `code-deliver.ts` is 338 lines (320 before this row); the told read went to `code-told.ts` to keep it from growing more.
- `createDelivery.deliver.<transaction>` is at complexity 43 (44 before), still over 20.
- The bundle-drift tests fail until the candidate's build, as after every row of 015.
- D6's text in `spec.md` does not name the two lines yet; that amendment is the coordinator's.
