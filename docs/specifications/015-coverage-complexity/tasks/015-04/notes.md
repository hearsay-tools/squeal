# 015-04 notes: the code-check seam

Worker dc73d332, 2026-10-23. What wave 1 (015-05 to 015-08) imports, and the choices the spec left open.

## Seam map

| What | Where |
|---|---|
| Types: identity, measures, outcomes, counts, files, states, transitions, view entries | `src/core/types/code.ts` (not re-exported from `src/core/types/index.ts`, which this row does not own; import the file directly) |
| Store interface: repos, prune options, open failures | `src/core/code/store/types.ts`, re-exported by `src/core/code/store/index.ts` |
| Open | `openCodeStore(commonDir, policy, { create?, busyTimeoutMs? })` in `src/core/code/store/open.ts`; `codeStorePath(commonDir)` |
| Schema | `src/core/code/store/schema.ts`: `CODE_MIGRATIONS`, `CODE_SCHEMA_VERSION` (1); reuses the main store's `migrate` |
| Repos | `counts.ts` (counts, files), `states.ts` (checks, states, transitions), `views.ts`, `store.ts` (meta, assembly) |
| Prune | `src/core/code/store/prune.ts` |
| Policy | `Policy.complexity`, `.coverage`, `.crap` and their defaults in `src/core/types/policy.ts`; the loader's shape and the cross-key rule in `src/core/daemon/policy-code.ts` |

Nothing calls the code store yet. With `complexity.enabled` false, `openCodeStore` returns `{ reason: "off" }` before it touches the disk, so no caller can create `code.sqlite` by mistake.

## Types wave 1 imports

From `src/core/types/code.ts`:

- `CodeCheckId { kind: "code", path, qualifiedName, occurrence }`: D2's identity. The body hash is not in it.
- `CodeMeasure`: `"complexity" | "crap" | "uncovered"`. One identity, one state per measure.
- `CodeOutcome`: `"pass" | "fail" | "pending" | "unknown"`.
- `CodeLanguage` and `CODE_EXTENSIONS` (extension to language, D1's list).
- `CodeRange`: 1-based lines and columns, end exclusive.
- `DecisionKind`, `FunctionCount`, `FileCount`: 015-05's output and the count's stored shape.
- `CodeFile`: a worktree's included file at its blob, language, counter version, size and revision.
- `CodeKnownState`: D4's state per worktree, check and measure.
- `CodeTransitionKind` (`first-seen-fail`, `pass-to-fail`, `fail-to-pass`, `removed`) and `CodeTransition`.
- `CodeTold` (`"count" | "full"`) and `CodeViewEntry`.
- `CoverageRecordKey` (wave 2).

From `src/core/code/store/index.ts`: `openCodeStore`, `isCodeStoreOpenFailure`, `codeStorePath`, `CODE_SCHEMA_VERSION`, and the types `CodeStore`, `CodeCountRepo`, `CodeFileRepo`, `CodeStateRepo`, `CodeStateFilter`, `CodeTransitionRepo`, `CodeViewRepo`, `CodeMetaRepo`, `CodePruneOptions`, `CodePruneReport`, `CodeStoreOpenFailure`, `OpenCodeStoreOptions`.

## Decisions the spec left open

1. **Measure beside the identity.** The check is `(path, qualifiedName, occurrence)`; `measure` is a column of the state, transition and view rows. D9's two wave 2 states need no new identity.
2. **`pending` for complexity is per file.** A file whose blob has no count at the current counter version is listed by `files.uncounted(worktreeId)`. No per-function `pending` row is stored, because no function is known before the count.
3. **Transition kinds.** Four: `first-seen-fail`, `pass-to-fail`, `fail-to-pass`, `removed`. A parse error's `unknown` delivers nothing (D3), so there is no `to-unknown` kind. A move, a value change that stays `fail` and a policy change record nothing (D5).
4. **The fingerprint.** A view entry stores the outcome and the threshold, never the value (D5: "70 becoming 69 is no news").
5. **Language in the count key.** `typescript` for `.ts .tsx .mts .cts`, `javascript` for `.js .jsx .mjs .cjs`, `python` for `.py`. 015-05 may count TS and JS the same way; the key still separates them, which costs at most one extra count for a blob that is both.
6. **Decision kinds.** ESLint's classic kinds, plus radon's `else` (loop and `try`), `comprehension` and `assert`. 015-05 may add a kind; the union and the stored JSON allow it.
7. **Ranges.** 1-based and end-exclusive, matching tree-sitter's `endPosition` and V8's ranges for wave 2's join.
8. **Policy validation.** `complexity.threshold` and `complexity.maxFileBytes` are positive integers. `crap.threshold` is a number above 0, because CRAP is not an integer. A glob Squeal cannot compile in `include` or `exclude` makes the whole key fall back to its default, as `vitest.exclude` does, not glob by glob, as `slow.include` does.
9. **Default `include`.** One glob, `**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,py}`. A test checks that it matches every `CODE_EXTENSIONS` key and nothing else.
10. **`coverage.enabled` without `complexity.enabled`.** One problem, `"coverage.enabled" must be false while "complexity.enabled" is false, got true`, and coverage stays off.
11. **Readers.** `create: false` gives `missing` when the file is absent. A reader that finds an older `user_version` still migrates, as hooks do on the main store.
12. **A corrupt code store** is reported as `{ reason: "corrupt" }` and never moved aside. Counts can be made again, so wave 1's daemon may delete the file and count again; that is its call.
13. **Retention.** A count stays while a `files` row of any worktree uses its `(blob, language, counter_version)`. Otherwise it goes once its `counted_at` is older than `store.retentionDays`, as C7 drops results by `recorded_at`. There is no size cap: `store.maxSizeMb` applies to the main store only.
14. **Prune input.** `CodePruneOptions` takes the live worktree ids and the registered consumers. The caller reads both from the main store after the main prune. Rows of other worktrees, and view entries of other consumers, go. Transitions stay until their worktree goes, as in the main store. Coverage records go by age until wave 2 ties them to their results.
15. **Moves.** `states.move(worktreeId, from, to)` moves every measure's state and every consumer's view entry of that worktree. If `to` already has a row, the moved row replaces it.
16. **No table for D6's "too big, told once per session".** Wave 1 can keep it in `meta` (one key per consumer), or add it to V1. Waves 0 and 1 are reviewed together before a release, so V1 can still change. Only one wave 1 row should edit `schema.ts`; 015-06 is the natural owner.
17. **`squeal init`** writes every default key into a new `squeal.config.json`, so a new config now lists `complexity`, `coverage` and `crap` with `enabled: false`. The plugins' `references/policy.md` does not name the keys yet; that belongs to a bundle row, probably 015-07.

## Shared files touched

- `src/core/store/open.ts`: only `export` added to `switchToWal` (coordinator agreement, commit 66c1e3a90).
- `test/types.test.ts` and `test/daemon/policy.test.ts`: the full-policy expectations list the three new sections. 011 wave 26 W1 changes the `baseline` default near the same lines.

## For a later quality pass

- `isCorruption` is duplicated in `src/core/code/store/open.ts` (4 lines), because the agreement covered only `switchToWal`'s export.
