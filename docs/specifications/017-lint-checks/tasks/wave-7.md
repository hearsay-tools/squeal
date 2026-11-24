# Spec 017 Wave 7: Issue #274 oxlint keying speed, main-thread yielding, and accurate keying status

Context: GitHub issue #274 and findings in `docs/specifications/017-lint-checks/research/issue-274.md`.
Spec sections: `docs/specifications/017-lint-checks/spec.md` D5, D7, D9, D11.

Both rows run in parallel on disjoint seams. Neither row changes key bytes, `LINT_KEY`, `OXLINT_PROVIDER_VERSION`, or `KEY_FORMAT_VERSION`. Neither row runs `pnpm run build` in its worktree (the coordinator builds once after integration).

---

## W1 — Row 017-35: oxlint provider byte-bounded `--debug files`, memoized `chainOf`, and yielding

- **Role:** Use `/worker`.
- **Shape:** slice.
- **Outcome:** Cut oxlint config-mode `inputs()` from ~22 sequential `--debug files` child processes and ~60k synchronous `existsSync` calls down to byte-bounded batches, per-call folder-memoized `chainOf`, and event-loop yields every 256 files, keeping keys and linted sets byte-identical.
- **Spec & research to read:** `docs/specifications/017-lint-checks/spec.md` D5, D9, D11; `docs/specifications/017-lint-checks/research/issue-274.md` F3.1, F3.3, F3.5.
- **Starting seam:**
  1. `src/core/lint/provider/oxlint/run.ts`: replace fixed `DEBUG_CHUNK = 256` in `lintedFiles` with a pure exported helper (e.g. `chunkDebugPaths(paths, maxBytes)`) that bounds each `--debug files` invocation by argv byte size (`128 * 1024` bytes on POSIX, `24 * 1024` bytes on `win32`, always at least 1 path per chunk, counting UTF-8 bytes + 1 separator per path). Keep `ctx.observe` unchanged (D11 JS plugin / TS config observation stays on) and keep D9 failure handling unchanged (any failed chunk fails the call).
  2. `src/core/lint/provider/oxlint/configs.ts` & `config-set.ts`: add a per-call directory-memoized config-chain helper (e.g. `createChainLookup(root)` or optional cache map in `chainOf`) used by `Provider.inputs()` for batch lookups, while `ConfigSet.missed(path)` continues reading disk uncached so row 017-30 catches newly created configs.
  3. `src/core/lint/provider/oxlint/provider.ts`: inside `Provider.inputs()`, build `inputs` using the per-call memoized chain lookup and yield to the event loop (`await new Promise((r) => setImmediate(r))`) every 256 files so large batches never form one long synchronous block.
- **Ownership:**
  - Own: `src/core/lint/provider/oxlint/run.ts`, `src/core/lint/provider/oxlint/configs.ts`, `src/core/lint/provider/oxlint/config-set.ts`, `src/core/lint/provider/oxlint/provider.ts`, `test/lint/oxlint/keying-perf.test.ts` (and existing `test/lint/oxlint/*.test.ts` only if needed).
  - Leave alone (sibling-owned): `src/core/lint/pass/*`, `test/lint/pass/*`, `docs/*`, `package.json`, `plugins/*`.
- **Done when:**
  - New tests in `test/lint/oxlint/keying-perf.test.ts` prove: (a) byte-bounded chunking splits accurately under POSIX and `win32` bounds, keeps an oversized single path in its own chunk, and sends every path once; (b) real `oxlint` `--debug files` with byte-bounded chunking produces the identical linted set; (c) memoized `chainOf` returns byte-identical config chains to disk `chainOf` across nested configs and folders without configs, while `ConfigSet.missed(path)` still detects a newly created config on disk; (d) `Provider.inputs` yields to the event loop across >600 paths.
  - Existing `test/lint/oxlint/` and `test/lint/provider/oxlint/` tests pass, `pnpm run lint`, `pnpm run typecheck`, and `squeal status --wait 60000 <changed-paths>` pass. No key-version bump (`OXLINT_PROVIDER_VERSION` stays 1). Commit cleanly and report decisions and verification evidence.

---

## W2 — Row 017-36: `Keyer` precomputation, merged `inputsOf`, yielding `rekey`, and sync-only `onKeying`

