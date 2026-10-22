# Probe: edit to result, Squeal against the runners' own watch modes (011-119)

Throwaway. Kept as the evidence for `../../watch-mode-comparison.md`; no test or product code uses it.

The scripts expect the layout they ran in, under `/tmp/wm119` (removed after the probe):

- `repos/<repo>-s` (Squeal), `repos/<repo>-v` (`vitest --watch`), `repos/toolkit-p` (pytest and pytest-testmon): `git clone`s of the local checkouts, squeal at `da73c4984` (0.1.265), cezar at `efce81346`, toolkit-dev at `7f939fb9`. Installed offline: `npm ci --offline` (squeal; toolkit-dev root, `tools/generator`, `docs-site`, `scripts/metrics/ui`), `pnpm install --offline --frozen-lockfile` (cezar), `uv sync --offline` in toolkit-dev's root and in each `plugin-tools/*`. pytest-testmon 2.2.0 and coverage 7.16.2 were the one network install, with a scratch uv cache, into `toolkit-p/plugin-tools/estimate-pricing/.venv` only.
- `home/` (`HOME`, `XDG_CONFIG_HOME` under it, `.config/squeal/config.json` = `{"capacity":{"hostSlots":4}}`), `run/` (`XDG_RUNTIME_DIR`, so the permit pool is `run/squeal`), `tmp/` (`TMPDIR`).
- Each Squeal clone's `squeal.config.json` is the repository's own (toolkit-dev: the live checkout's untracked one) with `baseline.onStart: "lookup-only"` and `daemon.idleExitMinutes` and `unusedExitMinutes` at 600; cezar's also excludes the Vitest project `e2e`. A daemon's start therefore runs nothing; the scenario's files were then run once with `squeal retry`, so each edit met a warm store as on a live checkout.

Scripts:

- `env.sh`: the scratch environment, sourced by every other script. `sq.sh`: the squeal clone's committed `plugins/claude-code/dist/cli/squeal.mjs` in it; refuses to run outside a clone.
- `edit.sh <clone> <scenario> apply|revert <rep>`: one scenario's edit, its content unique to the repetition (`wm<rep>`), so no tool answers an edit from an earlier result; `revert` is `git checkout` of the file. `t-cli-swp` replays vim: swap file created, changed 3 s later, the write 10 s later, the swap file removed. Prints the write time.
- `measure.sh <repo> <first> <last> <scenario>...`: per repetition and scenario, the edit and then its revert, written to each tool's clone in turn; the first tool alternates by repetition (odd: Squeal first). One JSON line per tool and step in `evidence/results.ndjson`.
- `sq-wait.mjs`: the Squeal timer. Reads the scratch store every 100 ms and sends the daemon nothing: the edit's revision, and for each affected test file the moment its row has no pending phase, a key computed at or after that revision, and a result stored at that key. `sq-idle.sh`: then waits until nothing is queued or running.
- `vt-start.sh`, `stamp-reporter.mjs`, `vt-wait.mjs`: `vitest --watch --maxWorkers=4` on the scenario's candidate files with a reporter that stamps each rerun, run start, module end and run end; the timer follows the first run that starts within 15 s of the write, or records no rerun.
- `poll.sh`: `status --json` every second during the runs (`evidence/poll-*.ndjson`), for the stages.
- `holder.ts`: holds all 4 permits of the scratch pool through the clone's own pool code, as another daemon's backlog tier would (question 4).
- `related.mjs`, `related-counts.mjs`: Vitest's `related` walk, as Squeal's adapter asks it, to pick modules with a small reach.
- `analyze.mjs <results.ndjson> [--stages]`: the table of the findings file, and Squeal's runs per step from the store.

Expected results, from plain targeted runs (`vitest run --maxWorkers=4` on the files, `pytest -q` in the tool) at repetition 0's content:

| Scenario | Edit | Affected test files | Expected |
|---|---|---|---|
| s-body | `void "wm<rep>";` in `src/harness/pi/session.ts` `shutdownSession` | `test/harness/pi/session.test.ts`, `test/harness/pi/run.test.ts`, `test/cli/pi-status.test.ts`, `test/harness/primer-slow-policy.test.ts` | 4 pass (50 tests) |
| s-break | `shutdownSession` returns a string | the same 4 | `session.test.ts` fails 2 tests, 3 pass |
| s-test | a passing `describe` appended to `session.test.ts` | `session.test.ts` | pass (51 tests) |
| c-body | `void 'wm<rep>';` in `packages/cezar/src/application-update/helper.ts` `restartHealthUrl` | `helper.test.ts`, `hoisted-recovery.test.ts`, `windows.test.ts` (same directory) | 3 pass (35 tests) |
| c-break | `/api/v1/health` becomes `/api/v1/health-wm<rep>` | the same 3 | `helper.test.ts` fails 1 test |
| c-test | a passing `describe` appended to `helper.test.ts` | `helper.test.ts` | pass |
| t-cli, t-cli-swp | `# squeal-probe wm<rep>` appended to `plugin-tools/estimate-pricing/estimate_pricing/cli.py` | Vitest `tools/generator/tests/publish.test.ts` (drift check); pytest `test_pricing_*.py` | `publish.test.ts` fails 13 tests; pytest 48 pass |
| t-rules | `_wm = <rep>` in `estimate_pricing/rules.py` `confidence` | `publish.test.ts` (drift); pytest `test_pricing_*.py` | `publish.test.ts` fails 13 tests; pytest 48 pass |
| t-ts | `void 'wm<rep>';` in `tools/generator/src/lib/version-guard.ts` | `version-guard.test.ts`, `cli.test.ts`, `opencode-runtime.test.ts`, `pi-runtime.test.ts`, `publish.test.ts` | 5 pass (159 tests); plain run 76.8 to 85.6 s |

Every revert's expected result is the committed tree's: all pass.

Notes on the data:

- `sq-wait.mjs` waits until nothing is pending, so for a new failure it records the end of the confirming re-run (task 001-171). `analyze.mjs` takes the failure's `PASS -> FAIL` transition from the store instead, and gives the re-run apart.
- Repetition 1 of `t-cli-swp` wrote the same `cli.py` content as repetition 1 of `t-cli`, so Squeal answered it from its store. `edit.sh` was then corrected, the step left out, and repetition 6 run in its place.
- `measure-hold.sh` (question 4, `t-ts`, repetitions 11 to 13): in repetitions 12 and 13 the write came 1.8 s after the previous revert, inside `sq-wait.mjs`'s 2 s look-back, so it matched the revert's revision. Their times come from the store extract: revisions 69 and 71, the `version-guard.test.ts` tier and the `publish.test.ts` tier against the write times in `results-hold.ndjson` and the holder's release times.
- `cli-break.sh` (n = 3): plain pytest and `--testmon` after `raise SystemExit(3)` as `cli.py`'s first line, then after its revert (`evidence/cli-break.txt`).
- `.testmondata` lived in the pytest clone's root. `measure.sh` prints `bc` values without a leading zero; `analyze.mjs` adds it when parsing.
