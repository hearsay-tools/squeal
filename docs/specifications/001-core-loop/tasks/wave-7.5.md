# Wave 7.5 worker briefs

From `reviews/wave-7.md`. Both `--backend claude --model opus --effort high`, never Fable, from the current main, in parallel on disjoint files. 001-58 (defect 12) shares `src/runners/vitest/adapter.ts` with 001-56 and is dispatched after 001-56 lands.

## 001-56 add rule covers every resolution path

Use /worker. Shape: repair.

Outcome: after an add, no cached transform is reused that the old `invalidateAll` would have dropped, so no add leaves a wrong pass or a closure missing the new file.

Read: `reviews/wave-7.md` B1, S1, S2, N1, N3, N4 and "Inputs for the next wave" 1 to 3; spec D3, D4; Goal 3.

Seam: `src/runners/vitest/stale.ts` `staleTransforms`. First edit: rule 1 of B1 (stale every module with a dep that is not a path and not a Node builtin), then rules 2 (an `enforce: "pre"` plugin passed at `createVitest` in `adapter.ts` `#start`, recording ids whose source uses `import.meta.glob` or a template-literal dynamic import) and 3 (deps under `base + "/"`). S2: feature-detect `invalidationState` once per instance; when missing, invalidate every cached transform and persist one note.

Own: `src/runners/vitest/`, `test/runners/vitest/`, `test/fixtures/vitest/`, the D4 paragraph in `spec.md`, the 001-53 line in `status.md` (correct the figures, S1) plus one dated line. Leave `squeal.config.json` alone (001-57). Agreed with the coordinator: for the S2 note, add an optional `notes?: readonly string[]` to `InvalidateResult` in `src/core/types/runner.ts` and forward each to `context.note` in `src/core/scheduler/refinement.ts` right after `invalidate`, as one standalone commit naming this agreement. Do not run `npm run build` or touch `plugins/claude-code/dist`; a bundle-drift failure is expected, name it.

Done when: the five probe rows of B1 are tests in `structural.test.ts` asserting `affected` and the run outcome; the S2 fallback and the soft-invalidated-then-add case are tests; N1 query stripping is tested; `structural-cost.test.ts` still passes its `cold / 4` guard and reports the ratios; D4 names the three rules and the local and CI figures.

## 001-57 declared inputs for runtime-reading tests

Use /worker. Shape: slice.

Outcome: tests that read files at runtime re-run when those files change, so Squeal never keeps a stale result for them across a bundle rebuild.

Read: `reviews/wave-7.md` "Inputs for the next wave" 4; spec D3 and D11 (`inputs` map); `src/core/daemon/policy.ts`.

Seam: a new committed `squeal.config.json` at the repository root with only the `inputs` map the review proposes (defaults for everything else). Then check that `test/fixtures/vitest/.tmp/` scratch copies are excluded from the watcher (gitignored is enough per D2); if not, add the ignore.

Own: `squeal.config.json`, `.gitignore`, and a new test file under `test/policy/` or `test/e2e/` if one is needed. Leave `src/runners/vitest/` and `test/runners/vitest/` alone (001-56).

Done when: a test (through `loadPolicy` and closure assembly, real store) shows a change under `plugins/claude-code/dist` re-keys exactly `test/harness/plugin.test.ts` and `test/e2e/shipped-plugin.test.ts` (it archives the plugin) and no other test file; a write under `test/fixtures/vitest/.tmp/` produces no revision; `loadPolicy` on the committed file reports no problems.
