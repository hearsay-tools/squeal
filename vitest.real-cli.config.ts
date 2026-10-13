import { defineConfig } from "vitest/config";

/*
 * Row 005-17: spec 005's end-to-end tests with the real `claude` and `codex`
 * (`test/real-cli/`). Run them with
 *
 *   npx vitest run --config vitest.real-cli.config.ts
 *
 * There is no npm script: `package.json` is a key source (test/keys), so a
 * script there would re-pin the key format (the coordinator's decision C,
 * 2026-10-13). The files end in `.real.ts`, outside `vitest.config.ts`'s
 * include, so neither CI nor the Squeal daemon runs them.
 *
 * Isolation (the coordinator's contract, 2026-10-13): every subject command
 * runs through `runIsolated` (`test/real-cli/isolated.ts`) as the throwaway OS
 * user `squeal-e2e`, `sudo -n -u squeal-e2e -H env -i HOME=… PATH=… <cmd>`,
 * which cannot enter this user's home; credentials, for model sessions only,
 * pass by name through `--preserve-env`. Each case has its own HOME, TMPDIR,
 * CODEX_HOME, CLAUDE_CONFIG_DIR and XDG_RUNTIME_DIR under
 * `/home/squeal-e2e/runs/<id>/`, the candidate taken in by `git archive`.
 * `SQ_REAL_CLI_CANDIDATE` names the commit (default HEAD), `SQ_REAL_CLI_NODE`
 * the subject's Node, 22 or 24 (`/opt/squeal-e2e/node<major>`), and
 * `SQ_REAL_CLI_KEEP` keeps each case's directory. `SQ_REAL_CLI_MODELS=1` runs
 * the model sessions of `skill.real.ts`, which cost model calls.
 *
 * One file at a time: each drives scratch machines whose harness calls and
 * daemons take real time.
 */
export default defineConfig({
  test: {
    include: ["test/real-cli/**/*.real.ts"],
    setupFiles: ["test/real-cli/teardown.ts"],
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
