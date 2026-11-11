# Spec 018 wave 13: CI follows Squeal's releases

The human, 2026-11-11: "CI version: Yes, all three". Rows 018-33 and 018-34 run in parallel: disjoint seams.

## 018-33 a Squeal GitHub Action with a moving `v0` tag that never fails the user's CI

Use /worker. Shape: slice.

Outcome: a project adds `uses: hearsay-tools/squeal/ci@v0` once, then `squeal ci record|export|publish` work in later steps, and no Squeal failure fails its CI.

Read: `spec.md` D8, D9, D13, D20; `src/cli/ci.ts`, `ci-export.ts`, `ci-publish.ts`; squawk's current setup for reference (`.github/workflows/ci.yml` in `~/projects/cezar`, read-only: clone at a tag, `node .../squeal.mjs ci record`).

Starting seam: a new composite action `ci/action.yml` that puts a `squeal` wrapper on `PATH` (`$GITHUB_PATH`) pointing at `$GITHUB_ACTION_PATH/../plugins/claude-code/dist/cli/squeal.mjs`, after a Node version check.

Items, each with a test first:
1. The action and its wrapper; when setup cannot run, a pass-through `squeal` (record runs the command and returns its code; export and publish warn, exit 0) and a warning in the log and `$GITHUB_STEP_SUMMARY`.
2. `squeal ci record -- <command>` returns the command's exit code when Squeal's own recording fails (survey first; fix only if it does not).
3. README section: the full setup (shards, export job with `contents: write`, `shared.ref`), the exact-pin alternative with Dependabot or Renovate.

Owns: `ci/` (new), its tests under `test/ci-action/`, `src/cli/ci*.ts` for item 2, the README section. Leave alone: `src/core/shared/*`, `src/core/status/*`, `docs/process.md` (the coordinator adds the tag step), every other repository.

Done when: tests run the wrapper in a temporary directory with a stub `squeal.mjs` (pass, Squeal failure, setup failure); lint, typecheck, `squeal status --wait 60000` on changed paths. No build, no full suite, nothing pushed, no tag.

## 018-34 status names a Squeal mismatch with CI

Use /worker. Shape: slice.

Outcome: when the reader refuses an export for another key format, default status says once, in plain words, which Squeal versions CI and this machine run and what happens next (D21 has the example).

Read: `spec.md` D14, D15, D21; `src/core/shared/reader.ts` (the `importRefusal` note), `src/core/store/transfer-import.ts` (`importRefusal`), `src/core/store/imports.ts` (`ExportHeader.squealVersion`).

Starting seam: the refusal note in `reader.ts`; first find where notes reach default status and `--full`.

Items, each with a failing test first: CI older and CI newer wording; key format numbers only in `--full`; silent when formats match; shown once.

Owns: `src/core/shared/reader.ts`, `src/core/store/transfer-import.ts` (`importRefusal` only), the note's way to status if it needs a change outside `src/core/status/import-*` and their tests. Leave alone: `src/core/status/import-lines.ts`, `imports.ts`, `import-environment.ts` (row 018-32 R1 owns them), `ci/`, `src/cli/ci*.ts`.

Done when: lint, typecheck, `squeal status --wait 60000` on changed paths. No build, no full suite.
