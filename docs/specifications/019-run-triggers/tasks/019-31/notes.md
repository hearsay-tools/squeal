# 019-31 notes: Codex end-to-end tests run the release under test (P7)

Worker d193d628, 2026-11-04. Brief `tasks/wave-5.md`, 019-31; `lessons.md` Round 1, P7. Base `68c033886` (cand/0.1.399 plus the wave 5 briefs). No build: the bundles are the candidate's.

## What changed

1. **The harness selects the worktree's Codex runtime.** `E2E.#copyPlugin` (`test/e2e/harness.ts`) copies `plugins/codex`, then installs this worktree's `plugins/codex-runtime` as `<copy>.data/versions/<version>/` and writes `runtime/current.json` for it. The adapter's `chooseNew` then takes the current runtime: the seed (0.1.368) is not newer. The hooks, the CLI the harness runs (`squeal init`, `squeal setup`, `e.cli`) and the daemons are 0.1.399, not 0.1.368.
2. **`codexSeed`** (`FixtureOptions`): leaves the data folder without a runtime, so the adapter bootstraps the seed as on a fresh install. Only `fixture-cli.test.ts`'s seed case sets it.
3. **One install method.** `selectCodexRuntime(copy, stage)` (`test/e2e/plugins.ts`) is `pluginAt`'s former body, plus one change: it replaces a retained runtime of the same version. `pluginAt` (`run-triggers-support.ts`) calls it. Without that change, `pluginAt(e)` fails because the version directory already exists. The coordinator agreed to this edit outside the brief's list (request 079bc9a5). The hunk is only in `pluginAt` and its imports.
4. **Tests that assumed the seed.**
   - `fixture-cli.test.ts`: the daemon test runs once per runtime: the release for both plugins, and the seed for Codex with `codexSeed`. It checks the daemon's `squealVersion`. For Codex it also checks the `--version` output of `<data>/bin/squeal`, the launcher that SessionStart writes and the hook texts name, with `CODEX_SESSION_ID` set to the fixture session. This is the done-when check.
   - `pytest.test.ts`: Codex's `squeal setup` is now the release's, so both plugins expect the `exclude` default.
   - `lifecycle.test.ts`: the `rowRuns` gate for runtimes before 0.1.383 is gone. Both legs accept either reading of the dead daemon (late heartbeat or no daemon), and both require the recovery title's suffix `: its heartbeat is current`.
5. `test/fixtures/e2e/README.md` names the runtime that a Codex copy runs.

Cost: each Codex fixture copies 12 MB (36 files) at build. Before, the first SessionStart published the 11 MB seed inside the hook, so the first hook now does less work.

## Checks run

- `fixture-cli.test.ts`, before the harness change: the Codex release case failed with `expected '0.1.368' to be '0.1.399'`. The seed case passed. After the change: 8 of 8 pass.
- Codex legs (`-t codex`, `--maxWorkers=1`) of lifecycle, merge-hold, stopped, transitions, worktrees, policy, stop-gap, slow-vitest, node-test, slow-node-test, pytest, run-triggers and run-triggers-control: 27 pass, 2 fail, 401 s, load 15 to 20. The two failures are below. `run-triggers.test.ts` passes on Codex. `ps.test.ts` is Claude Code only. `torn-status.test.ts` is a probe that needs an environment variable.
- `pytest.test.ts -t codex`, verbose: 4 of 4 pass, on Python 3.10 and 3.13.
- Seed tests: `codex-fixed-plugin`, `codex-installer`, `codex-later-runtime`, `codex-migration` and the Codex `seed` and `current` legs of `shipped-plugin`: 9 pass, 7 skipped. The skips are the Claude Code legs that `-t` filtered out and the Codex `bin/squeal --version` cases, which skip by design. `codex-upgrade.test.ts` was not run: it reads the real `~/.codex/config.toml` and runs real model turns, and it imports no changed file.
- `pnpm run lint`, `pnpm run typecheck`: pass.

## Findings

### F1: merge-hold, Codex, on the release runtime: an edit line during a hold (1 run in 14)

The seed runtime hid this. One run of the batch above failed, at `test/e2e/merge-hold.test.ts:73`. The boundary after the hold line should say nothing, but it said:

```
SQUEAL · revision 1
Revision 1 · f11af5f4 + 1, dirty (changed src/math.ts): 3 pending (2 tests, 1 test file loaded).
Squeal saw your edit and queued 1 test file; results arrive with later tool calls, and passing ones stay silent.
```

The line before it said that no test runs until git lists no unmerged path. This text says results will arrive, and it does not name the hold. Runs: 13 of 14 on the release pass (5 and 8 reruns after the failure); 8 of 8 on the seed pass. One failure in 14 runs does not show that the seed is free of it. Not examined further: the cause is in product code (delivery or the merge hold), which this row does not own. A reproduction would loop `vitest run test/e2e/merge-hold.test.ts -t codex` under load and print the hold boundary's text beside it.

### F2: run-triggers-control, both harnesses: a known race

The Codex leg failed 2 runs in 4 on this harness and 2 in 4 on the base harness. The texts differed each time, for example the prompt's baseline line or where the lint line falls. The coordinator says 1956a8055 and cb4f9b450 (019-17) in cand/0.1.399 fix it.

## For the next worker

- `run-triggers.test.ts:76`, `pluginAt(e)`, now installs the same runtime again. It does no harm and costs one 12 MB copy. Remove it once 019-28 is done with that file.
- `envOf` in `run-triggers-support.ts` repeats the harness's private `#env`. A public getter on `E2E` would remove the copy.
- `E2E.#build` has a complexity of 23 (over 20) and did before this row. This row added nothing to it: the selection is in `#copyPlugin`.
