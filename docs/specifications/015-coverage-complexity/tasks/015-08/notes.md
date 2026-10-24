# 015-08 notes: the first edit to a standing failure

Worker 7853cd6e, 2026-10-24. What the review and the dogfood read first.

## Seam map

| What | Where |
|---|---|
| The two columns: `states.edited_revision`, `states.edited_at` (epoch ms), `NULL` before an edit | `src/core/code/store/schema.ts`, V1 edited in place (unreleased) |
| `CodeEdit`, `CodeStateRepo.edits(worktreeId, measure)`, `markEdited(worktreeId, edits)` | `src/core/code/store/types.ts`, `states.ts` |
| The pass writes `PassReport.edited` in its last transaction, after the states | `src/core/code/pass/pass.ts` |
| The rule, pure | `standingEdit` in `src/core/delivery/code-delta.ts`, called from `planCodeDelta` |
| The store read | `codeStep` in `src/core/delivery/code-deliver.ts` (`store.states.edits`, one query per delivery) |
| The line | `codeEntryLine`, case `edited`, in `src/core/delivery/code-format.ts` |

## The rule as built

A delivery tells a function in full, once, when all of these hold:

- its state is `fail`;
- the consumer's view holds it `fail` at the same threshold, told by `count`;
- its last edit (`edited_at`) is after the view entry's `toldAt` and the view's seed.

The entry is then written `full`, so later edits are quiet until the state changes. The line:

```text
STILL FAIL complexity: selectTier (src/core/scheduler/tiers.ts:120) is 23 after the edit; it was already over 20 before it (ESLint rule)
```

## Decisions the spec left open

1. **Two columns, not one.** A view's `toldAt` and seed are epoch ms, and `counted_at` and `changed_at` on `states` are revisions. So `edited_at` holds the pass's time, as a transition's `at`, and `edited_revision` the revision, for the entry's `revision`.
2. **Every edit is stored**, whatever the outcome. The delivery applies D6's conditions. A `PASS -> FAIL` edit is told as the transition, never as an edit: the view's outcome differs, so the transition branch takes it.
3. **The store side adds repo methods, not a field on `CodeKnownState`.** `src/core/types/code.ts` stays as it was. `upsertMany` keeps a stored state's edit; `removeMany` drops it with the row; `move` carries it.
4. **The new kind** `edited` is `CodeDeltaKind = CodeTransitionKind | "edited"` in `src/core/types/code-delivery.ts` (coordinator agreement, 2026-10-24, its own commit).
5. **Order and the limit.** Edits rank after every transition, removed functions included. They share the 5 lines. An edit past the limit is not counted in `and N more complexity changes`, since `squeal code --changed` would not list it. Its entry stays `count`, so the function's next edit tells it.
6. **A crossing that returns between two deliveries** (fail, pass, fail, with edits) is told as an edit: the consumer last knew it over, and it is over now.
7. **Wording**: `STILL FAIL complexity: ...`. The code-only title still counts it as `1 complexity change` (`format.ts`, not this row's; the coordinator notes it for the review).

## Shared files touched (coordinator agreement, 2026-10-24, each in its own commit)

- `src/core/types/code-delivery.ts`: `CodeDeltaKind`, and `CodeDeltaEntry.kind` typed with it.
- `plugins/{claude-code,codex,pi}/skills/squeal/references/policy.md`, line 54, that sentence only: "A count that changes while the function stays over says nothing, except at the first edit to it in a session, which says once: `STILL FAIL complexity: ...`. A move or a rename that keeps the function's body says nothing."

## Not done here

- `plugins/*/dist` are not rebuilt (not this row's). The bundle-drift tests fail until the candidate's build, as after 015-07.
- No hook-level test through a daemon (`test/code/delivery/hooks.test.ts`); the delivery tests run the real pass over a fake counter.
- D2's occurrence limit applies: removing the first of two functions of one name makes the second read as an edit of the first.
