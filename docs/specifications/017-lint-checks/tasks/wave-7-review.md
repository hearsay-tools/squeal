# Spec 017 Wave 7 review brief (candidate `cand/0.1.615`, issue #274)

Use `/reviewer`. Read `docs/vision.md`, `docs/styleguide.md`, `docs/specifications/017-lint-checks/spec.md` (D5, D7, D9, D11), `docs/specifications/017-lint-checks/status.md`, `docs/specifications/017-lint-checks/research/issue-274.md`, and `docs/specifications/017-lint-checks/tasks/wave-7.md`.

## Candidate to review

- Branch: `cand/0.1.615` (exact SHA given in your spawn prompt).
- Base: `3ea7c8c6d` (`origin/main`, 0.1.614).
- Rows covered: `017-35` (oxlint provider) and `017-36` (lint pass keying & yielding), addressing GitHub issue #274.
- Write your findings file to `docs/specifications/017-lint-checks/reviews/0.1.615.md` and commit it cleanly on your branch. Change no product or test code.

## Concrete failure modes to probe

1. **Key validity and byte-identity (D5, D11; no key-format bump):**
   - Verify `createLintKeyer` produces byte-identical `CheckKey` values to `lintKey` for every sort position relative to `configInputs(basis)` (before, between, after, equal to a config/closure file, missing/unlisted blobs, `wholeProgram` false/true, empty vs non-empty `packages`, distinct vs shared `inputs.config`).
   - Verify `Keyer.#list()` resetting `#keyOf = null` keeps keys consistent when `parts.ts` re-keys after `#list()` runs.
   - Verify `test/keys/key-format.test.ts` passes with `LINT_KEY` (`squeal-lint-key/4`), `OXLINT_PROVIDER_VERSION` (1), and `KEY_FORMAT_VERSION` unchanged.
2. **Oxlint `--debug files` chunking and config chain memo (D11, row 017-30):**
   - Verify `chunkDebugPaths` counts UTF-8 bytes + separator, handles empty input and oversized single paths, preserves order, and never drops or duplicates paths.
   - Verify `ctx.observe` stays on during `--debug files` when JS plugins or TS configs are present, and any failed chunk still fails the `inputs` call (D9).
   - Verify `chainOf(root, file, folders)` memoization is scoped strictly to one `Provider.inputs()` call, never cached across calls, and `ConfigSet.missed(path)` still reads disk uncached (row 017-30).
3. **Merged `inputsOf` and yielding `rekey` (D7):**
   - Verify combining `picked` and `extra` in `inputsOf` never creates checks/states for unselected files, still learns every extension the linter lints (including from unselected files for `programSegment`), and handles empty `picked`/`extra` cleanly.
   - Verify yields every 256 files in `Provider.inputs`, `Keyer.keys`, and `judgeAll` never occur inside `store.transaction(...)`, and check whether any stale-state or interleaving race is introduced across the yields (remember only one pass per tool runs at a time, D7).
4. **`onKeying` scoping (row 011-302, #274 F3.6):**
   - Verify `onKeying(true)` is not set while `provider.inputs` awaits child processes or worker IPC, is always paired with `onKeying(false)` in `finally` (including on throws inside `keyAsked`), and preserves `test/lint/pass/pass.test.ts` and `test/daemon/run-group-holder.test.ts`.
5. **Bundles, versions, and privacy:**
   - Verify `package.json`, `install.sh`, and committed bundles under `plugins/` match `0.1.615` cleanly (`pnpm run check:version origin/main`, `test/harness/plugin.test.ts`, `test/harness/antigravity/plugin-schema.test.ts`, `test/version-sensitive.test.ts`, `pnpm run check:private`).

## Done when

`docs/specifications/017-lint-checks/reviews/0.1.615.md` is committed with verdict (`PASS` or `FAIL`), verification output, blockers/should-fix/nits (each labeled `proven`, `plausible`, or `unverified`), what fits, and inputs for next work.
