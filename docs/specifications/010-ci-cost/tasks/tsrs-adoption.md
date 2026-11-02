# 010-34: adopt the measured compiler

Use /worker. Shape: slice. Implement D13 and ADR 0005. Start with package.json: pin tsrs 0.20.1-ts7.1.0-beta, select `--fast` in build/typecheck, and make CI call `pnpm run typecheck`. Keep the official TypeScript dependency.

Own package.json (except version), pnpm-lock.yaml, .github/workflows/ci.yml, src/core/delivery/delivery.ts, test/helpers/build-inputs.ts and its test, test/policy/repository-inputs.test.ts, src/cli/setup/build-outputs.ts and its test. You may update test/daemon/helpers.ts and test/fixtures/build-inputs/failed.fixture.ts if renaming the observed compiler helper. Do not rename unrelated historical tsc examples or user fixtures. Coordinator owns versions, bundles, board, spec/status and ADR.

Use existing RegisterOptions, ToolBoundaryOptions and EndTurnOptions for the three destructured delivery parameters. Switch real compiler invocations in the build-observation helpers and their oracle tests to tsrs fast mode. Preserve observed source files after successful and failed builds. Make output-directory detection recognize tsrs as well as tsc; add a regression for a tsrs-only build script whose output is known only from tsconfig.

Done when pnpm lint/typecheck and Squeal affected build-observation, setup and delivery results pass (or report exact unresolved evidence). Do not run a full suite or `pnpm run build` in the worker tree. Commit code, record checks and type changes in `tasks/010-34/notes.md` (also owned). Coordinator verifies builds and integrates.
