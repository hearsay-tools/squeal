// Throwaway component probe. No daemon, linter or tests are started.
import { formatLintDetails } from '../../../../../../src/cli/lint-report.js';
import { lintStatusLines } from '../../../../../../src/core/lint/surface/format.js';
import type { LintDetails, LintStatus } from '../../../../../../src/core/types/lint-delivery.js';
const details: LintDetails = {
  v: 1, files: [], notLinted: [], waiting: [], pending: 0, stale: 0, unknown: 0,
};
const status: LintStatus = {
  v: 1, files: 1, failing: 0, sinceRegistration: 0, since: null,
  pending: 0, stale: 0, unknown: 0, reasons: [],
};
console.log('CLI clean summary:');
process.stdout.write(formatLintDetails(details, null));
console.log('Status clean summary:');
console.log(lintStatusLines(status, 'squeal').join('\n'));
console.log('Positive oxlint control:');
process.stdout.write(formatLintDetails({ ...details, files: [{
  path: 'src/a.ts', tool: 'oxlint', outcome: 'fail', stale: false,
  findings: [{ rule: 'eslint(no-unused-vars)', message: 'Unused variable.',
    severity: 'warning', line: 1, column: 1 }],
  revision: 16, blob: null, reason: null,
}] }, null));