- **Role:** Use `/worker`.
- **Shape:** slice.
- **Outcome:** Eliminate redundant per-file key hashing/sorting in `Keyer.keys`, merge narrowed `inputsOf` unknown-extension probes into one `provider.inputs` call, yield every 256 files in `Keyer.keys` and `judgeAll`, keep the DB write as one atomic transaction, and report `onKeying` only around the local keying/judging/commit phase (not while awaiting async `provider.inputs`).
- **Spec & research to read:** `docs/specifications/017-lint-checks/spec.md` D5, D7, D9; `docs/specifications/017-lint-checks/research/issue-274.md` F2.1, F3.2, F3.4, F3.5, F3.6.
- **Starting seam:**
  1. `src/core/lint/pass/keys.ts` & `src/core/lint/pass/keyer.ts`: build a reusable per-`Keyer` key builder (e.g. `createLintKeyer(basis, blobOf)` in `keys.ts`, using `encodeSegment` and `keyFromSegments` from `src/core/keys/check-key.ts`) that computes once: the shared JSON parts, the sorted `configInputs(basis)` paths with pre-encoded segments (lazily initialized on first key so `Keyer`'s `#listing` / `inputBlobOf` semantics stay identical), and a `Map<string, string>` caching `sha256(JSON.stringify([LINT_KEY, ...shared(basis), inputs.config]))` per distinct `inputs.config`. For each file, insert its encoded segment at its exact sorted position (omitting duplicate if the file is already in `configInputs`). Keys must be **100% byte-identical** to `lintKey()`. Yield every 256 files in `Keyer.keys()`.
  2. `src/core/lint/pass/rekey.ts` & `src/core/lint/pass/run.ts`:
     - In `inputsOf`: when `lint.include` leaves unselected offered files with unlearned extensions (`extra`), combine `[...picked, ...extra]` into one `keyer.inputs(...)` call, call `learn(all.keys())` on all returned paths, and return only the `picked` subset in `inputs`.
     - Make `judgeAll` async and yield every 256 candidates while reading `store.results.get(...)`, keeping `store.transaction(...)` as one synchronous atomic call (never yield inside a transaction).
     - Move `onKeying` (`told`) so `onKeying(true)` is called only after `await inputsOf(...)` settles (wrapping local `keyer.keys`, `judgeAll`, `staleOthers`, and `store.transaction`), not while `provider.inputs(...)` awaits child processes or worker IPC. When `plan === null` or `inputsOf` throws, `onKeying` is not held across async waits. Preserve `test/lint/pass/pass.test.ts` (`["keying", "keyed", "pass"]`).
- **Ownership:**
  - Own: `src/core/lint/pass/keys.ts`, `src/core/lint/pass/keyer.ts`, `src/core/lint/pass/rekey.ts`, `src/core/lint/pass/run.ts`, `test/lint/pass/rekey-perf.test.ts`, `test/lint/pass/pass.test.ts` (and `test/lint/pass/keys.test.ts` if needed).
  - Leave alone (sibling-owned): `src/core/lint/provider/oxlint/*`, `test/lint/oxlint/*`, `docs/*`, `package.json`, `plugins/*`.
- **Done when:**
  - New tests in `test/lint/pass/rekey-perf.test.ts` prove: (a) fast `Keyer.keys` matches `lintKey()` byte-for-byte for paths sorting before, between, and after `configInputs`, paths equal to a closure path, `wholeProgram` false/true, and shared vs distinct `inputs.config`; (b) narrowed `lint.include` makes one `provider.inputs` call instead of two while preserving learned extensions and never creating checks for unselected files; (c) `Keyer.keys` and `judgeAll` yield to the event loop across >600 files while committing in one transaction; (d) `onKeying` is `false` while `provider.inputs` is pending and `true` during local keying/judging/commit.
  - Existing `test/lint/pass/` and `test/keys/key-format.test.ts` pass, `pnpm run lint`, `pnpm run typecheck`, and `squeal status --wait 60000 <changed-paths>` pass. No key-version bump (`LINT_KEY` stays `squeal-lint-key/4`, `KEY_FORMAT_VERSION` unchanged). Commit cleanly and report decisions and verification evidence.
