import { checkWorkspaceResolution } from './scripts/check-workspace-resolution.mjs'
import { availableParallelism } from 'node:os'
import { defaultMaxWorkers } from './.github/scripts/vitest-worker-count.cjs'
import { defineConfig } from 'vitest/config'
import CiTestSequencer from './.github/scripts/ci-test-sequencer.mjs'
import KeepTestFilesInCoverage, { coverageRequested } from './.github/scripts/vitest-coverage-tests.mjs'

checkWorkspaceResolution()

// Four unit packages, one `npm test`. Each owns its own vitest config — this file only names
// them, so `npm test -w <pkg>` and the whole-repo run execute the identical setup:
//   - packages/cezar     Node ESM (NodeNext, `.js` relative imports)
//   - packages/contract   the zod contract, Node-free (its pure helpers, e.g. attention)
//   - packages/api-client the Node-free typed client between the two
//   - packages/web        DOM code, resolved exactly as Vite bundles it
// Browser E2E is also discoverable by Squeal, which marks it slow. `npm test` selects only
// the four unit projects; `npm run test:e2e` selects the browser config after bootstrap.
export default defineConfig({
  test: {
    maxWorkers: defaultMaxWorkers(process.availableMemory(), availableParallelism()),
    // The suites are still being grown; a project that currently matches no file must not
    // fail the validation gate. Root-level only — vitest rejects this inside a project.
    passWithNoTests: true,
    // Balance CI shards by measured duration; new tests remain automatically discovered.
    sequence: { sequencer: CiTestSequencer },
    // Pin reporters so Actions gets exactly one `github-actions` job summary for the whole
    // multi-project run (#62). Leaving this unset lets Vitest auto-append the reporter when
    // GITHUB_ACTIONS=true; an explicit list replaces the defaults and documents the
    // single-summary contract. Local runs keep `default` only. A run that asks for coverage also
    // gets the reporter that keeps test files in the report; any other run resolves the same
    // list as before, and a `--reporter` on the command line replaces the list as it always did.
    reporters: [
      'default',
      ...(process.env.GITHUB_ACTIONS === 'true' ? [['github-actions', { jobSummary: { title: 'Vitest Test Report' } }] as const] : []),
      ...(coverageRequested() ? [new KeepTestFilesInCoverage()] : []),
    ],
    // Opt in with `--coverage` (CI's PR/dispatch test shards do). V8 coverage of the code the tests load,
    // test files included, written where the ignored `.ai/qa/` directory keeps it. The default
    // `exclude` list holds test-file patterns, so it is replaced rather than extended.
    coverage: {
      provider: 'v8',
      reporter: ['json'],
      reportsDirectory: '.ai/qa/coverage',
      exclude: ['**/node_modules/**', '**/dist/**', '**/*.d.ts'],
    },
    projects: [
      './packages/cezar/vitest.config.ts',
      './packages/contract/vitest.config.ts',
      './packages/api-client/vitest.config.ts',
      './packages/web/vitest.config.ts',
      './packages/web/e2e/vitest.config.ts',
    ],
  },
})
