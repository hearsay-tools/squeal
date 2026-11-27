# Wave 7: repository on Vite 8.4.0 with every retained-release fixture on 8.3, and two review notes (rows 025-25, 025-31, 025-32)

Approved by the human 2026-11-27. The three rows run in parallel on disjoint files. None edits `docs/board.md` or
runs `pnpm run build` in its tree. Any direct `vitest` run gets `timeout 600`; run long commands as hsq jobs with
`--dir` outside the task temp folder. Final message: decisions the brief did not settle and the evidence for each
done-when.

## 025-25: the repository on Vite 8.4.0, and every retained-release fixture on the Vite it supports (slice; opus high)

The first attempt was reverted from 0.1.657 (`reviews/0.1.657-r2.md`, board row 025-25): with the repository on
Vite 8.4.0, every test that runs a Squeal release older than 0.1.645 cannot start Vitest (old `load` wrapper). Start
by re-applying the reverted commits `f23dee206`, `1af85ed49` and `e620dcb2a` (`git cherry-pick`; they move the
repository to 8.4.0, add the `vite-8.3` alias and key-format `runsOn`, and pin the shipped-plugin seed to 8.3). Then
sweep `test/e2e/` and `test/harness/` for every test that installs or runs a retained release (for example
`run-triggers-control.test.ts` with 0.1.393, `codex-*` upgrade and migration tests, `shipped-plugin.test.ts`) and give
each the Vite 8.3 it supports through `VITE_8_3` in `test/e2e/install.ts`; current releases stay on the repository's
Vite. Check `test/runner-host/container/lifecycle.test.ts` ("the host listed no test file" once in CI `45993019188`)
under 8.4.0. Do not edit `test/e2e/control-wording.ts` (025-32). Owns `package.json`, `pnpm-lock.yaml`,
`pnpm-workspace.yaml`, `test/keys/validity/`, `test/runners/vitest/sources-vite-load.test.ts`, `test/e2e/install.ts`
and the retained-release tests. Done when: every test file under `test/e2e/`, `test/runners/vitest/`,
`test/scheduler/` and `test/daemon/` that passes on main also passes on this tree (run them; list counts);
key-format and version-sensitive pass; dispatch CI on your branch (`gh workflow run ci.yml --ref <branch>` after
pushing it as `wip/025-25`) and report its result.

## 025-31: `test-frame.ts` keeps the frame of a synchronous function named `async` (repair; opus medium)

Review `0.1.657.md` S3 has the reproducer: `at async (src/helper.ts:3:9)` is a synchronous function named `async`,
and the 0.1.657 rule `/^\s*at (?:async )?(.+?)\s*$/` drops its name. Strip `async ` only when what follows is itself
a frame (`at async /path:l:c`, `at async name (path:l:c)`), not `at async (path:l:c)`. Owns
`src/core/status/test-frame.ts` and `test/status/test-frame.test.ts`. Done when: the reproducer passes as a test,
fails on the current rule, and every current `test/status/` test passes.

## 025-32: the old-primer normalizer in `run-triggers-control.test.ts` stays on one line (repair; opus medium)

Review `0.1.657-r2.md` found that the Codex case fails now and then on candidate and main: the normalization regex in
`test/e2e/control-wording.ts` can cross a line after the skill path's closing backtick; its synthetic probe shows it.
Make the regex stop at the line end. Owns `test/e2e/control-wording.ts` and a unit test for it. Done when: the
review's probe passes as a test and fails on the current regex; the Codex and Claude cases of
`test/e2e/run-triggers-control.test.ts` pass ten runs in a row (as an hsq job).

Use /worker.
