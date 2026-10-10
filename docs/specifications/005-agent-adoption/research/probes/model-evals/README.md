# Probes: model-evals (throwaway)

Throwaway prototype for `../../model-evals.md`, board row 005-06. Not product code: nothing here is imported, built or tested by Squeal, and the repository's Vitest, Biome and TypeScript configurations do not reach this folder's fixture as a project (its tests run only inside a scratch copy). Delete freely; a spec that adopts the suite rebuilds it in its own home.

Run 2026-10-10 on this host (24 CPUs, Linux 6.8, Node 24.21.0) against Claude Code 2.1.296 and Codex CLI 0.160.1, Squeal plugins 0.1.98 from a `git archive` of `458287d`, Vitest 5.0.3.

## Files

- `fixture/`: the subject project, `ledgerline`, TypeScript and Vitest, 7 test files (23 tests, 30 checks with file-level ones) and one node:test file. Each part is there to produce a known Squeal event:

  | Part | Event it produces |
  | --- | --- |
  | `src/money.ts`, `test/money.test.ts` | a regression in the edited module's own test (T1) |
  | `src/report.ts`, `test/report.test.ts` | a knock-on failure in a test the task never names (T1) |
  | `src/csv.ts`, `test/csv.test.ts` | a knock-on that is a real bug: grouped amounts split a CSV row (T1) |
  | `test/clock.test.ts` + `test/support/calendar-cache.ts` | a flaky test: the first run after each change to `src/clock.ts` times out (250 ms budget, 600 ms cold "compile"), every later run passes; Squeal's re-run (001-171) clears it. `LEDGERLINE_CALENDAR_WARM=1` turns it off for the ground truth. The mark lives in the runner's temp directory, which Squeal does not record (only paths inside the worktree are inputs). |
  | `src/clock.ts` | a real bug for a red-then-green fix (T2: a Sunday due date is not moved) |
  | `test/slow/ledger.test.ts`, `squeal.config.json` | a slow file (12 s), marked slow (004) with `src/**` declared as its input so a source edit re-keys it |
  | `scripts/changelog.mjs`, `scripts/changelog.test.mjs` | a node:test suite Squeal is not configured for (T2) |
  | `test/contract/` and `BASE.md` | a test the instruction file forbids editing, so T4 must end red |
  | `BASE.md` | the instruction file's first paragraph, written to both `CLAUDE.md` and `AGENTS.md`; a variant appends to it |

- `tasks/<id>.txt`: ordinary prompts that never mention Squeal or how tests run. `_ending.txt` is appended to each: the fixed last line `TESTS: pass | fail | unknown, evidence: ...`.
- `variants/<name>.json`: one change each. `plugin: false` runs without the plugin; `patch` replaces a string in the pinned bundles (with a minimum match count, so a variant that stops matching after a rebuild fails loudly instead of running the shipped text); `remove` deletes plugin paths; `instructions` appends to the instruction files; `policy` merges into `squeal.config.json` (a key the pinned CLI does not know skips the cell).
- `bin/run-cell.mjs <task> <variant> <claude|codex> <model> [rep] [--cold] [--dry]`: one cell end to end. Scratch `HOME`, `TMPDIR` and `CODEX_HOME` per cell under `$SQ_EVALS_ROOT` (default `/tmp/sq-evals-2a41`); the parent's `CLAUDE*`, `CEZ_*` and Codex thread variables removed; `DISABLE_AUTOUPDATER=1`; the fixture committed at a fixed date (same commit `cbfaa0a` in every cell); the daemon warmed with `squeal start` and `run --all --wait` unless `--cold`; the session with every JSON line timestamped; the load average every 5 s; then Squeal's `status`, the ground truth (`npx vitest run --reporter=json` with the flake off, and `node --test scripts/*.test.mjs`), the diff, a store copy, the daemon stopped, and any process still naming the cell killed and listed. It refuses to start while the one-minute load average is at or above `--max-load` (24).
  - Claude Code: `claude -p` with `--plugin-dir` on the variant's pin, `--setting-sources project --strict-mcp-config`, `--permission-mode acceptEdits` and 001's allow-list plus `Bash(node --test:*)`. Authentication comes from the environment; nothing is copied into the scratch `HOME`.
  - Codex: `codex exec --json -s danger-full-access -m <model>`. The scratch `config.toml` gets the host's provider block with its URL read from the real config at run time (never written here) and the key named by `env_key`; the pin is installed with `codex plugin marketplace add` and `codex plugin add squeal@hearsay` (the pin's marketplace renamed `hearsay`, as in 005-02) and trusted with `squeal init --harness codex --trust --yes`.
- `bin/grade.mjs <cell>/out`: the mechanical grade (`grade.json`).
- `bin/batch.mjs <plan> [--parallel 2] [--max-load 24]`: runs a plan, holding cells while the load is high.
- `bin/collect.mjs`: copies the trimmed evidence into `logs/` and fails if any copied text holds the provider URL or a token from the environment.
- `plan-*.txt`: the plans run.
- `logs/`: `sessions.tsv` (one row per session), `summary.md` (cost, load), `cells/<id>.grade.json` and `cells/<id>.calls.txt` (tool calls, SQUEAL texts, final message), `attempts.txt` (cells that did not reach a model).

## Replay

```sh
R=/tmp/sq-evals-$USER; mkdir -p $R/nm $R/pin-base
git archive 458287d plugins .agents/plugins .claude-plugin | tar -x -C $R/pin-base
(cd $R/nm && echo '{"private":true}' > package.json && npm install vitest@5.0.3)
SQ_EVALS_ROOT=$R node bin/batch.mjs plan-pilot-1.txt
SQ_EVALS_ROOT=$R node bin/collect.mjs
```
