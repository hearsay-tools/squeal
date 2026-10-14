# 001-361: a stored error keeps its `cause` and `code`; a hook failure reads "setup failed"

Worker notes, 2026-10-14. Source: `research/environment-failures.md` Q1 and its wording finding. Prepares 001-368 (`squeal retry`): the agent must see a cause such as `ECONNREFUSED` to name it.

## What Vitest gives (Vitest 5.0.3, read in source and verified by the new tests)

- The serialized error keeps every own property: `code` (`ERR_MODULE_NOT_FOUND` on a missing import) and `cause`, itself a serialized error (`{ message: "connect ECONNREFUSED 127.0.0.1:N", code: "ECONNREFUSED" }` under undici's `fetch failed`). The probe's `output.txt` lines 94-102 show both.
- **Nothing marks a hook's error as a hook's.** `runSuite` catches a `beforeAll` error with `failTask(suite.result, e)` and `markTasksAsSkipped` (`run.BTlFXlnv.js:4044-4051`); the error carries no hook name or task type. The only signal is that a hook runs once the file loaded, so its tests are collected and report as skipped; a load error (import, syntax, top-level throw, zero tests) reports none.

## What the code does

- `src/core/types/check.ts`: `CheckError` gains three optional fields, all additive: `code?: string`, `causes?: readonly CheckErrorCause[]` and `phase?: "load" | "setup"`. New type `CheckErrorCause { message; code? }`.
- `src/runners/vitest/results.ts` `toCheckError`: keeps `code` (a string, or a number as text) and the cause chain, outermost first, `CAUSE_DEPTH` 3 links, each message's first line relativized and capped at `CAUSE_MESSAGE_CHARS` 200, codes whole. A non-error cause (`cause: "text"`) is its text. An error with neither adds no field.
- `src/core/scheduler/records.ts` `recordsForFile`: tags each file-level error `phase: "setup"` when any test of the file reported in this run, else `"load"`. Runner-agnostic, and touches no collection: 001-360's describe-level suite errors will reach `fileErrors` with their tests reported as skipped, so they read "setup failed" with no further change.
- `src/core/state/fingerprint.ts` `describeFailure`, the summary only: `setup failed: ` before a setup error; the error's code in parentheses unless the line already names it; each cause as `; cause: <message>` (its code appended when the message lacks it, the code alone when the message is empty). The causes keep their room within `SUMMARY_MAX_CHARS` (300) and the line keeps at least `LINE_MIN_CHARS`, so a long first line cannot cut the code. Exported helpers `causeText` and `withCode`.
- **The fingerprint is unchanged** (name, normalized first line, location). A stored "fetch failed" does not re-deliver as a changed failure after the upgrade, and the cause alone (a port number in the message) never makes a re-run read as changed.
- `src/core/status/format-why.ts`: under each error's stack, `code: X` when the stack does not name it, then `Caused by: <cause>` per link.
- Store: the errors are JSON in `failure_texts.errors`, so the new fields persist with **no schema change and no migration**. Rows stored before this read as before (fields absent).

What it reads like (from the tests):

```
FAIL  test/server.test.ts
      first observed: FAIL, ...
      setup failed: fetch failed; cause: connect ECONNREFUSED 127.0.0.1:41235
FAIL  test/missing.test.ts
      Cannot find module './does-not-exist.js' imported from ... (ERR_MODULE_NOT_FOUND)
```

## Decision the spec did not settle (sent to the coordinator, continued on the default)

The counts (`Known failures: 26 (2 tests, 24 test files that did not load)`, the baseline title, the overflow and collapsed `still failing` lines, `run --all`'s verdict) count `CheckId`s only, and `run --all`'s verdict gets `CheckCounts` through the protocol. Splitting "did not load" from "setup failed" there needs a per-check phase in the known state and a new count field through the status protocol. **Default taken: the per-check line says "setup failed" (delivery block, `squeal status`, `squeal why`, all through the stored summary), and the counts keep "that did not load".** `format.ts`, `collapse.ts`, `status/checks.ts` and `cli/verdict.ts` are unchanged. Proposed follow-up row:

> | 001-3xx counts name test files whose setup failed apart from those that did not load | planned | 001-361 stores `phase` on file-level errors but the counts see only check ids. Carry the phase to the known state (or count file-level failures by their stored `phase`) and add a `setupFailed` part to `CheckCounts`, the status header and the `run --all` verdict: `Known failures: 26 (2 tests, 24 test files whose setup failed)`. | Tests: a beforeAll throw counts under "setup failed" in status, the delivery title and the verdict; a missing import still counts under "did not load". |

## Edges

- `phase: "setup"` also covers an `afterAll` throw and an unhandled error attributed to a file after its tests ran: the file loaded, so "did not load" would be wrong, and "setup failed" is the closer of the brief's two words. A third word ("failed after its tests") would be exact; not done.
- The node:test runner (`src/runners/node-test/run/errors.ts`) has its own `toCheckError` and does not keep `code` or `cause` yet; its file-level errors do get `phase` from `recordsForFile`. Outside this row's ownership.
- `src/` is guarded by the key format: `test/keys/key-format.test.ts` fails until the coordinator bumps `KEY_FORMAT_VERSION` and re-pins.

## Spec sentence drafts

- D4, after "Stack paths are relativized before storage.": "A stored error keeps its `code` and its `cause` chain, outermost first, three links of message and code, each message's first line capped at 200 characters and each code kept whole (task 001-361)."
- D6, after the fingerprint sentence: "The summary names the error's code and its causes (`fetch failed; cause: connect ECONNREFUSED 127.0.0.1:3000`), within its cap; the fingerprint does not. A file-level failure whose tests were collected, a hook that threw after the file loaded, is worded `setup failed:`; one whose tests were not is a file that did not load (task 001-361)."
- D7 (`squeal why`): "Each stored error is printed with its code, when its stack does not name it, and one `Caused by:` line per cause."

## Tests

- `test/scheduler/error-causes.test.ts` (end to end through the scheduler, the real adapter, the store and the readers): a `beforeAll` fetch to a closed port stores `causes[0].code` ECONNREFUSED and `phase: "setup"`, and the delivery, `squeal status` and `squeal why` show `setup failed: fetch failed; cause: connect ECONNREFUSED 127.0.0.1:N`; a missing import stores `code` ERR_MODULE_NOT_FOUND and `phase: "load"` and shows `(ERR_MODULE_NOT_FOUND)` and `code: ERR_MODULE_NOT_FOUND` with no "setup failed"; the delivery is within `MESSAGE_CAP_CHARS`.
- `test/state/failure-causes.test.ts`: the mapping's bounds (depth, 200 characters, codes whole, relativized, non-error cause, no new keys without code or cause); the summary's wording; the cause kept within the cap under a 1000-character first line; 40 setup failures with maximal causes deliver within the cap; the fingerprint unchanged.
- `test/scheduler/records.test.ts`: a load error is tagged `load`, an error after a test reported is tagged `setup` and summarised `setup failed: …`.
- Red before, green after: with `src/` reverted, 10 of the new or changed tests fail.
