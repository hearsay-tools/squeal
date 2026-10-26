# 015-72 notes: one coverage-off note per daemon when two adapters fail at once

Worker 3dfcf1e4, 2026-10-26. Brief: `tasks/wave-15.md` W1. Shape: repair. Finding: `reviews/0.1.349.md` S1.

## Base

The worktree started on `72732f353`, 526 commits behind main. The brief says "starts from main 0.1.349", so the branch was fast-forwarded to `origin/main` at `b61615309` ("docs(board): wave 15 running"), which holds `35083d2d4` (build: squeal 0.1.349). No commit of this row sat on the old base.

## The fix

| Where | What |
|---|---|
| `coverage.ts` `recordProviderFailure` | Returns `ProviderFailure \| null`, not `string \| null`. `null` still means "not a provider failure". A recognised failure gives `failure`, the run's own text with its own first cause, and `note`. `note` equals `failure` for the first failure the coverage object records, and is `null` for a later one. `failed` stays a `WeakSet`: `first` is `!failed.has(coverage)` read before `failed.add`. |
| `adapter.ts` `#unloaded` | Notes `unloaded.note` through `noteOnce` when it is not `null`, and returns `unloaded.failure` for the drop block, as before. The `noteOnce` call stays (brief). |

So recognition and note ownership are apart, as the review asks: a later failure still closes its instance with `closeCrashed` and reports its own cause, and only its note is suppressed.

**Type change.** `recordProviderFailure`'s return type moves from `string | null` to `ProviderFailure | null` (new exported interface in `coverage.ts`). Its only callers are `#unloaded` and `provider-failure.test.ts`.

## Tests

- `own-provider-failed.test.ts`, new case "notes once when two adapters on the same coverage fail at once, each run with its own cause". It is the review's probe: one copied `client-env` root, one coverage object, two adapters with `childEnv` `SQUEAL_TEST_VARIANT` `fast` and `slow`, both environments read, then both runs in `Promise.all`. The forced provider now names its sibling from that env: no variant imports `sibling.mjs` (the 015-70 cases, unchanged), a variant imports `sibling-<variant>.mjs`, which does not exist. The main process has no variant and loads `sibling.mjs`. Asserts: both runs `crashed`; each failure's first line starts `coverage is off until the daemon restarts:` and names its own `sibling-<variant>.mjs`; exactly one note, equal to one of the two first lines (which run records first is not fixed).
- `provider-failure.test.ts`: the two text cases read `failure` and `note`. New case "gives a later failure on the same coverage its own cause and no note": two failures with different causes on one coverage object.

**Red first.** Before the fix, the new real-Vitest case failed at revision 2: `expected [ …(2) ] to have a length of 1 but got 2` at the note count. The two crashes and the per-variant causes already held. After the fix, both test files pass at revision 6.

## Left open, for the coordinator

- **D8 amendment** (coordinator at landing): "one note per daemon", now true for concurrent failures on the shared coverage object, not only for one adapter's life.
- **Which cause the note names** is the first failure recorded, which is the run that ends first. With two concurrent failures this is not fixed in advance; the test accepts either.
- **`noteOnce`** still deduplicates by text per root. With the coverage object owning the one note, it is now redundant for this note, but the brief keeps it.
