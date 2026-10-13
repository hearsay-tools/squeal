# Wave 4: 005-17, end to end for setup

The human's go of 2026-10-13: the next release waits for this row. One worker. It is the only 005 row that runs the real `claude` and `codex`.

## 005-17 e2e for setup

Use /worker.

**Outcome.** A real-CLI suite proves spec 005 D3 on the candidate commit: `install.sh`, the launcher across an update, `squeal update`, `squeal setup` and `--yes`, and the setup skill, in both harnesses.

**Read.** Spec `## Testing`, the "End to end" bullets (the done-when); D3; `research/wave-0-checks.md`; `evals/README.md` on scratch roots; `evals/lib/scratch.mjs` and `evals/lib/root.mjs`.

**Shape.** A slice: new tests plus one report.

**Seam.**
- New `test/real-cli/`, with its own `vitest.real-cli.config.ts` and an npm script `test:real-cli`.
- Leave `test/real-cli/` out of `vitest.config.ts`'s include, so neither CI nor the Squeal daemon ever runs it.
- First edit: a `machine()` like `test/cli/install-fixture.ts`, but with the real `claude` and `codex` on its PATH.
- Its hub is a `file://` hub built from the checkout's plugins, never `hearsay-tools/marketplace`.
- The fixtures are `squealShaped()` (`test/cli/setup/fixture.ts`) and `cezarionShaped()` (`test/cli/setup/candidates.test.ts:113`), moved into the fixture module.

**Isolation (hard).**
- Every real-CLI call gets the environment that `cellEnv` builds: a scratch `HOME`, `TMPDIR` and `CODEX_HOME`, plus `CLAUDE_CONFIG_DIR` inside that `HOME`.
- Scratch lives under a root that `root.mjs` accepts: in `/tmp`, with no `.git`, `CLAUDE.md`, `AGENTS.md` or `.claude` above it.
- A guard throws before any spawn if `HOME` resolves to the real home.
- No real `~/.claude`, `~/.codex` or `~/.config` is read or written, and no credential is printed or persisted.

**Model sessions.** Spec bullet 5, the skill run through `claude -p` (Sonnet 5.5) and `codex exec` (gpt-6-luna), one per fixture and harness: 4 sessions, with at most 8 counting retries.
- Before the first one, send the coordinator a request and wait for its go: the eval slot is shared.
- Start each session only while the one-minute load is below the CPU count.

**Owns.** `test/real-cli/**`, `vitest.real-cli.config.ts`, `package.json` scripts, `test/cli/setup/fixture.ts` and `candidates.test.ts` (only the move), plus `research/e2e-setup.md` (a run log: versions, Node 22 and 24, each bullet's result).

**Leaves alone.** `src/**`, `plugins/**`, `install.sh` and the board.
- A defect found is reported with its evidence, not fixed: it becomes a planned row.

**Done when.**
- `npm run test:real-cli` passes every bullet on Node 22 and on Node 24, or the report names a defect behind each failure.
- `npx vitest run --maxWorkers=4` is unchanged.
- Lint and typecheck pass.
