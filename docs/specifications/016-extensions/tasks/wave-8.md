# Wave 8: briefs for items 2 to 4, and the complexity counter's parser link

The human, 2026-10-26: try Cursor CLI and OMP first; brief both experiments for linters and type checkers; choose the first new check kind after them; fix the complexity counter's link into the pytest runner now, agreed with 015. Spec 016 shipped at 0.1.320; this wave is research toward a later spec, plus one repair. The four rows run in parallel on disjoint files. Researchers run on claude opus high, the worker on claude opus xhigh.

## Research rows

- 016-33: `research/diagnostic-identity-brief.md`. Use /researcher.
- 016-34: `research/binding-cost-brief.md`. Use /researcher. It measures only after my go (a turn on the host).
- 016-35: `research/harness-trials-brief.md`. Use /researcher.

## 016-36 the complexity counter loads the Python parser from a shared folder

Use /worker. Shape: repair. Outcome: complexity code and the pytest runner import one Python parser from `src/runners/python/`, so an edit in `src/runners/pytest/` re-runs no complexity test, and `src/core/code/` imports nothing from `src/runners/pytest/`.

Read: `research/seams.md` (complexity loads tree-sitter through the pytest runner); spec 016 goal 8 and row 016-20 (the `observe/` and `process/` move); `src/runners/pytest/graph/{parse,wasm}.ts` and `README.md`; `src/harness/build.ts:49-53`.

Starting seam: `src/core/code/count/parser.ts:2`. First edit, as a lead: move the parser loader and `tree-sitter-python.wasm` from `src/runners/pytest/graph/` to `src/runners/python/`, and import it from there in both places.

Owns: `src/runners/python/` (new); in `src/runners/pytest/graph/` the moved parts and their imports; `src/core/code/count/parser.ts` line 2 only (015's condition); `src/harness/build.ts` (`PYTEST_GRAMMAR` only); the import paths in `test/code/count/ready-runtime.test.ts` and `test/runners/pytest/graph/{parse,wasm,cost}.test.ts`; a test that `src/core/code/` imports no runner folder.

Leave alone: `src/core/code/count/wasm.ts` (the TSX loader, 015's); every other file under `src/core/code/`; other runners; the bundle layout under `dist/pytest/`, so installed plugins find the wasm where they do now.

Done when:
- `src/core/code/` imports nothing from `src/runners/pytest/`, and a test says so;
- `squeal status --wait 60000` is green on `test/code/count/`, `test/runners/pytest/`, `test/runners/boundaries.test.ts` and `test/kit/pytest.test.ts`;
- `test/keys/key-format.test.ts` passes, or compare-refs at the latest release tag shows equal keys and uncovered 0, with the hash re-pinned under the same version;
- lint and typecheck pass. Do not run `npm run build` or a full suite.

## Review of the wave 8 candidate (016-36)

Use /reviewer. The candidate is `cand/0.1.338` at `3be104f57`. The range is `c50a5bb2f..3be104f57`: three commits of worker bffeaf59 (the move with the boundary test, the validity harness's grammar list, the kept error texts), the coordinator's two prose lines in `src/core/code/count/` (agreed with 015's coordinator), and the version raise with the bundle commit. Write `docs/specifications/016-extensions/reviews/0.1.338.md` and commit it alone on your branch.

Read: the 016-36 brief above; the board row 016-36; `research/seams.md` on the complexity counter; `src/runners/python/README.md`; `src/harness/build.ts` (`PYTEST_GRAMMAR`, `copyPytestRuntime`).

Check, with proof where you can:
1. The new test in `test/runners/boundaries.test.ts` fails at `c50a5bb2f` and passes here, and `src/core/code/` imports nothing from `src/runners/pytest/`.
2. Selection: an edit in `src/runners/pytest/graph/parse.ts` selects no test file under `test/code/count/`, and an edit in `src/runners/python/parser.ts` selects both the counter's and the pytest graph's tests. Use Squeal's own mapping or Vitest's import graph, and say which.
3. The installed plugins still find the grammar: each `plugins/*/dist/pytest/` holds `tree-sitter-python.wasm` with the hash in `src/runners/python/README.md`, and a CLI built into `/tmp` counts a Python file's complexity and validates a pytest project from the bundle alone. From the sources, `wasm.ts`'s `new URL("../pytest/", module)` now points at `src/runners/pytest/`: say whether any path can load a different grammar there.
4. Stored bytes are unchanged: `test/keys/key-format.test.ts` passes, compare-refs at `squeal--v0.1.336` gives equal keys for every case, uncovered 0, and `KEY_FORMAT_VERSION` is unchanged. `test/keys/validity/sides.ts` copies the grammar for both trees (the tag holds the old path).
5. The texts: the moved loader keeps its "pytest graph:" error prefix (commit `2f3d79430` says why). Say whether it misleads a reader, as should-fix at most.

Run lint, typecheck, `test/runners/boundaries.test.ts`, `test/runners/python/`, `test/runners/pytest/`, `test/code/count/`, `test/kit/pytest.test.ts`, `test/harness/pytest-bundle.test.ts` and `test/keys/key-format.test.ts` on Node 22 and Node 24. No local full suite and no `squeal run --all` (human, 2026-10-25): read the candidate's CI run 40307925141 for full-suite coverage, and report its result as you find it. Label findings proven, plausible or unverified. Only a proven break blocks. Verdict: PASS or FAIL.
