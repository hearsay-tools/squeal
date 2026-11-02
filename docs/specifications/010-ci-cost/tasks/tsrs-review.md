# Review: tsrs adoption, 010-34

Use /reviewer. Review the exact candidate commit supplied in the dispatch against base `6fa27aa86`, D13 and ADR 0005. Write and commit only `docs/specifications/010-ci-cost/reviews/tsrs-0.1.393.md`.

Focus on compiler selection in scripts/CI/native CLI test builds, strict typechecking, successful and failed build-input observation, the tsrs-only setup output-directory regression, declaration/JavaScript output, platform packaging, unchanged public option interfaces and reproducible bundles. Historical tsc user fixtures remain intentional. Do not widen into adding a typecheck runner or changing unrelated setup parsing.

Coordinator evidence before dispatch: pnpm install --frozen-lockfile passed; lint checked 2665 files with no fixes; tsrs --fast --noEmit passed; plugin build passed; key-format and version-sensitive guard checks passed (2 files, 18 tests); version check passes 0.1.392 -> 0.1.393. Squeal affected checks are being read separately; candidate full CI is authoritative coverage and must be named pending if still running. Do not run a local full suite or checkpoint. Check exact candidate checkout and record actual results; inspect current CI. Test/fixtures/build-inputs/failed.fixture.ts is exercised by the nested recorded build-inputs test, not as a standalone suite.

## Narrow re-review after CI

Candidate CI 41433585897 passed Node24 and Node22 shards1/3 and3/3. Its only failure was install-sh.test.ts: installer SQUEAL_VERSION still0.1.392 while packageversion0.1.393. The repair changes install.sh's literal pin to0.1.393; all other changes since reviewed8ca0eead0 are review/finalnotes docs. Review only this delta against the prior PASS in reviews/tsrs-0.1.393.md. Check installer/package/plugin version agreement, shell syntax and current installer test evidence. Write and commit only reviews/tsrs-0.1.393-r2.md. Do not repeat the broader compiler review or a local full suite. New candidate CI must be reported pending until it passes.
