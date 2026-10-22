# 011-101: `squeal failures` reads through one repository, worker notes (2026-10-22)

Brief W1 of `../wave-11.md`. Base main at `46b7911c2` (0.1.253, the last release `squeal--v0.1.253`). Commit `3bd520a3a` gives both repositories one `toResult`. The next commit holds this file and one comment in `results.ts`.

## What landed

- `toResult` and its `OUTCOMES` are in `src/core/store/codec.ts`. `src/core/store/repos/results.ts` and `src/core/store/repos/failures.ts` import it. The copy in `failures.ts` and its "Not shared with `results.ts`" comment are gone.
- The move keeps the alarm silent. `toResult`'s removed lines in `results.ts` ran at `squeal--v0.1.253`, through `byKey` in the `rows` and `accept` cases. Its lines in `codec.ts` run at the candidate.
- No type changed.

## The alarm on the deletion

With `listFailures`, `countFailures`, `FAILURE_WHERE`, `failureParams` and `FailureFilter` removed (uncommitted, Squeal revision 1), the first test of `test/keys/key-format.test.ts` failed. No case's output differed. The failure was this:

```
KEY_FORMAT_VERSION (src/core/keys/key-format.ts): changed lines no case runs, each needing a case under test/keys/validity/cases/: src/core/store/repos/results.ts:101, src/core/store/repos/results.ts:102 (baseline bundle line 4636); src/core/store/repos/results.ts:102, src/core/store/repos/results.ts:103 (baseline bundle line 4637); src/core/store/repos/results.ts:103, src/core/store/repos/results.ts:104 (baseline bundle line 4638); src/core/store/repos/results.ts:104, src/core/store/repos/results.ts:105, src/core/store/repos/results.ts:106 (baseline bundle line 4639); src/core/store/repos/results.ts:108, src/core/store/repos/results.ts:109 (baseline bundle line 4641); src/core/store/repos/results.ts:109, src/core/store/repos/results.ts:110 (baseline bundle line 4642); src/core/store/repos/results.ts:110, src/core/store/repos/results.ts:111 (baseline bundle line 4643); src/core/store/repos/results.ts:111, src/core/store/repos/results.ts:112 (baseline bundle line 4644); src/core/store/repos/results.ts:112, src/core/store/repos/results.ts:113 (baseline bundle line 4645); src/core/store/repos/results.ts:113, src/core/store/repos/results.ts:114 (baseline bundle line 4646); src/core/store/repos/results.ts:186 (baseline bundle line 4698); src/core/store/repos/results.ts:187 (baseline bundle line 4699); src/core/store/repos/results.ts:188 (baseline bundle line 4700)
```

The line numbers are the release's `results.ts`. Lines 101 to 106 are `listFailures`' body, 108 to 114 `countFailures`' body, and 186 to 188 `failureParams`' body. The property lines (99, 107) and `FAILURE_WHERE` (184) ran when the module loaded and the repository was built, so the alarm did not list them. `FailureFilter` is a type and emits no code. The rule is in `test/keys/validity/notes.md`, decisions 1 and 9: a line the candidate removes must have run at the last release, and no case calls these queries.

## Tried and dropped

Option A, never committed: the `rows` harness (`test/keys/validity/harness.ts`) read the failing rows as wording after `putMany`. It read them through `listFailures` and `countFailures` at a tree that has them and through `store.failures` at a tree that does not. That left one line unrun: `results.ts:111` and `:112` (baseline bundle line 4644), the `?? { n: 0 }` of `countFailures`. It never runs, because `COUNT(*)` always returns a row.

## Decision

The coordinator, 2026-10-22, in reply to request `aad41c2c`: option B. The five names stay until the next key-format raise, as `../011-64/design.md` section 4, consequence 1 says. A harness branch that runs dead code at the release, plus a fallback to remove later, adds more than the deletion removes. The row lands with `3bd520a3a` only. One comment above `listFailures` in `results.ts` names the follow-up. Comments emit no code, so the alarm stays silent.

The done-when changes. `grep` still finds the five names, each one only where it was before this row:

- `src/core/store/repos/results.ts`: the `FailureFilter` import (line 2), `listFailures` and `countFailures` in `createResultRepo`, `FAILURE_WHERE` and `failureParams` at the end of the file.
- `src/core/types/store.ts`: `FailureFilter`, `ResultRepo.listFailures` and `ResultRepo.countFailures`.

## What goes at the next key-format raise

- `src/core/store/repos/results.ts`: `listFailures`, `countFailures`, `FAILURE_WHERE`, `failureParams`, the comment above `listFailures`, and `FailureFilter` in the import.
- `src/core/types/store.ts`: `FailureFilter`, and `ResultRepo.listFailures` and `ResultRepo.countFailures` with their doc comments.

At a raise, the deletion needs no case. Under a raised version the comparison is held to D6 and to `KEY_FORMATS_READ_AS_ONE`, not to its changed lines (`componentFailures` and `failures` in `test/keys/validity/verdict.ts`).
